import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const GAP_TOLERANCE = 2

// Restricted CI / agent sandboxes launch Electron as a plain Node process and
// fail to boot the renderer, so those runs opt in to the usual Chromium escape
// hatches instead of weakening the default launch for normal machines.
const SANDBOXED = process.env.ARPEGGIO_E2E_SANDBOXED === '1'
const LAUNCH_ARGS = SANDBOXED ? ['.', '--no-sandbox', '--disable-gpu'] : ['.']

async function measureBoxes(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width }
    }
    return { book: rect('.book-spread'), leaf: rect('.book-leaf'), left: rect('.reader-side-left'), right: rect('.reader-side-right'), stage: rect('.paper-stage') }
  })
}

test('book spread keeps clear of the reader side panels at minimum window width', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-overlap-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    // Reproduce the reported layout: smallest supported window.
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 880) })
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await expect(page.locator('.book-spread')).toBeVisible()
    await expect.poll(async () => page.locator('.book-right img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await page.waitForTimeout(150)

    const boxes = await measureBoxes(page)
    expect(boxes.book && boxes.left && boxes.right).toBeTruthy()
    // The spread must sit between the two side panels, not on top of them.
    expect(boxes.book!.left).toBeGreaterThanOrEqual(boxes.left!.right - GAP_TOLERANCE)
    expect(boxes.book!.right).toBeLessThanOrEqual(boxes.right!.left + GAP_TOLERANCE)

    // During the page-flip animation the turning leaf must stay inside the same lane.
    await page.locator('.viewer-toolbar button[aria-label="下一页"]').click()
    for (let sample = 0; sample < 5; sample += 1) {
      const during = await measureBoxes(page)
      if (during.leaf) {
        expect(during.leaf.left).toBeGreaterThanOrEqual(during.left!.right - GAP_TOLERANCE)
        expect(during.leaf.right).toBeLessThanOrEqual(during.right!.left + GAP_TOLERANCE)
      }
      await page.waitForTimeout(110)
    }
    await expect(page.locator('.book-leaf')).toHaveCount(0)

    await page.screenshot({ path: 'runtime-data/qa/reader-overlap-min-window.png' })
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
