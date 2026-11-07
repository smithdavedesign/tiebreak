// Live checks of the Vercel → Workers redirect (growth, 2026-11-07), against the real sites and GitHub. They
// need the network and a deployed change, so `npm test` skips them; run them after the PR's Vercel deploy:
//
//   LIVE_SITE=1 npx vitest run tests/live-site.test.ts
//     the old address redirects (HEAD /, /polls/abc123, /polls/abc123?src=x → 301/308, same path and query on
//     Workers), Workers answers 200 on /, every page's canonical URL is on the Workers host (the public pages,
//     a poll from the live feed, and the 404 page); with CHROMIUM_PATH set, also one visit beacon per page load
//     at 1280 px and 390 px, answered 2xx.
//   PR_NUMBER=<n> npx vitest run tests/live-site.test.ts
//     the PR's Vercel check run and its web and mobile CI checks conclude 'success' (GitHub's checks API), and
//     its files leave the web app's source and mobile/ alone, but for the two pages' canonical URLs criterion 5
//     needs (CANONICAL_PAGE_FILES). GITHUB_TOKEN is used if set (rate limits).
//
// The beacon check sends 2 real visits to RepoHQ, tagged ref "live-check" so they can be told apart.
import { chromium, devices, type Browser, type BrowserContextOptions, type Request } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ISSUES_URL, PUBLIC_PAGES, SIGNAL_URL } from '@/lib/site'
import { VERCEL_URL, WORKERS_URL, canonicalOf, offLimitsChanges, packageJsonDrift } from './redirect-to-workers'

const LIVE = process.env.LIVE_SITE === '1'
const PR_NUMBER = process.env.PR_NUMBER
const CHROMIUM = process.env.CHROMIUM_PATH
const workersHost = new URL(WORKERS_URL).host
const LIVE_REF = 'live-check'

describe.runIf(LIVE)('the old Vercel address (live)', () => {
  it.each(['/', '/polls/abc123', '/polls/abc123?src=x'])(
    'HEAD %s → 301 or 308, Location on Workers with the same path and query',
    async (path) => {
      const res = await fetch(`${VERCEL_URL}${path}`, { method: 'HEAD', redirect: 'manual' })
      expect([301, 308]).toContain(res.status)
      const location = res.headers.get('location')
      expect(location).toBeTruthy()
      // An absolute URL; `https://host` and `https://host/` are the same address for `/`.
      expect(new URL(location!).href).toBe(new URL(`${WORKERS_URL}${path}`).href)
      if (path !== '/') expect(location).toBe(`${WORKERS_URL}${path}`)
    },
  )
})

