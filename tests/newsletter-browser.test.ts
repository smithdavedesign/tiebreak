// Vote from your newsletter in Chromium, at desktop size (1280×800) and on a phone (iPhone 13,
// 390 px), against the dev server tests/browser-app.ts starts for every browser test (an
// in-memory database, sample data only). A creator posts a three-option poll (two uploaded
// photos and a text option), sees "Get votes from your newsletter", and copies both blocks.
// A reader's tap on an option's link (/polls/<id>?pick=B&src=newsletter) opens the poll with B
// preselected and one "Confirm vote" button, and records nothing until they confirm; scanners
// that GET the link record nothing either. Confirming counts exactly one vote; a second confirm
// (from another tab) is a 409. A link to a closed poll shows the result. The landing's visit
// beacon carries the poll path and source "newsletter"; it's answered inside the page, so
// nothing reaches RepoHQ.
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it.
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { SIGNAL_URL } from '@/lib/site'
import { png } from './image-bytes'

const CHROMIUM = process.env.CHROMIUM_PATH
const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { ...devices['iPhone 13'] },
} as const
type Size = keyof typeof SIZES

const LINK = /^http:\/\/localhost:\d+\/polls\/[A-Za-z0-9_-]{12}\?pick=([ABCD])&src=newsletter$/

