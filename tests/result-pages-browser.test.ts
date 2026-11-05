// Public result pages in a real browser: Chromium (playwright-core) on the shared dev server (tests/browser-app.ts:
// in-memory database, sample data only), at desktop size (1280×800) and phone size (iPhone 13, 390 px wide).
//
// Checks, per GROWTH.md 2026-11-05: a seller ticks "Publish the result when it closes" on the new-poll form (off by
// default) and posts; once strangers close the poll, /results/<slug> answers 200 with the question as its <title>
// and h1, a description naming the winner and the vote count, every option's split and "Make your own tiebreak";
// /sitemap.xml lists it. An open, an un-opted and a reported-hidden poll answer 404 and aren't listed. Loading the
// page sends one visit, with its path; following "Make your own tiebreak" sends one tagged ref=results.
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it. Nothing reaches RepoHQ: the signal
// endpoint is answered inside the browser.
import { chromium, devices, type Browser, type BrowserContextOptions } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { REPORTS_TO_HIDE } from '@/lib/limits'
import { resultPath } from '@/lib/results'

const CHROMIUM = process.env.CHROMIUM_PATH
const SIZES: Record<'desktop' | 'phone', BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { ...devices['iPhone 13'] },
}
const SIGNALS = 'https://idea-factory.1426davejobs.workers.dev/**'
const QUESTION = 'Which cover for my cozy mystery paperback?'
const OPTIONS = ['Teal cover, serif title', 'Plum cover, script title']

