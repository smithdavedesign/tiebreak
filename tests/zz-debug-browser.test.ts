// Criterion 5 in rendered HTML (GROWTH.md 2026-11-08): the shared dev server (tests/browser-app.ts), run with no site
// address set, as `npm run cf:build` builds the Worker, renders every page with exactly one canonical link on the
// Workers host. Every indexable page names its own address, and the sitemap lists those pages on that host. A poll
// page names its own address without its ?ref= tag and stays noindex. A missing poll and an unknown address are
// noindex 404s that name the home page. The same checks run on the live Workers site in tests/live-site.test.ts
// (opt-in). The metadata behind them is unit-tested in tests/workers-canonical.test.ts.
//
// The file's name is left over from debugging tests/workers-move-browser.test.ts: the build sandbox could neither
// delete nor rename it. Rename it freely (to tests/workers-canonical-browser.test.ts).
//
// Runs only with CHROMIUM_PATH set, since the shared dev server starts only then.
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { PUBLIC_PAGES } from '@/lib/site'
import { WORKERS_URL } from './workers-move'

/** Every <link rel="canonical"> href in a page's HTML. */
const canonicalLinks = (html: string) =>
  [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map((tag) => tag[0].match(/\bhref="([^"]*)"/)?.[1] ?? '')
const robotsMeta = (html: string) => html.match(/<meta\b[^>]*\bname="robots"[^>]*\bcontent="([^"]*)"/)?.[1] ?? ''

describe.skipIf(!process.env.CHROMIUM_PATH)('criterion 5: canonical links in the HTML the app serves', () => {
  const base = inject('appBase')

  beforeAll(async () => {
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([...PUBLIC_PAGES, '/p/AAAAAAAAAAAA', '/no-such-page', '/sitemap.xml', '/robots.txt'].map((path) => fetch(base + path)))
  }, 240_000)

  it('every indexable page has one canonical link, its own address on the Workers host', { timeout: 180_000 }, async () => {
    for (const path of PUBLIC_PAGES) {
      const res = await fetch(base + path)
      expect(res.status, path).toBe(200)
      const html = await res.text()
      expect(canonicalLinks(html).map((href) => new URL(href).href), path).toEqual([new URL(path, WORKERS_URL).href])
      expect(robotsMeta(html), path).not.toMatch(/noindex/)
    }
  })

  it('the sitemap lists exactly those pages on the Workers host, and robots.txt points at it', { timeout: 60_000 }, async () => {
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text()
    const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => new URL(m[1]).href)
    expect(listed).toEqual(PUBLIC_PAGES.map((path) => new URL(path, WORKERS_URL).href))
    expect(await (await fetch(`${base}/robots.txt`)).text()).toContain(`Sitemap: ${WORKERS_URL}/sitemap.xml`)
  })

  it('a poll page has one canonical link, its own address on the Workers host without its tag, and is noindex', { timeout: 120_000 }, async () => {
    const created = await fetch(`${base}/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Speckled mug or white mug?', options: ['Speckled', 'White'], target: 3, durationHours: 24 }),
    })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    for (const path of [`/p/${id}`, `/p/${id}?ref=old-link`]) {
      const res = await fetch(base + path)
      expect(res.status, path).toBe(200)
      const html = await res.text()
      expect(canonicalLinks(html), path).toEqual([`${WORKERS_URL}/p/${id}`])
      expect(robotsMeta(html), path).toMatch(/noindex/)
    }
  })

  it('a missing poll and an unknown address are noindex 404s with one canonical link, the home page on the Workers host', { timeout: 120_000 }, async () => {
    for (const path of ['/p/AAAAAAAAAAAA', '/no-such-page', '/tools/no-such-tool?ref=x']) {
      const res = await fetch(base + path)
      expect(res.status, path).toBe(404)
      const html = await res.text()
      expect(canonicalLinks(html).map((href) => new URL(href).href), path).toEqual([`${WORKERS_URL}/`])
      expect(robotsMeta(html), path).toMatch(/noindex/)
      expect(html, path).toContain('Nothing here')
    }
  })
})