describe.skipIf(!CHROMIUM)('vote from your newsletter in Chromium, at desktop size and 390 px', () => {
  let browser: Browser | undefined
  const base = inject('appBase')

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([fetch(`${base}/polls/AAAAAAAAAAAA?pick=A&src=newsletter`), fetch(`${base}/polls/AAAAAAAAAAAA`)])
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  const pollOf = async (id: string) => ((await (await fetch(`${base}/polls/${id}`)).json()) as { poll: { voteCount: number; status: string } }).poll
  const voteCount = async (id: string) => (await pollOf(id)).voteCount

  /** A browser at this size, without the Next dev-mode badge over the page. */
  async function newContext(size: Size, options: Parameters<Browser['newContext']>[0] = {}) {
    const context = await browser!.newContext({ ...SIZES[size], ...options })
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = 'nextjs-portal { display: none !important }'
        document.head.append(style)
      })
    })
    return context
  }

  /** Posts a poll as this browser's account (its cookie), with two photos uploaded the way the form does. */
  async function postPoll(context: BrowserContext, target = 20) {
    const urls: string[] = []
    const colours: [number, number, number][] = [[200, 60, 40], [40, 90, 200]]
    for (const colour of colours) {
      const res = await context.request.post(`${base}/images`, {
        headers: { 'content-type': 'image/png' },
        data: png({ width: 24, height: 32, rgb: colour }),
      })
      expect(res.status()).toBe(201)
      urls.push(((await res.json()) as { url: string }).url)
    }
    const res = await context.request.post(`${base}/polls`, {
      headers: { 'content-type': 'application/json' },
      data: {
        question: 'Which cover for my novel?',
        options: [{ text: 'Salt house', imageUrl: urls[0] }, { text: 'Night ferry', imageUrl: urls[1] }, 'Keep the old one'],
        target,
        durationHours: 72,
      },
    })
    expect(res.status()).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  const noSideScroll = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

  /** The creator's panel: its two blocks, as the copy buttons put them on the clipboard. */
  async function copyBlocks(page: Page) {
    const read = () =>
      page.evaluate(async () => {
        const [item] = await navigator.clipboard.read()
        return { html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() }
      })
    await page.getByRole('button', { name: 'Copy email HTML' }).click()
    await page.getByRole('button', { name: 'Copied' }).first().waitFor()
    const email = await read()
    await page.getByRole('button', { name: 'Copy Markdown' }).click()
    await page.getByRole('button', { name: 'Copied' }).nth(1).waitFor()
    const markdown = await read()
    return { email, markdown }
  }

  for (const size of Object.keys(SIZES) as Size[]) {
    it(`${size}: the creator copies both blocks, with one link per option`, { timeout: 180_000 }, async () => {
      const creator = await newContext(size)
      await creator.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
      const id = await postPoll(creator)
      const page = await creator.newPage()
      await page.goto(`${base}/p/${id}`)
      await page.getByRole('heading', { name: 'Get votes from your newsletter' }).waitFor({ timeout: 60_000 })
      await noSideScroll(page)

      const { email, markdown } = await copyBlocks(page)
      // The email block: the table itself for rich editors, and its source for an HTML block.
      expect(email.html).toContain('<table')
      expect(email.text.startsWith('<table')).toBe(true)
      expect(email.text).not.toMatch(/<script|<style/i)
      const hrefs = [...email.text.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
      expect(hrefs).toHaveLength(3)
      expect(hrefs.map((h) => h.match(LINK)?.[1])).toEqual(['A', 'B', 'C'])
      for (const href of hrefs) expect(email.html.replace(/&amp;/g, '&')).toContain(href)
      // The Markdown: an image line and a link line for each photo option, a link line for the text one.
      expect(markdown.text.match(/^\[!\[.+\]\(http:\/\/localhost:\d+\/images\/[^)]+\)\]\(.+\)$/gm)).toHaveLength(2)
      expect(markdown.text.match(/^\[Vote [ABC][^\]]*\]\((.+)\)$/gm)).toHaveLength(3)
      expect(markdown.html).toContain('<img')
      // The panel's code boxes hold the same text the buttons copy.
      expect(await page.getByLabel('Email HTML').inputValue()).toBe(email.text)
      expect(await page.getByLabel('Markdown', { exact: true }).inputValue()).toBe(markdown.text)

      // The preview shows the block as readers see it: three links, both photos loaded.
      const preview = page.frameLocator('iframe.newsletter-preview')
      expect(await preview.locator('a[href]').count()).toBe(3)
      await expect
        .poll(() => preview.locator('img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)), { timeout: 30_000 })
        .toBe(true)
      await creator.close()
    })

    it(`${size}: a reader's link opens the poll with that option picked, records nothing, and Confirm vote counts one vote`, { timeout: 180_000 }, async () => {
      const creator = await newContext(size)
      const id = await postPoll(creator)
      await creator.close()
      const link = `${base}/polls/${id}?pick=B&src=newsletter`

      const reader = await newContext(size)
      // What an email link scanner does: GET the link, with and without following the redirect.
      const scan = await reader.request.get(link, { maxRedirects: 0 })
      expect(scan.status()).toBe(303)
      expect(new URL(scan.headers().location, base).pathname + new URL(scan.headers().location, base).search).toBe(`/p/${id}?pick=B&src=newsletter`)
      const followed = await reader.request.get(link)
      expect(followed.status()).toBe(200)
      expect(await followed.text()).toContain('Confirm vote')
      expect(await voteCount(id)).toBe(0)

      const page = await reader.newPage()
      await page.goto(link)
      expect(page.url()).toBe(`${base}/p/${id}?pick=B&src=newsletter`)
      const confirm = page.getByRole('button', { name: 'Confirm vote' })
      await confirm.waitFor({ timeout: 60_000 })
      expect(await confirm.count()).toBe(1)
      const box = (await confirm.boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height) // no scrolling to find it
      expect(await page.getByRole('radio', { name: 'B · Night ferry' }).isChecked()).toBe(true)
      expect(await page.getByRole('radio', { name: 'A · Salt house' }).isChecked()).toBe(false)
      expect(await page.getByRole('radio', { name: 'C · Keep the old one' }).isChecked()).toBe(false)
      expect(await page.getByRole('button', { name: /^Pick / }).count()).toBe(0)
      expect(await page.getByRole('heading', { name: 'Get votes from your newsletter' }).count()).toBe(0) // not the creator
      await noSideScroll(page)
      await page.waitForLoadState('networkidle')
      expect(await voteCount(id)).toBe(0) // opening the page counted nothing

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url() === `${base}/polls/${id}/votes` && r.request().method() === 'POST'),
        confirm.click(),
      ])
      expect(response.status()).toBe(201)
      expect(JSON.parse(response.request().postData() ?? '{}')).toEqual({ option: 1 })
      await page.getByText('You picked').waitFor()
      expect(await page.getByText('You picked').locator('b').textContent()).toBe('Night ferry')
      expect(await voteCount(id)).toBe(1)
      expect(await page.getByRole('button', { name: 'Confirm vote' }).count()).toBe(0)
      expect(page.url()).toBe(`${base}/p/${id}`) // a copied address bar doesn't preselect anything
      await noSideScroll(page)
      await reader.close()
    })

    it(`${size}: changing the pick before confirming counts the new one, once`, { timeout: 180_000 }, async () => {
      const creator = await newContext(size)
      const id = await postPoll(creator)
      await creator.close()
      const reader = await newContext(size)
      const page = await reader.newPage()
      await page.goto(`${base}/polls/${id}?pick=A&src=newsletter`)
      await page.getByRole('button', { name: 'Confirm vote' }).waitFor({ timeout: 60_000 })
      // Tap option C's card (the radio inside it is visually hidden).
      const c = page.getByRole('radio', { name: 'C · Keep the old one' })
      await page.locator('label.pick-option', { has: c }).click()
      expect(await c.isChecked()).toBe(true)
      expect(await page.getByRole('radio', { name: 'A · Salt house' }).isChecked()).toBe(false)
      await page.getByText('Your pick: C · Keep the old one').waitFor()
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url() === `${base}/polls/${id}/votes`),
        page.getByRole('button', { name: 'Confirm vote' }).dblclick(),
      ])
      expect(JSON.parse(response.request().postData() ?? '{}')).toEqual({ option: 2 })
      await page.getByText('You picked').waitFor()
      await page.waitForLoadState('networkidle')
      expect(await voteCount(id)).toBe(1) // a double tap is still one vote
      await reader.close()
    })

    it(`${size}: a second confirm by the same reader gets 409 and the count doesn't change`, { timeout: 180_000 }, async () => {
      const creator = await newContext(size)
      const id = await postPoll(creator)
      await creator.close()
      const link = `${base}/polls/${id}?pick=A&src=newsletter`
      const reader = await newContext(size)
      // The same email opened twice: two tabs, one browser.
      const [first, second] = [await reader.newPage(), await reader.newPage()]
      for (const page of [first, second]) {
        await page.goto(link)
        await page.getByRole('button', { name: 'Confirm vote' }).waitFor({ timeout: 60_000 })
      }
      const confirm = async (page: Page) => {
        const [response] = await Promise.all([
          page.waitForResponse((r) => r.url() === `${base}/polls/${id}/votes` && r.request().method() === 'POST'),
          page.getByRole('button', { name: 'Confirm vote' }).click(),
        ])
        return response.status()
      }
      expect(await confirm(first)).toBe(201)
      expect(await voteCount(id)).toBe(1)
      expect(await confirm(second)).toBe(409)
      await second.getByText('You already voted on this poll.').waitFor()
      await second.getByText('You picked').waitFor() // and it shows the vote that did count
      expect(await voteCount(id)).toBe(1)
      await reader.close()
    })

    it(`${size}: a link to a closed poll shows the result page, not a vote button`, { timeout: 180_000 }, async () => {
      const creator = await newContext(size)
      const id = await postPoll(creator, 1)
      await creator.close()
      const voted = await fetch(`${base}/polls/${id}/votes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ option: 0 }),
      })
      expect(voted.status).toBe(201)
      expect((await pollOf(id)).status).toBe('closed')

      const reader = await newContext(size)
      const page = await reader.newPage()
      await page.goto(`${base}/polls/${id}?pick=B&src=newsletter`)
      await page.getByText('Winner: A · Salt house').waitFor({ timeout: 60_000 })
      expect(await page.getByRole('button', { name: 'Confirm vote' }).count()).toBe(0)
      expect(await page.getByRole('radio').count()).toBe(0)
      expect(await page.getByRole('button', { name: /^Pick / }).count()).toBe(0)
      await noSideScroll(page)
      expect(await voteCount(id)).toBe(1)
      await reader.close()
    })
  }

  it('landing on a newsletter link sends a visit with the poll path and source newsletter', { timeout: 180_000 }, async () => {
    const creator = await newContext('phone')
    const id = await postPoll(creator)
    await creator.close()

    const reader = await newContext('phone')
    const signals: unknown[] = []
    await reader.exposeFunction('__tiebreakSignal', (body: string) => {
      signals.push(JSON.parse(body))
    })
    await reader.route('https://idea-factory.1426davejobs.workers.dev/**', (route) => route.abort())
    await reader.addInitScript((signalUrl: string) => {
      // A visitor's browser, not an automated one; and the signal endpoint answered here.
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

    const page = await reader.newPage()
    await page.goto(`${base}/polls/${id}?pick=C&src=newsletter`)
    await page.getByRole('button', { name: 'Confirm vote' }).waitFor({ timeout: 60_000 })
    const landing = { slug: 'tiebreak', kind: 'visit', referrer: null, path: `/p/${id}`, source: 'newsletter' }
    await expect.poll(() => signals, { timeout: 30_000 }).toEqual([landing])

    // Voting sends nothing more, and neither does a plain poll page in the same session.
    await page.getByRole('button', { name: 'Confirm vote' }).click()
    await page.getByText('You picked').waitFor()
    await page.goto(`${base}/p/${id}`)
    await page.getByText('You picked').waitFor({ timeout: 60_000 })
    await page.waitForTimeout(500)
    expect(signals).toEqual([landing])
    await reader.close()
  })
})
