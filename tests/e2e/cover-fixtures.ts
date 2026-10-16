import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'

/** Enough covers to overflow the ribbon at the window's minimum width. */
export const COVER_COUNT = 18

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** A tiny solid-colour PNG. Distinct seeds mean distinct bytes, so the archive
 *  stores them as separate scores instead of folding them into one duplicate. */
export function testPng(seed: number, width = 12, height = 12): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = (seed * 37 + x * 11) % 256
      raw[row + 2 + x * 3] = (seed * 53 + y * 7) % 256
      raw[row + 3 + x * 3] = (seed * 97) % 256
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Writes `count` distinct sheets and returns the paths to import. */
export async function writeCoverImages(directory: string, count = COVER_COUNT): Promise<string[]> {
  const sources: string[] = []
  for (let seed = 0; seed < count; seed += 1) {
    const path = join(directory, `cover-${String(seed).padStart(2, '0')}.png`)
    await writeFile(path, testPng(seed + 1))
    sources.push(path)
  }
  return sources
}

/** Imports every sheet as its own score, then reloads so the ribbon sees them. */
export async function importCovers(page: Page, sources: string[]): Promise<void> {
  await page.evaluate(async (paths) => {
    for (const path of paths) {
      await window.arpeggio.importScore([path], { title: `封面${path.slice(-6, -4)}`, artist: '回归测试', guitarType: 'acoustic', scoreType: '弹唱谱' })
    }
  }, sources)
  await page.reload()
}

export interface StripProbe {
  scrollLeft: number
  clientWidth: number
  pitch: number
  /** Title of the cover the playhead is on, i.e. the one the stage must show. */
  onPlayhead: string | null
  /** Whether that same cover carries the stage highlight. */
  playheadActive: boolean
  stage: string | null
  libraryTop: number
  bodyBackground: string
  shellBorder: string
}

/** Reads the ribbon, the stage and the window frame in one round trip. */
export const stripProbe = (page: Page) => page.evaluate((): StripProbe => {
  const strip = document.querySelector('.cover-strip') as HTMLElement
  const covers = Array.from(strip.querySelectorAll<HTMLElement>('.strip-cover'))
  const real = covers.filter((cover) => cover.hasAttribute('aria-label'))
  const pitch = covers.length > 1 ? covers[1].offsetLeft - covers[0].offsetLeft : 0
  const inset = parseFloat(getComputedStyle(strip).paddingLeft) || 0
  // The playhead is the cover whose left edge sits at or before the middle of
  // the visible window. Slot arithmetic rather than a rect comparison keeps the
  // probe off the sub-pixel knife edge when a crossing lands exactly on it.
  const slot = pitch > 0 ? Math.floor((strip.scrollLeft + strip.clientWidth * 0.5 - inset) / pitch) : -1
  const index = slot >= 0 && real.length > 0 ? ((slot % real.length) + real.length) % real.length : -1
  const onPlayhead = index >= 0 ? real[index] : undefined
  const stage = document.querySelector('.featured-layer.in .featured-copy > strong')
  return {
    scrollLeft: Number(strip.scrollLeft.toFixed(2)),
    clientWidth: strip.clientWidth,
    pitch,
    onPlayhead: onPlayhead ? onPlayhead.querySelector('strong')?.textContent ?? '' : null,
    playheadActive: Boolean(onPlayhead?.classList.contains('active')),
    stage: stage ? stage.textContent : null,
    libraryTop: (document.querySelector('.library-home') as HTMLElement).scrollTop,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    shellBorder: getComputedStyle(document.querySelector('.app-shell') as HTMLElement).borderTopColor
  }
})

/** How far the stage dwell ring has run, as a 0-1 share of its cycle. */
export const ringProgress = (page: Page) => page.evaluate(() => {
  const circle = document.querySelector('.rotate-ring circle') as SVGCircleElement | null
  if (!circle) return null
  const circumference = 2 * Math.PI * Number(circle.getAttribute('r') || 16)
  const offset = parseFloat(getComputedStyle(circle).strokeDashoffset) || 0
  return { circumference, offset, progress: 1 - offset / circumference }
})

/** A cover that is fully visible but well away from the playhead. */export const coverSpots = (page: Page) => page.evaluate(() => {
  const strip = document.querySelector('.cover-strip') as HTMLElement
  const stripBox = strip.getBoundingClientRect()
  const anchor = stripBox.left + strip.clientWidth * 0.5
  const real = Array.from(strip.querySelectorAll<HTMLElement>('.strip-cover[aria-label]'))
  const away = real.find((cover) => {
    const box = cover.getBoundingClientRect()
    return box.left > stripBox.left + 48 && box.right < stripBox.right - 48 && Math.abs(box.left + box.width / 2 - anchor) > 150
  })
  if (!away) return null
  const box = away.getBoundingClientRect()
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height * 0.4), title: away.querySelector('strong')?.textContent ?? '' }
})

export const stripCentre = async (page: Page) => {
  const box = await page.locator('.cover-strip').boundingBox()
  if (!box) throw new Error('封面带不可见')
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

/** The stage carousel has to be on for the ribbon to drift at all. */
export async function ensureStripDrifts(page: Page): Promise<void> {
  if (await page.locator('.stage-rotate').getAttribute('aria-pressed') === 'false') await page.locator('.stage-rotate').click()
}
