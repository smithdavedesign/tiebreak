// Public result pages against the dev server (real HTTP status codes, the HTML Next sends, /sitemap.xml) and in
// Chromium: the new-poll form's "Publish the result when it closes" box, the page a closed opted-in poll gets,
// and the visit beacon it sends with its own path. The unit tests are in tests/public-results.test.ts.
//
// Uses the shared dev server (tests/browser-app.ts): sample data only, NEXT_PUBLIC_VERCEL_ENV=production so the
// beacon's code runs. Nothing reaches RepoHQ: the page's request to the signal endpoint is answered inside the
// page and handed to the test, and anything that got past that is aborted. Needs CHROMIUM_PATH; skipped without.
import { chromium, devices, type Browser, type BrowserContext } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { resultPath, resultSlug } from '@/lib/results'
import { SIGNAL_URL } from '@/lib/site'

const CHROMIUM = process.env.CHROMIUM_PATH
const PHONE = devices['iPhone 13']
const QUESTION = 'Which cover for my cozy mystery novel?'
const COVERS = ['The Lighthouse Recipe', 'Murder at the Bakehouse', 'Tea, Toast and Trouble']

/** A <meta> tag's content, by its name or property. */
function metaContent(html: string, key: string): string[] {
  const found: string[] = []
  for (const tag of html.match(/<meta [^>]*>/g) ?? []) {
    if (tag.includes(`name="${key}"`) || tag.includes(`property="${key}"`)) found.push(tag.match(/content="([^"]*)"/)?.[1] ?? '')
  }
  return found
}

const decode = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

