// Public result pages against the dev server (the one tests/browser-app.ts starts for every browser test), over
// HTTP and in Chromium: the real status codes, <title>, <h1>, meta description and /sitemap.xml; the visit beacon
// when a result page loads; and the new-poll form's "Publish the result when it closes" box, off by default,
// turned off by a Pro account's private box, and when ticked, a poll whose result page goes up once it closes.
//
// The beacon only sends on production, so the dev server runs with NEXT_PUBLIC_VERCEL_ENV=production, and the
// browser reports itself as not automated. Nothing reaches RepoHQ: the page's fetch to the signal endpoint is
// answered inside the page and handed to the test, and any request to RepoHQ that got past that is aborted.
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it. The app gets sample data only; the
// Pro account is made with a webhook signed by the dev server's made-up webhook secret (tests/browser-app.ts).
import { createHmac } from 'node:crypto'
import { chromium, devices, type Browser, type BrowserContext, type Page, type Request } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { resultPath } from '@/lib/results'
import { SIGNAL_URL } from '@/lib/site'
import { CHECKOUT_APP } from '@/lib/stripe'

const CHROMIUM = process.env.CHROMIUM_PATH
const PHONE = devices['iPhone 13']
const DESKTOP = { viewport: { width: 1280, height: 800 } }
const PUBLISH = 'Publish the result when it closes'

