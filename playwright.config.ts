import { defineConfig } from '@playwright/test'

// Every spec here launches its own Electron window. On a restricted agent
// sandbox — software rendering, no GPU, a single small machine — five of those
// at once is enough to push the longest specs past the 45s budget even though
// they pass comfortably on their own, which reads as a regression and is not
// one. Sandboxed runs therefore go serial; a normal desktop run keeps
// Playwright's default parallelism.
const SANDBOXED = process.env.ARPEGGIO_E2E_SANDBOXED === '1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  workers: SANDBOXED ? 1 : undefined,
  use: { trace: 'retain-on-failure' },
  reporter: [['list']]
})
