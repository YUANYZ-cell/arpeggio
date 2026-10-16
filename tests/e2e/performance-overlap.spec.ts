import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const GAP_TOLERANCE = 2
const STAGE_PADDING = 10

// Restricted CI / agent sandboxes launch Electron as a plain Node process and
// fail to boot the renderer, so those runs opt in to the usual Chromium escape
// hatches instead of weakening the default launch for normal machines.
const SANDBOXED = process.env.ARPEGGIO_E2E_SANDBOXED === '1'
const LAUNCH_ARGS = SANDBOXED ? ['.', '--no-sandbox', '--disable-gpu'] : ['.']

type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number }
type Measured = { stage: Box; sheets: Box[]; rail: Box; viewport: { width: number; height: number }; scrollWidth: number }

async function measureBoxes(page: import('@playwright/test').Page): Promise<Measured> {
  return page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }
    }
    const root = document.querySelector<HTMLElement>('.performance')!
    const stage = document.querySelector<HTMLElement>('.performance-stage')!
    const viewport = root.getBoundingClientRect()
    return {
      stage: rect(stage)!,
      // The score on the stand: one sheet, or the two facing sheets of a spread.
      sheets: [...stage.querySelectorAll('.performance-sheet')].map((sheet) => rect(sheet)!),
      rail: rect(document.querySelector('.performance-controls'))!,
      viewport: { width: viewport.width, height: viewport.height },
      scrollWidth: stage.scrollWidth
    }
  })
}

// Performance mode must give the whole stage to the score: the control panel is a
// right-hand rail, so nothing floats on top of the notes or steals page height.
// The score now arrives as a spread, so the contract is stated about the sheets
// the stage actually shows — each one complete, all of them inside the stage,
// the group filling an axis, and the rail still beside rather than over them.
function expectClearLayout(measured: Measured, label: string) {
  const { stage, sheets, rail, viewport } = measured
  expect(sheets.length, `${label} 谱面未渲染`).toBeGreaterThan(0)

  const left = Math.min(...sheets.map((sheet) => sheet.left))
  const right = Math.max(...sheets.map((sheet) => sheet.right))
  const top = Math.min(...sheets.map((sheet) => sheet.top))
  const bottom = Math.max(...sheets.map((sheet) => sheet.bottom))

  // The score stays inside the window and inside its own stage: no cropping.
  expect(left, `${label} 曲谱超出左边界`).toBeGreaterThanOrEqual(stage.left - GAP_TOLERANCE)
  expect(right, `${label} 曲谱超出右边界`).toBeLessThanOrEqual(stage.right + GAP_TOLERANCE)
  expect(top, `${label} 曲谱超出上边界`).toBeGreaterThanOrEqual(stage.top - GAP_TOLERANCE)
  expect(bottom, `${label} 曲谱超出下边界`).toBeLessThanOrEqual(stage.bottom + GAP_TOLERANCE)
  expect(right, `${label} 曲谱超出窗口`).toBeLessThanOrEqual(viewport.width + GAP_TOLERANCE)

  // The control rail must sit beside the score, never on top of it.
  expect(stage.right, `${label} 右侧控制栏压住曲谱`).toBeLessThanOrEqual(rail.left + GAP_TOLERANCE)
  expect(rail.right, `${label} 控制栏超出右边界`).toBeLessThanOrEqual(viewport.width + GAP_TOLERANCE)
  expect(rail.top, `${label} 控制栏超出上边界`).toBeGreaterThanOrEqual(-GAP_TOLERANCE)
  expect(rail.bottom, `${label} 控制栏超出下边界`).toBeLessThanOrEqual(viewport.height + GAP_TOLERANCE)

  // Nothing to scroll to.
  expect(measured.scrollWidth, `${label} 谱面区出现横向滚动`).toBeLessThanOrEqual(Math.ceil(stage.width) + GAP_TOLERANCE)

  // The score fills at least one axis of the stage. Asserting full height alone
  // was true only while a single sheet was width-bound: a spread on a narrow
  // stage is width-bound instead, and there the full width is the honest
  // measure of "no space wasted". Demanding both would demand a cropped sheet.
  const filledHeight = (bottom - top) / stage.height
  const filledWidth = (right - left) / stage.width
  expect(Math.max(filledHeight, filledWidth), `${label} 曲谱未铺满视口（宽 ${filledWidth.toFixed(3)}，高 ${filledHeight.toFixed(3)}）`).toBeGreaterThan(0.97)
}

test('performance mode shows the whole score beside the control rail', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-performance-overlap-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await expect(page.locator('.book-spread')).toBeVisible()
    await page.getByRole('button', { name: '进入演奏模式' }).first().click()
    await expect(page.locator('.performance')).toBeVisible()
    await expect.poll(async () => page.locator('.performance-sheet img').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    // A fresh score has no saved auto-turn profile, so the picker stays hidden.
    await expect(page.locator('.performance-controls select').first()).toBeVisible()
    expect(await page.getByLabel('翻页方案', { exact: false }).count()).toBe(0)
    await expect(page.getByRole('button', { name: /退出演奏模式/ })).toBeVisible()

    // 1) The real app window.
    const native = await measureBoxes(page)
    expectClearLayout(native, `实机窗口 ${native.viewport.width}x${native.viewport.height}`)

    // 2) Viewport matrix. The OS window cannot be resized in every environment,
    // so pin the performance root to each size and re-measure the same geometry.
    const probe = await page.evaluateHandle(() => {
      const style = document.createElement('style')
      style.id = 'performance-viewport-probe'
      document.head.appendChild(style)
      return style
    })
    for (const size of [{ width: 1280, height: 720 }, { width: 1120, height: 720 }, { width: 1366, height: 768 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 }]) {
      await probe.evaluate((node, target) => {
        ;(node as HTMLStyleElement).textContent = `.performance{position:fixed!important;inset:auto!important;left:0!important;top:0!important;width:${target.width}px!important;height:${target.height}px!important}`
      }, size)
      await page.waitForTimeout(140)
      const measured = await measureBoxes(page)
      expect(measured.viewport.width).toBeCloseTo(size.width, 0)
      expectClearLayout(measured, `视口 ${size.width}x${size.height}`)
    }
    await probe.evaluate((node) => (node as HTMLStyleElement).remove())

    // The picker only earns its place once this score owns a saved profile.
    await page.locator('.performance-controls label', { hasText: '模式' }).locator('select').selectOption('rehearsal')
    await page.getByRole('button', { name: '开始记录' }).click()
    await page.getByRole('button', { name: '停止并保存' }).click()
    const picker = page.locator('.performance-controls label', { hasText: '翻页方案' }).locator('select')
    await expect(picker).toBeVisible()
    await expect(picker.locator('option').first()).toHaveText('临时方案（未保存）')
    expectClearLayout(await measureBoxes(page), '含已保存方案时')

    await page.screenshot({ path: 'runtime-data/qa/performance-controls-overlap.png' })
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