describe.runIf(LIVE)('the Workers site (live)', () => {
  it('answers 200 on /', async () => {
    const res = await fetch(`${WORKERS_URL}/`, { redirect: 'manual' })
    expect(res.status).toBe(200)
  })

  it.each([...PUBLIC_PAGES])('%s has a <link rel="canonical"> on the Workers host, at its own path', async (path) => {
    const res = await fetch(`${WORKERS_URL}${path}`, { redirect: 'manual' })
    expect(res.status).toBe(200)
    const href = canonicalOf(await res.text())
    expect(href).toBeTruthy()
    const canonical = new URL(href!)
    expect(canonical.protocol).toBe('https:')
    expect(canonical.host).toBe(workersHost)
    expect(canonical.pathname).toBe(path)
  })

  it("a poll's share link has a <link rel=\"canonical\"> on the Workers host, at the poll's own address", async () => {
    // A poll that's live now: the first on the public feed (the house polls keep it stocked).
    const { polls } = (await (await fetch(`${WORKERS_URL}/polls`)).json()) as { polls: { id: string }[] }
    expect(polls.length, 'a poll on the live feed').toBeGreaterThan(0)
    const { id } = polls[0]
    const res = await fetch(`${WORKERS_URL}/p/${id}?ref=${LIVE_REF}`, { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(canonicalOf(await res.text())).toBe(`${WORKERS_URL}/p/${id}`)
  })

  it.each(['/p/AAAAAAAAAAAA', '/no-such-page'])('the 404 page (%s) has a <link rel="canonical"> on the Workers host', async (path) => {
    const res = await fetch(`${WORKERS_URL}${path}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
    const href = canonicalOf(await res.text())
    expect(href).toBeTruthy()
    const canonical = new URL(href!)
    expect(canonical.protocol).toBe('https:')
    expect(canonical.host).toBe(workersHost)
    expect(canonical.pathname).toBe('/')
  })

  it('robots.txt and sitemap.xml point at the Workers host', async () => {
    const robots = await (await fetch(`${WORKERS_URL}/robots.txt`)).text()
    expect(robots).toContain(`Sitemap: ${WORKERS_URL}/sitemap.xml`)
    const sitemap = await (await fetch(`${WORKERS_URL}/sitemap.xml`)).text()
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toHaveLength(PUBLIC_PAGES.length)
    for (const loc of locs) expect(new URL(loc).host).toBe(workersHost)
  })
})

describe.runIf(LIVE && CHROMIUM)('the visit beacon on the Workers site (live, Chromium)', () => {
  const SIZES: [string, BrowserContextOptions][] = [
    ['desktop 1280 px', { viewport: { width: 1280, height: 800 } }],
    ['phone 390 px', { ...devices['iPhone 13'] }],
  ]
  let browser: Browser | undefined

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
  })

  it.each(SIZES)('%s: one visit per page load to the signal endpoint, answered 2xx, from a workers.dev page', async (_label, options) => {
    expect(options.viewport?.width).toBe(_label.startsWith('phone') ? 390 : 1280)
    // A fresh browser session (the beacon counts a visit once per session), that the beacon counts: automated
    // browsers send nothing unless navigator.webdriver is cleared.
    const context = await browser!.newContext(options)
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
    const page = await context.newPage()
    const visits: Request[] = []
    page.on('request', (request) => {
      if (request.url() !== SIGNAL_URL || request.method() !== 'POST') return
      if ((JSON.parse(request.postData() ?? 'null') as { kind?: string } | null)?.kind === 'visit') visits.push(request)
    })
    try {
      await page.goto(`${WORKERS_URL}/?ref=${LIVE_REF}`)
      await expect.poll(() => visits.length, { timeout: 15_000 }).toBe(1)
      await page.waitForTimeout(3_000) // and no second one
      expect(visits).toHaveLength(1)
      const [visit] = visits
      const status = (await visit.response())?.status() ?? 0
      expect(status).toBeGreaterThanOrEqual(200)
      expect(status).toBeLessThan(300)
      expect(new URL(visit.frame().url()).host).toBe(workersHost)
      expect(JSON.parse(visit.postData()!)).toMatchObject({ slug: 'tiebreak', kind: 'visit', ref: LIVE_REF })
    } finally {
      await context.close()
    }
  }, 60_000)
})

// The repo, from the issue tracker's address (https://github.com/<owner>/<repo>/issues).
const REPO = new URL(ISSUES_URL).pathname.split('/').slice(1, 3).join('/')

async function github(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
  const headers: Record<string, string> = { accept, 'x-github-api-version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`)
  return res
}
const githubJson = async <T,>(path: string) => (await (await github(path)).json()) as T

type CheckRun = { name: string; status: string; conclusion: string | null; app: { slug: string } | null }

describe.runIf(PR_NUMBER)('the pull request (GitHub)', () => {
  let head: string
  let base: string

  beforeAll(async () => {
    const pr = await githubJson<{ head: { sha: string }; base: { sha: string } }>(`/pulls/${PR_NUMBER}`)
    head = pr.head.sha
    const compare = await githubJson<{ merge_base_commit: { sha: string } }>(`/compare/${pr.base.sha}...${head}`)
    base = compare.merge_base_commit.sha
  })

  it("Vercel's check run, and the web and mobile CI checks, conclude 'success'", async () => {
    const wanted = (runs: CheckRun[]) => ({
      vercel: runs.filter((r) => r.app?.slug === 'vercel'),
      web: runs.filter((r) => r.name === 'web'),
      mobile: runs.filter((r) => r.name === 'mobile'),
    })
    // Wait (up to 15 minutes) until each has started and finished.
    const deadline = Date.now() + 15 * 60_000
    let groups = wanted([])
    for (;;) {
      const runs = (await githubJson<{ check_runs: CheckRun[] }>(`/commits/${head}/check-runs?per_page=100`)).check_runs
      groups = wanted(runs)
      const all = Object.values(groups)
      if (all.every((g) => g.length > 0 && g.every((r) => r.status === 'completed')) || Date.now() > deadline) break
      await new Promise((resolve) => setTimeout(resolve, 15_000))
    }
    for (const [name, runs] of Object.entries(groups)) {
      expect(runs.length, `${name} check run`).toBeGreaterThan(0)
      for (const run of runs) expect([name, run.name, run.conclusion]).toEqual([name, run.name, 'success'])
    }
  }, 16 * 60_000)

  it("changes the Vercel config and tests, and no file under the web app's source (but the two canonical pages) or mobile/", async () => {
    const files = (await githubJson<{ filename: string }[]>(`/pulls/${PR_NUMBER}/files?per_page=100`)).map((f) => f.filename)
    expect(files).toContain('vercel.json')
    expect(offLimitsChanges(files)).toEqual([])
    if (files.includes('package.json')) {
      const raw = 'application/vnd.github.raw+json'
      const before = await (await github(`/contents/package.json?ref=${base}`, raw)).text()
      const after = await (await github(`/contents/package.json?ref=${head}`, raw)).text()
      expect(packageJsonDrift(before, after)).toEqual([])
    }
  })
})
