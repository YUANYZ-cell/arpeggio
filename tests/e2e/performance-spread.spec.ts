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

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number }
type SheetBox = { box: Box; image: Box | null; natural: { width: number; height: number } | null; alt: string | null; blank: boolean }
type Measured = {
  root: Box
  stage: Box
  rail: Box
  scroll: { stage: { width: number; client: number }; root: { width: number; client: number } }
  sheets: SheetBox[]
}

async function measureSpread(target: import('@playwright/test').Page): Promise<Measured> {
  return target.evaluate(() => {
    const rectOf = (element: Element): Box => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
    }
    const stage = document.querySelector<HTMLElement>('.performance-stage')!
    const root = document.querySelector<HTMLElement>('.performance')!
    const sheets = [...document.querySelectorAll<HTMLElement>('.performance-sheet')].map((sheet) => {
      const image = sheet.querySelector('img')
      return {
        box: rectOf(sheet),
        image: image ? rectOf(image) : null,
        natural: image ? { width: image.naturalWidth, height: image.naturalHeight } : null,
        alt: image?.getAttribute('alt') ?? null,
        blank: sheet.classList.contains('blank')
      }
    })
    return {
      root: rectOf(root),
      stage: rectOf(stage),
      rail: rectOf(document.querySelector<HTMLElement>('.performance-controls')!),
      scroll: {
        stage: { width: stage.scrollWidth, client: stage.clientWidth },
        root: { width: root.scrollWidth, client: root.clientWidth }
      },
      sheets
    }
  })
}

/**
 * The stand must show two complete sheets: side by side, the same size, nothing
 * clipped, and nothing to scroll to.
 */
function expectSpreadFits(measured: Measured, label: string) {
  const { stage, rail, root, sheets } = measured
  expect(sheets.length, `${label} 摊开应有两页`).toBe(2)
  const [left, right] = sheets

  // Same size, same baseline: the pair reads as one stand, not two loose sheets.
  expect(Math.abs(left.box.width - right.box.width), `${label} 两页宽度不一致`).toBeLessThanOrEqual(GAP_TOLERANCE)
  expect(Math.abs(left.box.height - right.box.height), `${label} 两页高度不一致`).toBeLessThanOrEqual(GAP_TOLERANCE)
  expect(Math.abs(left.box.top - right.box.top), `${label} 两页顶部未对齐`).toBeLessThanOrEqual(GAP_TOLERANCE)
  // Side by side, never overlapping.
  expect(right.box.left, `${label} 两页重叠`).toBeGreaterThanOrEqual(left.box.right - GAP_TOLERANCE)

  for (const [index, sheet] of sheets.entries()) {
    const side = index === 0 ? '左页' : '右页'
    // Fully inside the stage on both axes — that is what "not cropped" means.
    expect(sheet.box.left, `${label} ${side}超出左边界`).toBeGreaterThanOrEqual(stage.left - GAP_TOLERANCE)
    expect(sheet.box.right, `${label} ${side}超出右边界`).toBeLessThanOrEqual(stage.right + GAP_TOLERANCE)
    expect(sheet.box.top, `${label} ${side}超出上边界`).toBeGreaterThanOrEqual(stage.top - GAP_TOLERANCE)
    expect(sheet.box.bottom, `${label} ${side}超出下边界`).toBeLessThanOrEqual(stage.bottom + GAP_TOLERANCE)
    // And inside the window itself.
    expect(sheet.box.right, `${label} ${side}超出窗口`).toBeLessThanOrEqual(root.width + GAP_TOLERANCE)
    if (sheet.blank) continue
    // The frame shares the scan's aspect ratio, so the stave is neither
    // letterboxed into a wrong-shaped box nor stretched.
    const frameAspect = sheet.box.width / sheet.box.height
    const scanAspect = sheet.natural!.width / sheet.natural!.height
    expect(Math.abs(frameAspect / scanAspect - 1), `${label} ${side}比例失调`).toBeLessThan(0.01)
    // And the scan really painted (a zero-naturalWidth image would pass the
    // ratio check by coincidence while showing nothing).
    expect(sheet.natural!.width, `${label} ${side}未加载`).toBeGreaterThan(0)
    expect(sheet.image!.width, `${label} ${side}未渲染`).toBeGreaterThan(0)
  }

  // No horizontal scroll anywhere: neither the stage nor the window.
  expect(measured.scroll.stage.width, `${label} 谱面区出现横向滚动`).toBeLessThanOrEqual(measured.scroll.stage.client + GAP_TOLERANCE)
  expect(measured.scroll.root.width, `${label} 窗口出现横向滚动`).toBeLessThanOrEqual(measured.scroll.root.client + GAP_TOLERANCE)

  // The control rail stays beside the score, never on top of it.
  expect(stage.right, `${label} 控制栏压住谱面`).toBeLessThanOrEqual(rail.left + GAP_TOLERANCE)
  expect(rail.right, `${label} 控制栏超出右边界`).toBeLessThanOrEqual(root.width + GAP_TOLERANCE)

  // A stand that fills neither axis wastes the screen the score was given.
  const innerWidth = stage.width - STAGE_PADDING * 2
  const innerHeight = stage.height - STAGE_PADDING * 2
  if (!right.blank) {
    const span = right.box.right - left.box.left
    const filled = span >= innerWidth - GAP_TOLERANCE * 2 || left.box.height >= innerHeight - GAP_TOLERANCE * 2
    expect(filled, `${label} 摊开未铺满视口（宽 ${Math.round(span)}/${Math.round(innerWidth)}，高 ${Math.round(left.box.height)}/${Math.round(innerHeight)}）`).toBe(true)
  }
}

