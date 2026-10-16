import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArchiveStore } from '../../src/main/archive-store'

// Restricted CI / agent sandboxes launch Electron as a plain Node process and
// fail to boot the renderer, so those runs opt in to the usual Chromium escape
// hatches instead of weakening the default launch for normal machines.
const SANDBOXED = process.env.ARPEGGIO_E2E_SANDBOXED === '1'
const LAUNCH_ARGS = SANDBOXED ? ['.', '--no-sandbox', '--disable-gpu'] : ['.']

test('shows a score imported by another process without restarting the open window', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-e2e-external-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' })).toBeVisible({ timeout: 15000 })
    const source = join(dataRoot, 'external-page.jpg')
    await writeFile(source, Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4]))
    const importer = await ArchiveStore.open(dataRoot, async () => null)
    await importer.importScore([source], { title: '外部入库曲目', artist: '测试', guitarType: 'acoustic', scoreType: '弹唱谱' })

    await expect(page.getByRole('button', { name: '打开 外部入库曲目 曲谱' })).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /全部曲谱 2/ })).toBeVisible()
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('opens seeded score, turns pages, searches, and enters performance mode', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-e2e-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '所有歌曲' })).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('搜索曲名、艺术家、标签、调弦…')).toBeFocused()
    await expect(page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' })).toBeVisible()
    await expect(page.locator('.song-card .cover-fallback')).toContainText('红色高跟鞋')
    await page.waitForTimeout(550)
    await page.screenshot({ path: 'runtime-data/qa/library.png', fullPage: true })
    await expect(page.getByRole('heading', { name: '红色高跟鞋' })).toHaveCount(0)
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await expect(page.getByRole('heading', { name: '红色高跟鞋' })).toBeVisible()
    await expect(page.getByText('Score No. AC-0001', { exact: true })).toBeVisible()
    await expect(page.locator('.detail-facts')).toContainText('曲谱页数4 页')
    await expect(page.locator('.detail-facts').getByText('Standard · E A D G B E', { exact: true })).toBeVisible()
    await expect(page.getByText('第 2 品', { exact: true })).toBeVisible()
    await expect(page.locator('.score-preview img')).toHaveAttribute('alt', '红色高跟鞋 曲谱首页预览')
    await page.screenshot({ path: 'runtime-data/qa/detail.png', fullPage: true })
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await page.getByRole('button', { name: '单页', exact: true }).click()
    await expect(page.getByRole('button', { name: '单页', exact: true })).toHaveClass(/active/)
    await expect(page.locator('.book-spread')).toHaveCount(0)
    await expect(page.locator('.page-spread > .paper')).toHaveCount(1)
    await page.screenshot({ path: 'runtime-data/qa/reader-single.png', fullPage: true })
    await page.getByRole('button', { name: '双页', exact: true }).click()
    await expect(page.getByRole('button', { name: '双页', exact: true })).toHaveClass(/active/)
    await expect(page.locator('.book-spread')).toBeVisible()
    const paperWidth = await page.locator('.paper').first().evaluate((element) => element.getBoundingClientRect().width)
    const stageWidth = await page.locator('.paper-stage').evaluate((element) => element.getBoundingClientRect().width)
    expect(paperWidth).toBeLessThanOrEqual(762)
    expect(paperWidth).toBeLessThan(stageWidth - 80)
    await expect(page.getByRole('button', { name: '整页' })).toHaveClass(/active/)
    await expect.poll(async () => page.locator('.paper img').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    const fullPage = await page.locator('.paper').first().evaluate((paper) => {
      const sheet = paper.getBoundingClientRect()
      const stage = paper.closest('.paper-stage')!.getBoundingClientRect()
      return { sheetTop: sheet.top, sheetBottom: sheet.bottom, stageTop: stage.top, stageBottom: stage.bottom }
    })
    expect(fullPage.sheetTop).toBeGreaterThanOrEqual(fullPage.stageTop)
    expect(fullPage.sheetBottom).toBeLessThanOrEqual(fullPage.stageBottom)
    const initialViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect.poll(async () => page.locator('.paper').first().evaluate((paper) => {
      const sheet = paper.getBoundingClientRect()
      const stage = paper.closest('.paper-stage')!.getBoundingClientRect()
      return sheet.top >= stage.top && sheet.bottom <= stage.bottom
    })).toBe(true)
    await page.getByRole('button', { name: '适合宽度' }).click()
    await expect(page.getByRole('button', { name: '适合宽度' })).toHaveClass(/active/)
    await page.getByRole('button', { name: '整页' }).click()
    await page.setViewportSize(initialViewport)
    await expect(page.getByText('演奏', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '加入收藏' }).click()
    await expect(page.getByRole('status')).toHaveText('♪已加入收藏')
    await page.screenshot({ path: 'runtime-data/qa/reader-main.png', fullPage: true })

    await page.locator('.viewer-toolbar button').nth(1).click()
    await expect(page.locator('.viewer-toolbar')).toContainText('2–3 / 4')
    await page.getByTitle('为当前页添加书签').click()
    await expect(page.locator('.bookmark-line')).toContainText('第 2 页')
    await expect(page.getByRole('status')).toContainText('已收藏第 2 页')

    await page.getByRole('button', { name: '返回详情' }).click()
    await page.getByRole('button', { name: '返回曲库' }).click()
    await page.getByRole('button', { name: '设置' }).click()
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
    await page.getByRole('button', { name: '演奏模式', exact: true }).click()
    await page.locator('.settings-content select').first().selectOption('10')
    await page.getByRole('button', { name: '保存设置' }).click()

    await page.getByRole('button', { name: /演出曲单/ }).click()
    await page.getByPlaceholder('新曲单名称').fill('周五排练')
    await page.getByPlaceholder('新曲单名称').press('Enter')
    await page.locator('.setlist-scores input[type="checkbox"]').check()
    await page.getByRole('button', { name: '保存曲单' }).click()
    await expect(page.getByRole('button', { name: /演出曲单 1/ })).toBeVisible()
    await page.getByPlaceholder('搜索曲名、艺术家、标签、调弦…').fill('不存在的曲谱')
    await expect(page.getByText('这里还没有歌曲')).toBeVisible()
    await page.getByPlaceholder('搜索曲名、艺术家、标签、调弦…').fill('蔡健雅')
    await expect(page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' })).toBeVisible()
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await page.getByRole('button', { name: /打开曲谱/ }).click()

    await page.getByRole('button', { name: /进入演奏模式/ }).click()
    await expect(page.getByText('Performance Mode', { exact: true })).toBeVisible()
    // The stage opens as a spread, so it reports the range it shows. The reader
    // was left on sheet 2, and the stage pairs from sheet 1, so the label is
    // 1–2 rather than 2.
    await expect(page.getByText('1–2 / 4', { exact: true })).toBeVisible()
    await expect(page.locator('.performance-controls label').filter({ hasText: '每页' }).locator('select')).toHaveValue('10')
    await page.locator('.performance-controls label').filter({ hasText: '模式' }).locator('select').selectOption('per-page')
    await expect(page.getByRole('textbox', { name: '逐页时长', exact: true })).toBeVisible()
    await page.locator('.performance-controls label').filter({ hasText: '模式' }).locator('select').selectOption('timeline')
    await expect(page.getByRole('textbox', { name: '翻页时间轴', exact: true })).toBeVisible()
    await page.locator('.performance-controls label').filter({ hasText: '模式' }).locator('select').selectOption('rehearsal')
    await page.getByRole('button', { name: '开始记录' }).click()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: '停止并保存' }).click()
    // Regression: this used to look for a `.performance-top` element, a name the
    // control rail no longer uses, so the assertion could never pass.
    await expect(page.locator('.performance-controls label', { hasText: '翻页方案' }).locator('select')).toContainText('排练记录 1')
    await page.screenshot({ path: 'runtime-data/qa/performance.png', fullPage: true })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: '红色高跟鞋' })).toBeVisible()
    await expect(page.locator('.reader-counter')).toHaveText('2–3 / 4')
    await page.getByRole('button', { name: '返回详情' }).click()
    await page.getByRole('button', { name: '返回曲库' }).click()
    await expect(page.getByRole('heading', { name: /蔡健雅.*结果/ })).toBeVisible()
    await page.getByRole('button', { name: '录入曲谱' }).click()
    await expect(page.getByRole('textbox', { name: '调弦设置' })).toHaveValue('Standard (E A D G B E)')
    await expect(page.getByText('留空即不夹变调夹', { exact: true })).toBeVisible()
    await expect(page.getByText('有特殊调弦时，写明六根弦由 6 弦到 1 弦的音高，例如 D A D G B E（Drop D）', { exact: true })).toBeVisible()
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