describe.skipIf(!CHROMIUM)('public result pages in Chromium', () => {
  let browser: Browser | undefined
  const base = inject('appBase')

  const api = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  /** A poll posted over the API by a new account; returns its id. */
  async function newPoll(question: string, publishResult: boolean) {
    const { status, body } = await api('/polls', { question, options: OPTIONS, target: 3, durationHours: 24, publishResult })
    expect(status).toBe(201)
    return body.id as string
  }
  /** Each vote comes from a stranger (no cookie: a new anonymous account). */
  async function strangersVote(id: string, options: number[]) {
    for (const option of options) expect((await api(`/polls/${id}/votes`, { option })).status).toBe(201)
  }

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
    // The dev server compiles a route on its first request; do that here, not inside a test's timeout.
    await Promise.all([fetch(`${base}/results/AAAAAAAAAAAA`), fetch(`${base}/sitemap.xml`), fetch(base)])
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  /** A browser the beacon counts (navigator.webdriver cleared), whose signals are answered here and recorded. */
  async function countedBrowser(size: keyof typeof SIZES) {
    const context = await browser!.newContext(SIZES[size])
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
    const signals: Record<string, unknown>[] = []
    await context.route(SIGNALS, async (route) => {
      signals.push(JSON.parse(route.request().postData() ?? 'null'))
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    return { context, page: await context.newPage(), signals }
  }

  it.each(Object.keys(SIZES) as (keyof typeof SIZES)[])(
    'at %s: a seller publishes from the form; the closed poll’s page has the result and sends its visit',
    { timeout: 120_000 },
    async (size) => {
      // 1. The form: the box is there, off; the seller ticks it and posts.
      const seller = await browser!.newContext(SIZES[size])
      const form = await seller.newPage()
      await form.goto(base)
      const publish = form.getByLabel('Publish the result when it closes')
      await publish.waitFor()
      expect(await publish.isChecked()).toBe(false)
      expect(await publish.isDisabled()).toBe(false)
      // Exactly one field is labelled "Question" (the publish box's hint must not say the word).
      await form.getByLabel('Question').fill(`${QUESTION} (${size})`)
      await form.getByLabel('Option A text').fill(OPTIONS[0])
      await form.getByLabel('Option B text').fill(OPTIONS[1])
      await form.getByLabel('Close at').fill('3')
      await publish.check()
      await form.getByRole('button', { name: 'Create poll' }).click()
      await form.waitForURL(/\/p\/[^/?]+/, { timeout: 60_000 })
      await form.getByText('the result gets its own public page').waitFor({ timeout: 30_000 })
      const id = new URL(form.url()).pathname.split('/').pop()!
      const path = resultPath({ id, question: `${QUESTION} (${size})` })
      expect((await fetch(`${base}${path}`)).status).toBe(404) // still open
      await seller.close()

      // 2. Strangers close it: Plum wins 2 to 1.
      await strangersVote(id, [1, 0, 1])

      // 3. A visitor from search lands on the result page.
      const { context, page, signals } = await countedBrowser(size)
      const res = await page.goto(base + path)
      expect(res?.status()).toBe(200)
      await expect.poll(() => page.title()).toBe(`${QUESTION} (${size})`)
      expect(await page.locator('h1').allTextContents()).toEqual([`${QUESTION} (${size})`])
      const description = await page.locator('meta[name="description"]').getAttribute('content')
      expect(description).toContain(`Winner: ${OPTIONS[1]}, with 2 of 3 votes (67%)`)
      expect(await page.locator('.result-option .bar-label').allTextContents()).toEqual([
        `A · ${OPTIONS[0]}1 vote (33%)`,
        `B · ${OPTIONS[1]}2 votes (67%)`,
      ])
      expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(new RegExp(`${path}$`))
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size === 'phone' ? 390 : 1280)

      // 4. One visit, with the page's own path.
      await expect.poll(() => signals.length, { timeout: 30_000 }).toBe(1)
      await page.waitForTimeout(500) // and no second one for the same landing
      expect(signals).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, path }])

      // 5. "Make your own tiebreak" opens the new-poll form, tagged for the counter.
      await page.getByRole('link', { name: 'Make your own tiebreak' }).click()
      await page.waitForURL(`${base}/?ref=results`, { timeout: 60_000 })
      await page.getByLabel('Publish the result when it closes').waitFor()
      await expect.poll(() => signals.length, { timeout: 30_000 }).toBe(2)
      expect(signals[1]).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'results' })
      await context.close()
    },
  )

  it('open, un-opted and reported polls answer 404 and stay out of /sitemap.xml; published ones are listed', { timeout: 120_000 }, async () => {
    const listed = await newPoll('Which listing photo, sitemap check?', true)
    await strangersVote(listed, [0, 0, 1])
    const open = await newPoll('Still open, sitemap check?', true)
    const unopted = await newPoll('Not published, sitemap check?', false)
    await strangersVote(unopted, [0, 1, 1])
    const reported = await newPoll('Reported, sitemap check?', true)
    await strangersVote(reported, [1, 1, 0])
    const reportedPath = resultPath({ id: reported, question: 'Reported, sitemap check?' })
    expect((await fetch(base + reportedPath)).status).toBe(200)
    for (let i = 0; i < REPORTS_TO_HIDE; i++) expect((await api(`/polls/${reported}/reports`, {})).status).toBe(201)

    expect((await fetch(base + resultPath({ id: listed, question: 'Which listing photo, sitemap check?' }))).status).toBe(200)
    expect((await fetch(base + resultPath({ id: open, question: 'Still open, sitemap check?' }))).status).toBe(404)
    expect((await fetch(base + resultPath({ id: unopted, question: 'Not published, sitemap check?' }))).status).toBe(404)
    expect((await fetch(base + reportedPath)).status).toBe(404)
    expect((await fetch(`${base}/results/not-a-poll`)).status).toBe(404)

    const sitemap = await fetch(`${base}/sitemap.xml`)
    expect(sitemap.status).toBe(200)
    const xml = await sitemap.text()
    expect(xml).toContain(`${resultPath({ id: listed, question: 'Which listing photo, sitemap check?' })}</loc>`)
    for (const id of [open, unopted, reported]) expect(xml).not.toContain(id)
  })
})
