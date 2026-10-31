import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

// Browser tests each start `next dev`, which holds a lock on .next/ while it runs, so they
// go one file at a time, after the other tests (they're skipped without CHROMIUM_PATH).
const BROWSER_TESTS = 'tests/**/*-browser.test.ts'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Feeds start empty; tests/house.test.ts turns house polls on where it needs them.
    env: { HOUSE_POLLS: 'off' },
    // PGlite boots a WASM Postgres per test file.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: [...configDefaults.exclude, BROWSER_TESTS] },
      },
      {
        extends: true,
        test: { name: 'browser', include: [BROWSER_TESTS], fileParallelism: false, sequence: { groupOrder: 1 } },
      },
    ],
  },
})
