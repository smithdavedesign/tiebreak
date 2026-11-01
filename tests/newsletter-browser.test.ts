// Vote from your newsletter in a real browser: Chromium (playwright-core) on the shared dev server (tests/browser-app.ts:
// in-memory database, sample data only), at desktop size (1280×800) and phone size (iPhone 13, 390 px wide).
//
// The creator's poll page has the "Get votes from your newsletter" panel; its two buttons copy the HTML and the
// Markdown block. A reader opens option B's link from the block: no vote is recorded by opening it (nor by a link
// scanner fetching every link), the page opens with B preselected and one "Confirm vote" button, and the visit
// beacon sends the poll's path with source "newsletter". Confirming records exactly one vote; a second confirm from
// another tab is a 409 and the count stays 1. A link to a closed poll shows the result. The beacon's requests are
// answered inside the page, so nothing reaches RepoHQ.
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it.
import { chromium, devices, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { SIGNAL_URL } from '@/lib/site'

const CHROMIUM = process.env.CHROMIUM_PATH
const SIZES: Record<'desktop' | 'phone', BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { ...devices['iPhone 13'] },
}
const sizes = Object.keys(SIZES) as (keyof typeof SIZES)[]
const COVERS = [
  { text: 'Sunset orange', colour: '#e0662a' },
  { text: 'Deep teal', colour: '#1f6f78' },
  { text: 'Black and gold', colour: '#1d1d1f' },
]

const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** A cover photo from the browser's own encoder, as a JPEG. */
async function drawCover(page: Page, colour: string) {
  const base64 = await page.evaluate(async (colour) => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, 400, 600)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(60, 120, 280, 40)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, colour)
  return Buffer.from(base64, 'base64')
}

/** The poll's vote count, as anyone reads it (no cookie). */
async function voteCount(base: string, id: string): Promise<number> {
  const res = await fetch(`${base}/polls/${id}`, { cache: 'no-store' })
  return ((await res.json()) as { poll: { voteCount: number } }).poll.voteCount
}

/** A reader's browser: not automated, and the beacon's requests answered here and recorded. */
async function readerContext(browser: Browser, size: BrowserContextOptions) {
  const context = await browser.newContext(size)
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

/** Waits until React has hydrated the poll page (the share link becomes absolute in an effect). */
async function hydrated(page: Page, base: string) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  await expect.poll(() => page.getByLabel('Share link').inputValue(), { timeout: 60_000 }).toMatch(new RegExp(`^${base}/p/`))
}

