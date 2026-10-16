import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { COVER_COUNT, ensureStripDrifts, importCovers, stripCentre, stripProbe, writeCoverImages } from './cover-fixtures'

const executable = resolve(process.env.ARPEGGIO_PACKAGED_PATH || 'release/win-unpacked/Arpeggio.exe')

// Same sandbox escape hatch as the un-packaged specs: a headless CI container
// cannot start the packaged Chromium without these, and the flags are ignored
// by a normal desktop run.
const SANDBOX_ARGS = process.env.ARPEGGIO_E2E_SANDBOXED === '1' ? ['--no-sandbox', '--disable-gpu'] : []

test.skip(!existsSync(executable), 'Run npm run dist first')
test('packaged Windows application starts offline with the seeded archive', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-packaged-'))
  const app = await electron.launch({ executablePath: executable, args: SANDBOX_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    await expect(page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' })).toBeVisible()
    await page.screenshot({ path: 'runtime-data/qa/cover-stage-packaged.png', fullPage: true })
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { arpeggio: { isPackaged(): Promise<boolean> } }).arpeggio.isPackaged())).toBe(true)
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await page.screenshot({ path: 'runtime-data/qa/detail-packaged.png', fullPage: true })
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await expect(page.getByRole('button', { name: '整页' })).toHaveClass(/active/)
    await expect(page.locator('.book-spread')).toBeVisible()
    await expect.poll(async () => page.locator('.paper img').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    const sheetVisible = await page.locator('.paper').first().evaluate((paper) => {
      const sheet = paper.getBoundingClientRect()
      const stage = paper.closest('.paper-stage')!.getBoundingClientRect()
      return sheet.top >= stage.top && sheet.bottom <= stage.bottom
    })
    expect(sheetVisible).toBe(true)
    await page.screenshot({ path: 'runtime-data/qa/packaged-book.png', fullPage: true })

    // The shipped build must serve the stage spread too: this is the artefact
    // the user actually opens, so "it works from source" is not enough.
    await page.getByRole('button', { name: '进入演奏模式' }).first().click()
    await expect(page.locator('.performance-spread')).toBeVisible()
    await expect(page.locator('.performance-sheet')).toHaveCount(2)
    await expect(page.locator('.page-indicator')).toHaveText('1–2 / 4')
    await expect.poll(async () => page.locator('.performance-sheet img').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    const spreadFits = await page.evaluate(() => {
      const stage = document.querySelector('.performance-stage')!.getBoundingClientRect()
      const sheets = [...document.querySelectorAll('.performance-sheet')].map((sheet) => sheet.getBoundingClientRect())
      return {
        inside: sheets.every((sheet) => sheet.left >= stage.left - 2 && sheet.right <= stage.right + 2 && sheet.bottom <= stage.bottom + 2),
        scrolls: (document.querySelector('.performance-stage') as HTMLElement).scrollWidth > Math.ceil(stage.width) + 2
      }
    })
    expect(spreadFits.inside).toBe(true)
    expect(spreadFits.scrolls).toBe(false)
    await page.screenshot({ path: 'runtime-data/qa/packaged-performance-spread.png' })
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})

// The cover ribbon is the shell's own carousel: it drifts, it owns the wheel,
// and the stage follows the cover on its playhead. All of that has to hold in
// the artefact the user double-clicks, not just in the source build.
test('packaged build drifts the ribbon, follows it on the stage and frames it dark', async () => {
  // Importing a whole ribbon's worth of scores into the shipped archive takes
  // far longer than the default budget.
  test.setTimeout(180_000)
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-packaged-strip-'))
  const imageRoot = await mkdtemp(join(tmpdir(), 'arpeggio-packaged-covers-'))
  const sources = await writeCoverImages(imageRoot)
  const app = await electron.launch({ executablePath: executable, args: SANDBOX_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    await importCovers(page, sources)
    await expect.poll(async () => page.locator('.strip-cover').count()).toBeGreaterThan(COVER_COUNT)
    await ensureStripDrifts(page)

    await page.mouse.move(4, 4)
    const before = await stripProbe(page)
    expect(before.pitch).toBeGreaterThan(0)
    expect(before.stage).toBe(before.onPlayhead)
    await page.waitForTimeout(4000)
    const after = await stripProbe(page)
    expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft)
    expect(after.stage).toBe(after.onPlayhead)
    expect(after.playheadActive).toBe(true)

    const centre = await stripCentre(page)
    await page.mouse.move(centre.x, centre.y)
    await page.waitForTimeout(250)
    const wheelBefore = await stripProbe(page)
    await page.mouse.wheel(0, 320)
    await page.waitForTimeout(900)
    const wheelAfter = await stripProbe(page)
    expect(wheelAfter.scrollLeft - wheelBefore.scrollLeft).toBeGreaterThan(wheelBefore.pitch * 1.4)
    expect(Math.abs(wheelAfter.libraryTop - wheelBefore.libraryTop)).toBeLessThan(2)

    const body = wheelAfter.bodyBackground.match(/\d+/g)?.map(Number) ?? []
    expect(Math.max(...body.slice(0, 3))).toBeLessThan(40)
    await page.mouse.move(4, 4)
    await page.screenshot({ path: 'runtime-data/qa/packaged-ribbon.png' })
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
    await rm(imageRoot, { recursive: true, force: true })
  }
})
