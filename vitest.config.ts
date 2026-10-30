import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Feeds start empty; tests/house.test.ts turns house polls on where it needs them.
    env: { HOUSE_POLLS: 'off' },
    // The browser tests' shared dev server, started only when CHROMIUM_PATH is set.
    globalSetup: ['tests/browser-app.ts'],
    // PGlite boots a WASM Postgres per test file; with every file booting at once (and the browser tests'
    // dev server compiling), a boot can take over 30 s on a busy machine.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
