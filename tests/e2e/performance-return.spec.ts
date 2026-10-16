import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Restricted CI / agent sandboxes launch Electron as a plain Node process and
// fail to boot the renderer, so those runs opt in to the usual Chromium escape
// hatches instead of weakening the default launch for normal machines.
const SANDBOXED = process.env.ARPEGGIO_E2E_SANDBOXED === '1'
const LAUNCH_ARGS = SANDBOXED ? ['.', '--no-sandbox', '--disable-gpu'] : ['.']

test('returning from performance mode restores the fitted score size', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'arpeggio-performance-return-'))
  const app = await electron.launch({ args: LAUNCH_ARGS, env: { ...process.env, ARPEGGIO_DATA_DIR: dataRoot, ARPEGGIO_DISABLE_COVER_LOOKUP: '1' } })
  try {
    const page = await app.firstWindow()
    await page.screenshot({ path: 'runtime-data/qa/publisher-library.png' })
    await page.getByRole('button', { name: '打开 红色高跟鞋 曲谱' }).click()
    await page.getByRole('button', { name: /打开曲谱/ }).click()
    await expect(page.locator('.book-spread')).toBeVisible()
    const geometry = () => page.evaluate(() => {
      const stage = document.querySelector('.paper-stage')!.getBoundingClientRect()
      const spread = document.querySelector('.book-spread')!.getBoundingClientRect()
      return { stageWidth: stage.width, stageHeight: stage.height, spreadWidth: spread.width, spreadHeight: spread.height }
    })
    await expect.poll(async () => (await geometry()).spreadHeight).toBeGreaterThan(400)
    const before = await geometry()
    expect(before.spreadHeight).toBeLessThanOrEqual(before.stageHeight)
    await page.getByRole('button', { name: '进入演奏模式' }).first().click()
    await expect(page.locator('.performance')).toBeVisible()
    await page.getByRole('button', { name: /退出演奏模式/ }).click()
    await expect(page.locator('.book-spread')).toBeVisible()
    await expect.poll(async () => {
      const after = await geometry()
      return after.spreadHeight / before.spreadHeight
    }).toBeGreaterThan(0.95)
    const after = await geometry()
    expect(after.spreadHeight / before.spreadHeight).toBeLessThan(1.05)
    expect(after.spreadWidth).toBeLessThanOrEqual(after.stageWidth)
    await page.locator('.score-extras summary').click()
    await page.getByRole('button', { name: '编辑演奏批注' }).click()
    await page.getByRole('textbox', { name: '演奏批注内容' }).fill('第二段放轻右手。')
    await page.getByRole('button', { name: '保存批注' }).click()
    await expect(page.locator('.score-extras .notes')).toHaveText('第二段放轻右手。')
    await page.locator('.score-extras summary').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'runtime-data/qa/publisher-reader-after-performance.png' })
  } finally {
    await app.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