test('performance mode shows two facing sheets, whole, without scrolling', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-spread-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await expect(page.locator('.book-spread')).toBeVisible()
    await page.getByRole('button', { name: '进入演奏模式' }).first().click()
    await expect(page.locator('.performance')).toBeVisible()
    await expect(page.locator('.performance-spread')).toBeVisible()
    await expect.poll(async () => page.locator('.performance-sheet img').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await page.waitForTimeout(150)

    // Both facing sheets are on screen at once, in reading order.
    await expect(page.locator('.performance-sheet')).toHaveCount(2)
    await expect(page.locator('.performance-sheet img').nth(0)).toHaveAttribute('alt', '红色高跟鞋 第 1 页')
    await expect(page.locator('.performance-sheet img').nth(1)).toHaveAttribute('alt', '红色高跟鞋 第 2 页')
    await expect(page.locator('.page-indicator')).toHaveText('1–2 / 4')

    expectSpreadFits(await measureSpread(page), '实机窗口双页')

    // A viewport matrix, because the OS window cannot be resized everywhere.
    // The spread has to hold at each of these, including the smallest.
    const probe = await page.evaluateHandle(() => {
      const style = document.createElement('style')
      style.id = 'spread-viewport-probe'
      document.head.appendChild(style)
      return style
    })
    for (const size of [{ width: 1120, height: 720 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 }]) {
      await probe.evaluate((node, target) => {
        ;(node as HTMLStyleElement).textContent = `.performance{position:fixed!important;inset:auto!important;left:0!important;top:0!important;width:${target.width}px!important;height:${target.height}px!important}`
      }, size)
      await page.waitForTimeout(150)
      const measured = await measureSpread(page)
      expect(measured.root.width).toBeCloseTo(size.width, 0)
      expectSpreadFits(measured, `视口 ${size.width}x${size.height}`)
      // Keep the largest probe as the readable-size evidence.
      if (size.width === 1920) await page.screenshot({ path: 'runtime-data/qa/performance-spread-1080p.png' })
    }
    await probe.evaluate((node) => (node as HTMLStyleElement).remove())

    // Turning moves a whole spread, so both sheets give way together.
    await page.getByRole('button', { name: '下一页' }).click()
    await expect(page.locator('.page-indicator')).toHaveText('3–4 / 4')
    await expect(page.locator('.performance-sheet img').nth(0)).toHaveAttribute('alt', '红色高跟鞋 第 3 页')
    await expect(page.locator('.performance-sheet img').nth(1)).toHaveAttribute('alt', '红色高跟鞋 第 4 页')
    await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled()
    await page.getByRole('button', { name: '上一页' }).click()
    await expect(page.locator('.page-indicator')).toHaveText('1–2 / 4')

    // The keyboard drives the same stride: one press, one spread.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.page-indicator')).toHaveText('3–4 / 4')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.page-indicator')).toHaveText('1–2 / 4')

    await page.screenshot({ path: 'runtime-data/qa/performance-spread.png' })
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('a single-sheet score keeps the stand, and single view still works', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-spread-odd-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    // One sheet: the odd score whose spread has an empty right half.
    const source = join(process.cwd(), 'resources', 'seed-library', 'Library', 'Acoustic', 'AC-0001', 'page-01.jpg')
    await page.evaluate(async (path) => {
      await window.arpeggio.importScore([path], { title: '单页练习曲', artist: '测试艺术家', guitarType: 'acoustic', scoreType: '弹唱谱' })
    }, source)
    await page.reload()
    await page.getByRole('button', { name: '打开 单页练习曲 曲谱' }).click()
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await page.getByRole('button', { name: '进入演奏模式' }).first().click()
    await expect(page.locator('.performance')).toBeVisible()
    await expect(page.locator('.performance-sheet.blank')).toHaveCount(1)

    // The only sheet still sits on the left half, so the stand never recentres
    // between spreads and the score does not jump around.
    const measured = await measureSpread(page)
    expect(measured.sheets[0].blank).toBe(false)
    expect(measured.sheets[1].blank).toBe(true)
    expect(measured.sheets[0].box.left).toBeGreaterThanOrEqual(measured.stage.left - GAP_TOLERANCE)
    expect(measured.sheets[0].box.right).toBeLessThanOrEqual(measured.stage.right + GAP_TOLERANCE)
    // Nothing to turn.
    await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '上一页' })).toBeDisabled()

    // Switching to a single sheet swaps the layout without leaving the stand.
    await page.locator('.performance-controls label', { hasText: '版面' }).locator('select').selectOption('single')
    await expect(page.locator('.performance-spread')).toHaveCount(0)
    await expect(page.locator('.performance-page img')).toHaveAttribute('alt', '单页练习曲 第 1 页')
    await expect(page.locator('.page-indicator')).toHaveText('1 / 1')
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
