import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // One dev server for every browser test file (only with CHROMIUM_PATH): Next allows one per directory.
    globalSetup: ['tests/dev-server.ts'],
    // Feeds start empty; tests/house.test.ts turns house polls on where it needs them.
    env: { HOUSE_POLLS: 'off' },
    // PGlite boots a WASM Postgres per test file.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
