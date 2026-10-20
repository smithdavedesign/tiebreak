// Shared by the browser test files: Chromium's path, and the dev server tests/dev-server.ts starts once per run.
import type { Page } from 'playwright-core'
import { expect, inject } from 'vitest'

/** A Chromium or Chrome binary; no browser is downloaded. Browser tests skip without it. */
export const CHROMIUM = process.env.CHROMIUM_PATH

/** The shared dev server's URL, once it answers. */
export async function appBase(): Promise<string> {
  const base = inject('devServer')
  if (!base) throw new Error('No dev server: tests/dev-server.ts starts one when CHROMIUM_PATH is set.')
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base)).ok) return base
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The dev server did not answer on ${base}. Is another next dev running in this directory?`)
}

/** The page fits its viewport: nothing sticks out sideways (390 px on a phone). */
export async function noSidewaysScroll(page: Page) {
  const width = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
}
