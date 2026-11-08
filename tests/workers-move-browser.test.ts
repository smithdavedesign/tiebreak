// The move off Vercel in a real browser, offline (GROWTH.md 2026-11-08). Chromium (playwright-core) at desktop size
// (1280×800) and phone size (iPhone 13, 390 px wide) follows old links on the Vercel address. That address answers
// the way vercel.json makes it (tests/workers-move.ts models Vercel's routing), and the browser opens the Location it
// gives, as a browser does with a 308. The Workers address is played by the shared dev server (tests/browser-app.ts),
// run with no site address set, as `npm run cf:build` builds the Worker, so the page really runs on
// https://tiebreak.1426davejobs.workers.dev (visitWorkersFrom in tests/workers-move.ts).
//
// Checks: criterion 1 (each old link lands on the same path and query on Workers), criterion 4 (exactly one visit
// beacon per page load, sent from a page on the workers.dev host), and, on the pages it lands on, criterion 5 (each
// page's one canonical link is its own address on the Workers host; a poll page's drops its tag and stays noindex). Every page's HTML is
// checked in tests/zz-debug-browser.test.ts. Nothing leaves the machine: RepoHQ's signal endpoint is answered here,
// and any other host is refused. tests/live-site.test.ts runs criterion 4 against the real Workers site and the real
// endpoint (opt-in).
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it.
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { SIGNAL_URL } from '@/lib/site'
import { VERCEL_URL, WORKERS_URL, vercelAnswer, vercelConfig, visitWorkersFrom, workersTwin, type Signal } from './workers-move'

const CHROMIUM = process.env.CHROMIUM_PATH
const SIZES: Record<'desktop' | 'phone', BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { ...devices['iPhone 13'] },
}
const sizes = Object.keys(SIZES) as (keyof typeof SIZES)[]
const WIDTHS = { desktop: 1280, phone: 390 }
const WORKERS_HOST = new URL(WORKERS_URL).host

/** The hrefs of a page's <link rel="canonical"> elements, and its robots meta. */
const canonicalLinks = (page: Page) => page.locator('link[rel="canonical"]').evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href))
const robotsMeta = (page: Page) => page.locator('meta[name="robots"]').evaluateAll((metas) => metas.map((m) => (m as HTMLMetaElement).content))

describe.skipIf(!CHROMIUM)('old links in Chromium: through vercel.json’s redirect to the Workers site, counted once', () => {
  let browser: Browser | undefined
  const base = inject('appBase')
  const config = vercelConfig()

  async function newPoll(question: string) {
    const res = await fetch(`${base}/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, options: ['Speckled blue glaze', 'Matte white'], target: 3, durationHours: 24 }),
    })
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all(['/', '/p/AAAAAAAAAAAA'].map((path) => fetch(base + path)))
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  async function visitor(size: keyof typeof SIZES) {
    const context = await browser!.newContext(SIZES[size])
    const signals = await visitWorkersFrom(context, base, SIGNAL_URL)
    return { context, page: await context.newPage(), signals }
  }

  /** An old link, followed: Vercel's answer under vercel.json must be a 308 to its twin on Workers, which the page opens. */
  async function follow(page: Page, oldLink: string, referer?: string) {
    const answer = vercelAnswer(config, oldLink)
    expect(answer).toEqual({ status: 308, location: workersTwin(oldLink) })
    return page.goto(answer!.location, { referer })
  }

  /** Waits for the page load's visit, then a while longer, so a second one would be seen. */
  async function visitsOf(signals: Signal[]) {
    await expect.poll(() => signals.length, { timeout: 30_000 }).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    return signals
  }

  it.each(sizes)('%s: the old home page link lands on Workers, which sends exactly one visit, from its own host', { timeout: 120_000 }, async (size) => {
    const { context, page, signals } = await visitor(size)
    const response = await follow(page, `${VERCEL_URL}/`)
    expect(page.viewportSize()?.width).toBe(WIDTHS[size])

    expect(response?.url()).toBe(`${WORKERS_URL}/`)
    expect(response?.status()).toBe(200)
    await page.getByRole('heading', { level: 1 }).waitFor()

    const visits = await visitsOf(signals)
    expect(visits).toHaveLength(1)
    expect(visits[0].body).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null })
    expect(new URL(visits[0].pageUrl).host).toBe(WORKERS_HOST)
    expect(visits[0].origin).toBe(WORKERS_URL)

    expect(await canonicalLinks(page)).toEqual([`${WORKERS_URL}/`])
    await context.close()
  })

  it.each(sizes)('%s: an old share link clicked on Reddit keeps its path, tag and referrer, in its one visit', { timeout: 120_000 }, async (size) => {
    const id = await newPoll('Which mug photo should lead my listing?')
    const { context, page, signals } = await visitor(size)
    const response = await follow(page, `${VERCEL_URL}/p/${id}?ref=old-link`, 'https://www.reddit.com/')

    expect(response?.url()).toBe(`${WORKERS_URL}/p/${id}?ref=old-link`)
    expect(response?.status()).toBe(200)
    await page.getByText('Which mug photo should lead my listing?').first().waitFor()

    const visits = await visitsOf(signals)
    expect(visits).toHaveLength(1)
    expect(visits[0].body).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.reddit.com/', ref: 'old-link' })
    expect(new URL(visits[0].pageUrl).host).toBe(WORKERS_HOST)

    expect(await canonicalLinks(page)).toEqual([`${WORKERS_URL}/p/${id}`])
    expect(await robotsMeta(page)).toEqual(['noindex, nofollow'])
    await context.close()
  })
})
