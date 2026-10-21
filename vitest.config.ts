import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

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
      { extends: true, test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: [...configDefaults.exclude, BROWSER_TESTS] } },
      // Each browser test file starts its own `next dev`, and Next allows one per project directory at a time
      // (.next/dev/lock), so these run one file after another, alongside the unit tests.
      { extends: true, test: { name: 'browser', include: [BROWSER_TESTS], fileParallelism: false } },
    ],
  },
})
