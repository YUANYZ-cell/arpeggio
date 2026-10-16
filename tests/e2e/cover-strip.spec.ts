import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { COVER_COUNT, coverSpots, ensureStripDrifts, importCovers, ringProgress, stripCentre, stripProbe, writeCoverImages } from './cover-fixtures'

// Restricted CI / agent sandboxes launch Electron as a plain Node process and
// fail to boot the renderer, so those runs opt in to the usual Chromium escape
// hatches instead of weakening the default launch for normal machines.
const SANDBOXED = process.env.ARPEGGIO_E2E_SANDBOXED === '1'
const LAUNCH_ARGS = SANDBOXED ? ['.', '--no-sandbox', '--disable-gpu'] : ['.']

test.describe('封面速览：跑马灯、滚轮与主舞台联动', () => {
  let app: ElectronApplication
  let page: Page
  let dataRoot: string
  let imageRoot: string

  test.beforeAll(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-strip-'))
    imageRoot = await mkdtemp(join(tmpdir(), 'arpeggio-covers-'))
    const sources = await writeCoverImages(imageRoot)
    app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
    page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    await importCovers(page, sources)
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    await expect.poll(async () => page.locator('.strip-cover').count()).toBeGreaterThan(COVER_COUNT)
    await ensureStripDrifts(page)
  })

  test.afterAll(async () => {
    // Closing the shell and clearing a freshly imported archive is slower than
    // the default hook budget.
    test.setTimeout(120_000)
    await app?.close()
    await rm(dataRoot, { recursive: true, force: true })
    await rm(imageRoot, { recursive: true, force: true })
  })

  test('the ribbon drifts on its own and carries the stage with it', async () => {
    await page.mouse.move(4, 4)
    const before = await stripProbe(page)
    expect(before.pitch).toBeGreaterThan(0)
    expect(before.onPlayhead).not.toBeNull()
    // The whole point: the stage presents the cover sitting on the playhead.
    expect(before.stage).toBe(before.onPlayhead)
    expect(before.playheadActive).toBe(true)

    await page.waitForTimeout(8000)
    const after = await stripProbe(page)
    const advanced = after.scrollLeft - before.scrollLeft
    // One slot per dwell: eight seconds of drift clears a little over a slot.
    expect(advanced).toBeGreaterThan(before.pitch * 0.6)
    expect(advanced).toBeLessThan(before.pitch * 2.2)
    expect(after.stage).not.toBe(before.stage)
    expect(after.stage).toBe(after.onPlayhead)
    expect(after.playheadActive).toBe(true)
  })

  test('a resting pointer holds the ribbon and previews the cover under it', async () => {
    const away = await coverSpots(page)
    expect(away).not.toBeNull()
    await page.mouse.move(away!.x, away!.y)
    await page.waitForTimeout(300)
    const held = await stripProbe(page)
    expect(held.stage).toBe(away!.title)
    await page.waitForTimeout(1500)
    const still = await stripProbe(page)
    expect(still.scrollLeft).toBe(held.scrollLeft)

    await page.mouse.move(4, 4)
    await page.waitForTimeout(2000)
    const moving = await stripProbe(page)
    expect(moving.scrollLeft).toBeGreaterThan(still.scrollLeft)
  })

  test('the wheel browses the ribbon without dragging the page along', async () => {
    const centre = await stripCentre(page)
    await page.mouse.move(centre.x, centre.y)
    await page.waitForTimeout(250)
    const before = await stripProbe(page)
    await page.mouse.wheel(0, 320)
    await page.waitForTimeout(900)
    const after = await stripProbe(page)
    expect(after.scrollLeft - before.scrollLeft).toBeGreaterThan(before.pitch * 1.4)
    expect(Math.abs(after.libraryTop - before.libraryTop)).toBeLessThan(2)
  })

  test('the dwell ring restarts exactly when the stage changes', async () => {
    await page.mouse.move(4, 4)
    const start = await stripProbe(page)
    let changed = false
    for (let step = 0; step < 90 && !changed; step += 1) {
      await page.waitForTimeout(100)
      changed = (await stripProbe(page)).stage !== start.stage
    }
    expect(changed).toBe(true)
    const ring = await ringProgress(page)
    expect(ring).not.toBeNull()
    // A ring still mid-cycle right after a change means the drift and the dwell
    // ring are running on different clocks.
    expect(ring!.progress).toBeLessThan(0.3)
  })

  test('the window frame around the dark shell is dark too', async () => {
    const frame = await stripProbe(page)
    const body = frame.bodyBackground.match(/\d+/g)?.map(Number) ?? []
    const border = frame.shellBorder.match(/[\d.]+/g)?.map(Number) ?? []
    expect(body.length).toBeGreaterThanOrEqual(3)
    // A paper-coloured surround around a dark shell is the defect this guards.
    expect(Math.max(...body.slice(0, 3))).toBeLessThan(40)
    // And the hairline has to stay a hairline: no opaque pale edge.
    expect(border.length === 4 ? border[3] : 1).toBeLessThan(0.15)
  })
})
