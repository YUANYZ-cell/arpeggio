import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.backup` holds timestamped copies of files taken before a change, and a
    // copied `*.spec.ts` is a real test file as far as the collector is
    // concerned — it would run the pre-change suite against the post-change
    // source. Excluding the directory keeps every backup faithful, including
    // the spec files, instead of asking the backup to rename them.
    exclude: ['tests/e2e/**', 'node_modules/**', 'out/**', 'release/**', '.backup/**']
  }
})