/** The text of an HTML fragment, as a reader sees it. */
const textOf = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** A <meta> tag's content, by its property or name. */
function metaContent(html: string, key: string): string[] {
  const found: string[] = []
  for (const tag of html.match(/<meta [^>]*>/g) ?? []) {
    if (tag.includes(`property="${key}"`) || tag.includes(`name="${key}"`)) found.push(textOf(tag.match(/content="([^"]*)"/)?.[1] ?? ''))
  }
  return found
}

describe.skipIf(!CHROMIUM)('public result pages on the dev server', () => {
  const base = inject('appBase')
  let browser: Browser | undefined

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${base}${path}`, { redirect: 'manual' })

  /** A poll posted with `body`, then voted on by one stranger per entry of `votes` (no cookie: a new account each). */
  async function pollWithVotes(body: Record<string, unknown>, votes: number[]) {
    const res = await post('/polls', { options: ['Red mug', 'Blue mug'], target: Math.max(1, votes.length), durationHours: 24, ...body })
    expect(res.status).toBe(201)
    const { id, poll } = (await res.json()) as { id: string; poll: { question: string } }
    for (const option of votes) expect((await post(`/polls/${id}/votes`, { option })).status).toBe(201)
    return { id, question: poll.question }
  }

  /** A context whose visit beacon is captured: it reports itself as a visitor's browser, and RepoHQ is never reached. */
  async function countedContext(options: Parameters<Browser['newContext']>[0]) {
    const context = await browser!.newContext(options)
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

  async function startPage(context: BrowserContext): Promise<Page> {
    const page = await context.newPage()
    await page.goto(base)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await page.getByLabel('Option A text').waitFor()
    return page
  }

  it('serves a closed, published poll (200): <title> and <h1> are its question; the description states the winner and the count', { timeout: 180_000 }, async () => {
    const poll = await pollWithVotes({ question: 'Which glaze for my mug listing?', publishResult: true }, [1, 1, 0])
    const res = await get(resultPath(poll))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html.match(/<title>(.*?)<\/title>/s)?.[1]).toBe('Which glaze for my mug listing?')
    expect([...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => textOf(m[1]))).toEqual(['Which glaze for my mug listing?'])
    const [description, ...more] = metaContent(html, 'description')
    expect(more).toEqual([])
    expect(description).toMatch(/^“Blue mug” won with 2 of 3 votes \(67%\)\./)
    expect(html).not.toMatch(/<meta name="robots"[^>]*noindex/)
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${resultPath(poll)}"`))
    const text = textOf(html)
    expect(text).toContain('A · Red mug 1 vote (33%)')
    expect(text).toContain('B · Blue mug 2 votes (67%)')
    expect(html).toMatch(/<a class="button" href="\/\?ref=result">Make your own tiebreak<\/a>/)
    expect(metaContent(html, 'og:image')[0]).toContain(`/p/${poll.id}/card?v=closed`)
  })

  it('404s for an open poll, an un-opted poll and a poll hidden by 3 reports; other words before the id get a 308', { timeout: 180_000 }, async () => {
    const open = await pollWithVotes({ question: 'Open: linen or slate?', publishResult: true, target: 3 }, [0])
    const unopted = await pollWithVotes({ question: 'Unopted: linen or slate?' }, [0])
    const hidden = await pollWithVotes({ question: 'Hidden: linen or slate?', publishResult: true }, [0])
    expect((await get(resultPath(hidden))).status).toBe(200)
    for (let i = 0; i < 3; i++) expect((await post(`/polls/${hidden.id}/reports`, {})).status).toBe(201)

    for (const poll of [open, unopted, hidden]) expect((await get(resultPath(poll))).status).toBe(404)
    expect((await get('/results/no-such-poll-AAAAAAAAAAAA')).status).toBe(404)

    const shown = await pollWithVotes({ question: 'Shown: linen or slate?', publishResult: true }, [1])
    const moved = await get(`/results/some-old-words-${shown.id}`)
    expect(moved.status).toBe(308)
    expect(new URL(moved.headers.get('location')!, base).pathname).toBe(resultPath(shown))

    const xml = await (await get('/sitemap.xml')).text()
    const paths = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
    expect(paths).toContain(resultPath(shown))
    for (const poll of [open, unopted, hidden]) expect(paths).not.toContain(resultPath(poll))
    expect(paths).toContain('/pickfu-alternative') // the public pages are still there
  })

  it('loading /results/<slug> fires the visit beacon with path /results/<slug>; "Make your own tiebreak" opens the form', { timeout: 180_000 }, async () => {
    const poll = await pollWithVotes({ question: 'Which cover for my cozy mystery?', publishResult: true }, [0, 0, 1])
    const { context, signals } = await countedContext({ ...PHONE })
    const page = await context.newPage()
    expect((await page.goto(`${base}${resultPath(poll)}`))?.status()).toBe(200)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await expect
      .poll(() => signals, { timeout: 30_000 })
      .toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, path: resultPath(poll) }])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await page.getByRole('link', { name: 'Make your own tiebreak' }).click()
    await page.waitForURL(`${base}/?ref=result`, { timeout: 60_000 })
    await page.getByLabel('Question').waitFor({ timeout: 30_000 })
    await expect
      .poll(() => signals, { timeout: 30_000 })
      .toEqual([
        { slug: 'tiebreak', kind: 'visit', referrer: null, path: resultPath(poll) },
        { slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'result' },
      ])
    await context.close()
  })

  for (const [label, options] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
    it(`(${label}) the form's publish box starts off; ticked, the poll posts with it, and its result page goes up when it closes`, { timeout: 180_000 }, async () => {
      const context = await browser!.newContext(options)
      const page = await startPage(context)
      const publish = page.getByLabel(PUBLISH)
      expect(await publish.isChecked()).toBe(false)
      expect(await publish.isEnabled()).toBe(true)

      const question = `Which mug photo leads my listing (${label})?`
      await page.getByLabel('Question').fill(question)
      await page.getByLabel('Option A text').fill('Speckled blue')
      await page.getByLabel('Option B text').fill('Matte white')
      await page.getByLabel('Close at').fill('1')
      await publish.check()
      const sent = page.waitForRequest((r: Request) => r.method() === 'POST' && new URL(r.url()).pathname === '/polls')
      await page.getByRole('button', { name: 'Create poll' }).click()
      expect((await sent).postDataJSON()).toMatchObject({ question, visibility: 'unlisted', publishResult: true })
      await page.waitForURL(/\/p\/[^/?]+/, { timeout: 60_000 })
      const id = new URL(page.url()).pathname.split('/').pop()!

      expect((await get(resultPath({ id, question }))).status).toBe(404) // still open
      expect((await post(`/polls/${id}/votes`, { option: 1 })).status).toBe(201) // a stranger's vote closes it
      await page.reload()
      const link = page.getByRole('link', { name: 'see its public page' })
      await link.click()
      await page.waitForURL(`${base}${resultPath({ id, question })}`, { timeout: 60_000 })
      expect(await page.locator('h1').allTextContents()).toEqual([question])
      expect(await page.title()).toBe(question)
      await context.close()
    })
  }

  it('a Pro account’s private box turns the publish box off and disables it, and the private poll posts unpublished', { timeout: 180_000 }, async () => {
    const account = '00000000-0000-4000-8000-00000000a11e'
    const session = {
      id: 'cs_test_result_pages',
      object: 'checkout.session',
      client_reference_id: account,
      metadata: { app: CHECKOUT_APP },
      payment_status: 'paid',
      amount_total: 500,
      currency: 'usd',
      customer_details: { email: 'buyer@example.com' },
    }
    const payload = JSON.stringify({ id: 'evt_test_result_pages', object: 'event', type: 'checkout.session.completed', data: { object: session } })
    const t = Math.floor(Date.now() / 1000)
    const v1 = createHmac('sha256', inject('webhookSecret')).update(`${t}.${payload}`).digest('hex')
    const paid = await fetch(`${base}/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
      body: payload,
    })
    expect(paid.status).toBe(200)

    const context = await browser!.newContext({ ...PHONE })
    await context.addCookies([{ name: 'tb_voter', value: account, url: base }])
    const page = await startPage(context)
    const publish = page.getByLabel(PUBLISH)
    const keepPrivate = page.getByLabel('Keep the result private')
    await publish.check()
    expect(await publish.isChecked()).toBe(true)
    await keepPrivate.check()
    expect(await publish.isChecked()).toBe(false)
    expect(await publish.isDisabled()).toBe(true)

    await page.getByLabel('Question').fill('Private: which label colour?')
    await page.getByLabel('Option A text').fill('Ochre')
    await page.getByLabel('Option B text').fill('Teal')
    const sent = page.waitForRequest((r: Request) => r.method() === 'POST' && new URL(r.url()).pathname === '/polls')
    await page.getByRole('button', { name: 'Create poll' }).click()
    expect((await sent).postDataJSON()).toMatchObject({ visibility: 'private', publishResult: false })
    await page.getByText('Your private poll is live').waitFor({ timeout: 60_000 })

    // Unticking private gives the box back, as it was.
    await page.goto(base)
    await page.getByLabel('Keep the result private').check()
    await page.getByLabel('Keep the result private').uncheck()
    expect(await page.getByLabel(PUBLISH).isEnabled()).toBe(true)
    await context.close()
  })
})
