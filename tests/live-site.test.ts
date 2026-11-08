// The move off Vercel, checked on the real sites and on GitHub (GROWTH.md 2026-11-08). Opt-in, since it needs the
// network and sends real requests; without its variables every test here is skipped:
//   LIVE_SITE=1 npx vitest run tests/live-site.test.ts      criteria 1, 3 (Workers answers 200) and 5;
//                                                           with CHROMIUM_PATH set too, criterion 4
//   PR_NUMBER=<n> npx vitest run tests/live-site.test.ts    criteria 2 and 3 on the PR: its check runs and its files
// Run the first after the merge's production deploy on Vercel (a preview deploy doesn't change tiebreak-phi.vercel.app).
// GITHUB_TOKEN, if set, goes to api.github.com only (the repo is public, but GitHub allows 60 requests an hour without
// one); GITHUB_REPOSITORY picks another repo; LIVE_WAIT_MINUTES (default 15) is how long to wait for the PR's checks.
// Criterion 4 sends 2 real visits to RepoHQ, tagged `ref: "live-check"` so the weekly count can leave them out.
import { chromium, devices, type Browser, type BrowserContextOptions, type Request } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PUBLIC_PAGES, SIGNAL_URL } from '@/lib/site'
import { VERCEL_URL, WORKERS_URL, inScope, workersTwin } from './workers-move'

const LIVE = !!process.env.LIVE_SITE
const PR = process.env.PR_NUMBER
const CHROMIUM = process.env.CHROMIUM_PATH
const REPO = process.env.GITHUB_REPOSITORY || 'smithdavedesign/tiebreak'
const WAIT_MS = Number(process.env.LIVE_WAIT_MINUTES || 15) * 60_000
const WORKERS_HOST = new URL(WORKERS_URL).host

const canonicalLinks = (html: string) =>
  [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map((tag) => tag[0].match(/\bhref="([^"]*)"/)?.[1] ?? '')
const robotsMeta = (html: string) => html.match(/<meta\b[^>]*\bname="robots"[^>]*\bcontent="([^"]*)"/)?.[1] ?? ''
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!LIVE)('the live sites', () => {
  it.each([`${VERCEL_URL}/`, `${VERCEL_URL}/polls/abc123`, `${VERCEL_URL}/polls/abc123?src=x`])(
    'criterion 1: HEAD %s is a 301 or 308 to the same path and query on Workers',
    { timeout: 30_000 },
    async (url) => {
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual' })
      expect([301, 308]).toContain(res.status)
      expect(res.headers.get('location')).toBe(workersTwin(url))
    },
  )

  it('criterion 1: following the old home page link ends on the Workers home page', { timeout: 30_000 }, async () => {
    const res = await fetch(`${VERCEL_URL}/`)
    expect(res.url).toBe(`${WORKERS_URL}/`)
    expect(res.status).toBe(200)
  })

  it('criterion 3: the Workers deploy of main answers 200 on /', { timeout: 30_000 }, async () => {
    expect((await fetch(`${WORKERS_URL}/`, { redirect: 'manual' })).status).toBe(200)
  })

  it('criterion 5: the sitemap lists the indexable pages on the Workers host, and each names itself there', { timeout: 120_000 }, async () => {
    const sitemap = await (await fetch(`${WORKERS_URL}/sitemap.xml`)).text()
    const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => new URL(m[1]).href)
    expect(listed).toEqual(PUBLIC_PAGES.map((path) => new URL(path, WORKERS_URL).href))
    for (const url of listed) {
      const res = await fetch(url, { redirect: 'manual' })
      expect(res.status, url).toBe(200)
      const html = await res.text()
      expect(canonicalLinks(html).map((href) => new URL(href).href), url).toEqual([url])
    }
  })

  it('criterion 5: a poll page from the feed names itself on Workers without its tag, and stays out of search', { timeout: 60_000 }, async () => {
    const { polls } = (await (await fetch(`${WORKERS_URL}/polls`)).json()) as { polls: { id: string }[] }
    expect(polls.length).toBeGreaterThan(0)
    const res = await fetch(`${WORKERS_URL}/p/${polls[0].id}?ref=live-check`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(canonicalLinks(html).map((href) => new URL(href).href)).toEqual([`${WORKERS_URL}/p/${polls[0].id}`])
    expect(robotsMeta(html)).toMatch(/noindex/)
  })

  it('criterion 5: a missing poll and an unknown address are noindex 404s naming the Workers home page', { timeout: 60_000 }, async () => {
    for (const path of ['/p/AAAAAAAAAAAA', '/no-such-page']) {
      const res = await fetch(`${WORKERS_URL}${path}`)
      expect(res.status, path).toBe(404)
      const html = await res.text()
      expect(canonicalLinks(html).map((href) => new URL(href).href), path).toEqual([`${WORKERS_URL}/`])
      expect(robotsMeta(html), path).toMatch(/noindex/)
    }
  })

  describe.skipIf(!CHROMIUM)('criterion 4, in Chromium', () => {
    let browser: Browser | undefined
    const SIZES: Record<string, BrowserContextOptions> = {
      'desktop (1280 px)': { viewport: { width: 1280, height: 800 } },
      'phone (390 px)': { ...devices['iPhone 13'] },
    }

    beforeAll(async () => {
      browser = await chromium.launch({ executablePath: CHROMIUM })
    }, 60_000)

    afterAll(async () => {
      await browser?.close()
    })

    it.each(Object.keys(SIZES))('%s: one visit-beacon request per page load, answered 2xx, from a page on workers.dev', { timeout: 90_000 }, async (size) => {
      // A fresh browser (a new session), and a visitor's: automated browsers send no beacon.
      const context = await browser!.newContext(SIZES[size])
      await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
      const page = await context.newPage()
      const beacons: Request[] = []
      page.on('request', (request) => {
        if (request.url() === SIGNAL_URL) beacons.push(request)
      })
      const response = await page.goto(`${WORKERS_URL}/?ref=live-check`)
      expect(response?.status()).toBe(200)
      await expect.poll(() => beacons.length, { timeout: 30_000 }).toBeGreaterThan(0)
      await page.waitForTimeout(3000) // a second beacon for the same load would show by now
      expect(beacons).toHaveLength(1)

      const [beacon] = beacons
      expect(JSON.parse(beacon.postData() ?? 'null')).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'live-check' })
      expect(new URL(beacon.frame().url()).host).toBe(WORKERS_HOST)
      expect((await beacon.allHeaders()).origin).toBe(WORKERS_URL)
      const status = (await beacon.response())?.status() ?? 0
      expect(status).toBeGreaterThanOrEqual(200)
      expect(status).toBeLessThan(300)
      await context.close()
    })
  })
})