describe.skipIf(!CHROMIUM)('public result pages on the dev server, and in Chromium', () => {
  const base = inject('appBase')
  let browser: Browser | undefined

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  /** A poll that closes at `votes.length` votes, each from a stranger (no cookie: a new anonymous account). */
  async function closedPoll(votes: number[], extra: Record<string, unknown> = { publishResult: true }) {
    const res = await post('/polls', { question: QUESTION, options: COVERS, target: Math.max(1, votes.length), durationHours: 24, ...extra })
    expect(res.status).toBe(201)
    const { poll } = (await res.json()) as { poll: { id: string; question: string } }
    for (const option of votes) expect((await post(`/polls/${poll.id}/votes`, { option })).status).toBe(201)
    return poll
  }

  /** A browser context that counts as a visitor, with the beacon's requests captured instead of sent. */
  async function visitor(options: Parameters<Browser['newContext']>[0]) {
    const context: BrowserContext = await browser!.newContext(options)
    const signals: Record<string, unknown>[] = []
    await context.exposeFunction('__tiebreakSignal', (body: string) => {
      signals.push(JSON.parse(body))
    })
    await context.route('https://idea-factory.1426davejobs.workers.dev/**', (route) => route.abort())
    await context.addInitScript((signalUrl: string) => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
      const realFetch = window.fetch.bind(window)
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input instanceof Request ? input.url : input) === signalUrl) {
          ;(window as unknown as { __tiebreakSignal: (body: string) => void }).__tiebreakSignal(String(init?.body))
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return realFetch(input, init)
      }
    }, SIGNAL_URL)
    return { context, signals }
  }

  beforeAll(async () => {
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([fetch(`${base}/results/AAAAAAAAAAAA`), fetch(`${base}/sitemap.xml`), fetch(`${base}/p/AAAAAAAAAAAA`)])
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('a closed opted-in poll’s page answers 200 with the question as <title> and <h1>, the winner and the vote count in its description', { timeout: 120_000 }, async () => {
    const poll = await closedPoll([1, 1, 0])
    const res = await fetch(`${base}/results/${resultSlug(poll)}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(decode(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? '')).toBe(QUESTION)
    expect([...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => decode(m[1]))).toEqual([QUESTION])
    const [description] = metaContent(html, 'description')
    expect(decode(description)).toContain('Winner: Murder at the Bakehouse, with 2 of 3 votes (67%).')
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${resultPath(poll)}"`))
    expect(metaContent(html, 'robots')).toEqual([]) // indexable
    expect(new URL(metaContent(html, 'og:image')[0]).pathname).toBe(`/p/${poll.id}/card`)
    for (const cover of COVERS) expect(decode(html)).toContain(cover)
    expect(html).toMatch(/<a class="button" href="\/\?ref=result">Make your own tiebreak<\/a>/)
  })

  it('sends a bare id or old words to the canonical address with a 308', { timeout: 60_000 }, async () => {
    const poll = await closedPoll([0])
    const res = await fetch(`${base}/results/${poll.id}`, { redirect: 'manual' })
    expect(res.status).toBe(308)
    expect(new URL(res.headers.get('location')!, base).pathname).toBe(resultPath(poll))
  })

  it('answers 404 for an open poll, an un-opted poll and a poll hidden by 3 reports, and /sitemap.xml lists only the published one', { timeout: 120_000 }, async () => {
    const published = await closedPoll([2])
    const unopted = await closedPoll([0], { publishResult: false })
    const hidden = await closedPoll([1])
    for (let i = 0; i < 3; i++) expect((await post(`/polls/${hidden.id}/reports`, {})).status).toBe(201)
    const openRes = await post('/polls', { question: QUESTION, options: COVERS, target: 5, durationHours: 24, publishResult: true })
    const { poll: open } = (await openRes.json()) as { poll: { id: string; question: string } }

    expect((await fetch(`${base}/results/${resultSlug(published)}`)).status).toBe(200)
    for (const poll of [open, unopted, hidden]) expect((await fetch(`${base}/results/${resultSlug(poll)}`)).status).toBe(404)

    const sitemap = await fetch(`${base}/sitemap.xml`)
    expect(sitemap.status).toBe(200)
    const xml = await sitemap.text()
    expect(xml).toContain(`${resultPath(published)}</loc>`)
    expect(xml).toContain('/pickfu-alternative</loc>')
    for (const poll of [open, unopted, hidden]) expect(xml).not.toContain(poll.id)
  })

  it('loading /results/<slug> sends the visit beacon with that path; "Make your own tiebreak" opens the form, tagged ref=result (phone)', { timeout: 180_000 }, async () => {
    const poll = await closedPoll([0, 0, 2])
    const path = resultPath(poll)
    const { context, signals } = await visitor({ ...PHONE })
    const page = await context.newPage()
    await page.goto(base + path)
    await expect.poll(() => signals, { timeout: 30_000 }).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, path }])
    await page.waitForTimeout(500) // and no second visit for the same landing
    expect(signals).toHaveLength(1)
    expect(await page.locator('h1').innerText()).toBe(QUESTION)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await page.getByRole('link', { name: 'Make your own tiebreak' }).click()
    await page.waitForURL(`${base}/?ref=result`, { timeout: 60_000 })
    await page.getByLabel('Question').waitFor({ timeout: 30_000 })
    await expect.poll(() => signals.length, { timeout: 30_000 }).toBe(2)
    expect(signals[1]).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'result' })
    await context.close()
  })

  it('the form’s box is off by default; ticked, the poll it posts closes into a public result page its poll page links to (desktop)', { timeout: 180_000 }, async () => {
    const { context } = await visitor({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(base)
    const box = page.getByLabel(/Publish the result when it closes/)
    await box.waitFor({ timeout: 30_000 })
    expect(await box.isChecked()).toBe(false)
    expect(await box.isEnabled()).toBe(true)

    await page.getByLabel('Question').fill(QUESTION)
    await page.getByLabel('Option A text').fill(COVERS[0])
    await page.getByLabel('Option B text').fill(COVERS[1])
    await page.getByLabel('Close at').fill('1')
    await box.check()
    const created = page.waitForResponse((r) => r.url() === `${base}/polls` && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create poll' }).click()
    const sent = JSON.parse((await created).request().postData() ?? '{}')
    expect(sent).toMatchObject({ publishResult: true, visibility: 'unlisted' })
    await page.waitForURL(/\/p\/[^/?]+/, { timeout: 60_000 })
    await page.getByText('When it closes, its result gets a public page').waitFor({ timeout: 30_000 })
    const id = new URL(page.url()).pathname.split('/').pop()!

    expect((await post(`/polls/${id}/votes`, { option: 1 })).status).toBe(201) // a stranger's vote closes it
    await page.reload()
    const link = page.getByRole('link', { name: QUESTION })
    await link.waitFor({ timeout: 30_000 })
    const href = await link.getAttribute('href')
    expect(href).toBe(resultPath({ id, question: QUESTION }))
    await link.click()
    await page.waitForURL(`${base}${href}`, { timeout: 60_000 })
    expect(await page.locator('h1').innerText()).toBe(QUESTION)
    expect(await page.title()).toBe(QUESTION)
    await context.close()
  })
})
