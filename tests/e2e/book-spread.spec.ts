import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Restricted CI / agent sandboxes launch Electron as a plain Node process and
// fail to boot the renderer, so those runs opt in to the usual Chromium escape
// hatches instead of weakening the default launch for normal machines.
const SANDBOXED = process.env.ARPEGGIO_E2E_SANDBOXED === '1'
const LAUNCH_ARGS = SANDBOXED ? ['.', '--no-sandbox', '--disable-gpu'] : ['.']

test('opens three-page spread and turns through the final sheet', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-book-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    await expect(page.locator('.featured-score')).toContainText('NOW ON STAGE')
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await expect(page.locator('.reader-counter')).toHaveText('1 / 4')
    await expect(page.locator('.book-right img')).toHaveAttribute('alt', '红色高跟鞋 第 1 页')
    await expect.poll(async () => page.locator('.book-right img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await page.screenshot({ path: 'runtime-data/qa/book-cover.png' })
    await page.locator('.viewer-toolbar button[aria-label="下一页"]').click()
    await expect(page.locator('.book-leaf.forward')).toBeVisible()
    await expect(page.locator('.book-leaf.forward')).toHaveCSS('animation-name', 'book-turn-forward')
    await expect(page.locator('.reader-counter')).toHaveText('2–3 / 4')
    await expect(page.locator('.book-left img')).toHaveAttribute('alt', '红色高跟鞋 第 2 页')
    await expect(page.locator('.book-right img')).toHaveAttribute('alt', '红色高跟鞋 第 3 页')
    await expect(page.locator('.book-leaf')).toHaveCount(0)
    const spread = await page.locator('.book-slot').evaluateAll((slots) => slots.map((slot) => {
      const rectangle = slot.getBoundingClientRect()
      return { left: rectangle.left, right: rectangle.right, top: rectangle.top, bottom: rectangle.bottom }
    }))
    expect(Math.abs(spread[0].right - spread[1].left)).toBeLessThanOrEqual(2)
    expect(Math.abs(spread[0].top - spread[1].top)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: 'runtime-data/qa/book-spread.png' })
    await page.locator('.viewer-toolbar button[aria-label="下一页"]').click()
    await expect(page.locator('.reader-counter')).toHaveText('4 / 4')
    await expect(page.locator('.book-left img')).toHaveAttribute('alt', '红色高跟鞋 第 4 页')
    await expect(page.locator('.viewer-toolbar button[aria-label="下一页"]')).toBeDisabled()
    await expect(page.locator('.book-leaf')).toHaveCount(0)
    await page.locator('.viewer-toolbar button[aria-label="上一页"]').click()
    await expect(page.locator('.book-leaf.backward')).toBeVisible()
    await expect(page.locator('.reader-counter')).toHaveText('2–3 / 4')
    await expect(page.locator('.book-leaf')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('featured score rotates across app loads and opens the displayed score', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-feature-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    const source = join(process.cwd(), 'resources', 'seed-library', 'Library', 'Acoustic', 'AC-0001', 'page-01.jpg')
    await page.evaluate(async (path) => {
      await window.arpeggio.importScore([path], { title: '第二张曲谱', artist: '测试艺术家', guitarType: 'acoustic', scoreType: '弹唱谱' })
    }, source)
    await page.reload()
    await expect(page.locator('.song-card')).toHaveCount(2)
    const first = await page.locator('.featured-score').getAttribute('aria-label')
    await page.reload()
    await expect(page.locator('.song-card')).toHaveCount(2)
    const second = await page.locator('.featured-score').getAttribute('aria-label')
    expect(second).not.toBe(first)
    // The stage paints two plates while a rotation dissolves; `.in` is the one
    // actually on stage, and is always exactly one element.
    const displayedTitle = await page.locator('.featured-layer.in .featured-copy > strong').innerText()
    await page.locator('.featured-score').click()
    await expect(page.getByRole('heading', { name: displayedTitle })).toBeVisible()
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