type CheckRun = { name: string; status: string; conclusion: string | null; app: { slug: string } | null }

/** GET from GitHub's REST API for this repo. The token, if any, goes in the header and nowhere else. */
async function github<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`)
  return (await res.json()) as T
}

describe.skipIf(!PR)(`pull request #${PR}`, () => {
  /** Vercel's deployment check (not its preview-comments one), and CI's web and mobile jobs. */
  const wanted = (runs: CheckRun[]) => ({
    vercel: runs.filter((run) => run.app?.slug === 'vercel' && !/comment/i.test(run.name)),
    web: runs.filter((run) => run.app?.slug === 'github-actions' && run.name === 'web'),
    mobile: runs.filter((run) => run.app?.slug === 'github-actions' && run.name === 'mobile'),
  })

  it("criterion 2: Vercel's check run, and CI's web and mobile checks, conclude 'success'", { timeout: WAIT_MS + 120_000 }, async () => {
    const { head } = await github<{ head: { sha: string } }>(`/pulls/${PR}`)
    const deadline = Date.now() + WAIT_MS
    let checks = wanted([])
    for (;;) {
      const { check_runs } = await github<{ check_runs: CheckRun[] }>(`/commits/${head.sha}/check-runs?per_page=100`)
      checks = wanted(check_runs)
      const all = Object.values(checks)
      if ((all.every((runs) => runs.length > 0) && all.flat().every((run) => run.status === 'completed')) || Date.now() > deadline) break
      await sleep(30_000)
    }
    for (const [name, runs] of Object.entries(checks)) {
      expect(runs.length, `${name}: no check run on ${head.sha}`).toBeGreaterThan(0)
      expect(runs.map((run) => `${run.name}: ${run.conclusion}`), name).toEqual(runs.map((run) => `${run.name}: success`))
    }
  })

  it('criterion 3: the PR changes only the Vercel config and tests (and the docs every growth PR updates)', { timeout: 60_000 }, async () => {
    const files: { filename: string; previous_filename?: string }[] = []
    for (let page = 1; ; page++) {
      const batch = await github<typeof files>(`/pulls/${PR}/files?per_page=100&page=${page}`)
      files.push(...batch)
      if (batch.length < 100) break
    }
    expect(files.length).toBeGreaterThan(0)
    const names = files.flatMap((file) => [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])])
    expect(names.filter((name) => !inScope(name))).toEqual([])
  })
})