describe.skipIf(!CHROMIUM)('vote from your newsletter, in Chromium', () => {
  const base = inject('appBase')
  let browser: Browser | undefined

  beforeAll(async () => {
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([
      fetch(`${base}/polls/AAAAAAAAAAAA?pick=A&src=newsletter`, { redirect: 'manual' }),
      fetch(`${base}/polls/AAAAAAAAAAAA`),
      fetch(`${base}/polls/AAAAAAAAAAAA/votes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    ])
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  /** The creator posts a three-cover poll from their browser, with a photo for each option. */
  async function postCoverPoll(creator: BrowserContext) {
    const page = await creator.newPage()
    const urls: string[] = []
    for (const cover of COVERS) {
      const res = await creator.request.post(`${base}/images`, { data: await drawCover(page, cover.colour), headers: { 'content-type': 'image/jpeg' } })
      expect(res.status()).toBe(201)
      urls.push(((await res.json()) as { url: string }).url)
    }
    const res = await creator.request.post(`${base}/polls`, {
      data: {
        question: 'Which cover should my novel get?',
        options: COVERS.map((c, i) => ({ text: c.text, imageUrl: urls[i] })),
        target: 20,
        durationHours: 72,
      },
    })
    expect(res.status()).toBe(201)
    return { page, id: ((await res.json()) as { id: string }).id, urls }
  }

  it.each(sizes)(
    '%s: the creator copies both blocks; a reader opens B from it, confirms once, and a second confirm is a 409',
    { timeout: 240_000 },
    async (size) => {
      const creator = await browser!.newContext({ ...SIZES[size], permissions: ['clipboard-read', 'clipboard-write'] })
      const { page, id, urls } = await postCoverPoll(creator)
      await page.goto(`${base}/p/${id}`)
      await hydrated(page, base)

      // The creator's panel and its two copy buttons.
      await page.getByRole('heading', { name: 'Get votes from your newsletter' }).waitFor()
      const copyButtons = page.getByRole('button', { name: /^Copy (HTML block|Markdown)$/ })
      expect(await copyButtons.count()).toBe(2)

      await page.getByRole('button', { name: 'Copy HTML block' }).click()
      await page.getByRole('button', { name: 'Copied' }).waitFor()
      const html = await page.evaluate(() => navigator.clipboard.readText())
      const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => [...item.types]).sort())
      expect(types).toEqual(['text/html', 'text/plain']) // pastes as a table in an email, or as code in an HTML block
      expect(html.startsWith('<table')).toBe(true)
      expect(html).not.toMatch(/<script|<style/i)
      const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({ href: decode(href), inner }))
      expect(links.map((l) => l.href)).toEqual(['A', 'B', 'C'].map((l) => `${base}/polls/${id}?pick=${l}&src=newsletter`))
      links.forEach((link, i) => expect(link.inner).toContain(`src="${urls[i]}"`))

      await page.getByRole('button', { name: 'Copy Markdown' }).click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('](')
      const markdown = (await page.evaluate(() => navigator.clipboard.readText())).split('\n')
      expect(markdown.filter((l) => l.startsWith('!['))).toEqual(urls.map((url, i) => `![${'ABC'[i]}: ${COVERS[i].text}](${url})`))
      expect(markdown.filter((l) => l.startsWith('[Vote'))).toEqual(
        COVERS.map((c, i) => `[Vote ${'ABC'[i]}: ${c.text}](${base}/polls/${id}?pick=${'ABC'[i]}&src=newsletter)`),
      )

      // A link scanner opens every link first (following the redirect, as they do): no vote.
      for (const link of links) expect((await fetch(link.href)).status).toBe(200)
      expect(await voteCount(base, id)).toBe(0)

      // A reader taps B in the email.
      const { context: reader, signals } = await readerContext(browser!, SIZES[size])
      const tab = await reader.newPage()
      await tab.goto(links[1].href)
      expect(tab.url()).toBe(`${base}/p/${id}?pick=B&src=newsletter`)
      await hydrated(tab, base)
      expect(await voteCount(base, id)).toBe(0)
      const confirm = tab.getByRole('button', { name: 'Confirm vote' })
      expect(await confirm.count()).toBe(1)
      const box = (await confirm.boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(tab.viewportSize()!.height) // on the first screen, no scrolling
      expect(await tab.locator('[aria-pressed="true"]').count()).toBe(1)
      expect(await tab.locator('[aria-pressed="true"]').textContent()).toContain('Deep teal')
      expect(await tab.locator('[aria-pressed="false"]').count()).toBe(2)
      expect(await tab.getByRole('button', { name: /^Pick [A-D]$/ }).count()).toBe(0)
      expect(await tab.getByRole('heading', { name: 'Get votes from your newsletter' }).count()).toBe(0) // not theirs
      if (size === 'phone') expect(await tab.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

      // The visit counts as a newsletter visit, with the poll's path.
      await expect
        .poll(() => signals, { timeout: 30_000 })
        .toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, path: `/p/${id}`, source: 'newsletter' }])

      // The same reader had the link open in a second tab too.
      const second = await reader.newPage()
      await second.goto(links[1].href)
      await hydrated(second, base)

      await confirm.click()
      await tab.getByText('You picked').waitFor({ timeout: 30_000 })
      expect(await tab.locator('.card b').first().textContent()).toBe('Deep teal')
      expect(await voteCount(base, id)).toBe(1)
      expect(new URL(tab.url()).search).toBe('') // the address bar now holds the plain share link

      const [response] = await Promise.all([
        second.waitForResponse((r) => r.url().endsWith(`/polls/${id}/votes`)),
        second.getByRole('button', { name: 'Confirm vote' }).click(),
      ])
      expect(response.status()).toBe(409)
      await second.getByText('You already voted on this poll.').waitFor()
      expect(await voteCount(base, id)).toBe(1)

      await reader.close()
      await creator.close()
    },
  )

  it.each(sizes)('%s: a link to a closed poll shows the result page, not a vote button', { timeout: 180_000 }, async (size) => {
    const res = await fetch(`${base}/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Which title?', options: ['The Salt Road', 'Ember Coast', 'North of Quiet'], target: 1, durationHours: 24 }),
    })
    const { id } = (await res.json()) as { id: string }
    const closing = await fetch(`${base}/polls/${id}/votes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"option":2}' })
    expect(closing.status).toBe(201)

    const { context: reader } = await readerContext(browser!, SIZES[size])
    const page = await reader.newPage()
    await page.goto(`${base}/polls/${id}?pick=A&src=newsletter`)
    await hydrated(page, base)
    await page.getByRole('heading', { name: 'Winner: C · North of Quiet' }).waitFor()
    expect(await page.getByRole('button', { name: 'Confirm vote' }).count()).toBe(0)
    expect(await page.locator('[aria-pressed]').count()).toBe(0)
    expect(await page.locator('.face-button').count()).toBe(0)
    expect(await voteCount(base, id)).toBe(1)
    await reader.close()
  })
})
