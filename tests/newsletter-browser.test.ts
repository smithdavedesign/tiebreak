// Vote from your newsletter in a real browser: Chromium (playwright-core) at desktop size (1280×800) and phone
// width (iPhone 13, 390 px), against the shared dev server (tests/browser-app.ts; in-memory database, sample data
// only). The creator copies the email block, a reader opens option B's link from it, finds B picked with one
// "Confirm vote" button and no vote recorded yet, and confirms: exactly one vote. A second confirm from another tab
// is a 409 and changes nothing; a link to a closed poll shows the result; the landing's visit carries the poll's
// path and source "newsletter". Nothing reaches RepoHQ: the signal request is answered inside the page.
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it.
import { chromium, devices, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { SIGNAL_URL } from '@/lib/site'

const CHROMIUM = process.env.CHROMIUM_PATH
const SIZES: [string, BrowserContextOptions][] = [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { ...devices['iPhone 13'] }],
]

/** Three sample covers, drawn as SVG so the test needs no image host. */
const COVER_COLOURS = ['#1b6f78', '#b8322a', '#22223b']

describe.skipIf(!CHROMIUM)('vote from your newsletter in Chromium, at desktop size and 390 px', () => {
  let browser: Browser | undefined
  const base = inject('appBase')

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  /** A browser of its own (cookies and all), without the Next dev-mode badge over the page. */
  async function person(options: BrowserContextOptions, extra: BrowserContextOptions = {}) {
    const context = await browser!.newContext({ ...options, ...extra })
    await context.addInitScript(() => {
      addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = 'nextjs-portal { display: none !important }'
        document.head.append(style)
      })
    })
    return context
  }

  /** The creator posts a three-photo poll from their own browser (so it's theirs) and opens it. */
  async function creatorWithPoll(options: BrowserContextOptions, target = 20) {
    const context = await person(options, { permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    await page.goto(base)
    const photos = await Promise.all(COVER_COLOURS.map((colour) => uploadCover(page, colour)))
    const res = await page.request.post(`${base}/polls`, {
      data: {
        question: 'Which cover for The Salt Road?',
        options: [
          { text: 'Teal waves', imageUrl: photos[0] },
          { text: 'Red sun', imageUrl: photos[1] },
          { text: 'Night ink', imageUrl: photos[2] },
        ],
        target,
        durationHours: 72,
      },
    })
    expect(res.status()).toBe(201)
    const id = ((await res.json()) as { id: string }).id
    await page.goto(`${base}/p/${id}`)
    return { context, page, id }
  }

  /** A cover photo drawn in the page and uploaded as the form would (a PNG). Returns its URL on tiebreak. */
  async function uploadCover(page: Page, colour: string) {
    return page.evaluate(async (colour) => {
      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 450
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = colour
      ctx.fillRect(0, 0, 300, 450)
      ctx.fillStyle = '#f4efe6'
      ctx.fillRect(30, 150, 240, 80)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
      const res = await fetch('/images', { method: 'POST', headers: { 'content-type': 'image/png' }, body: blob })
      return ((await res.json()) as { url: string }).url
    }, colour)
  }

  async function voteCount(id: string) {
    const res = await fetch(`${base}/polls/${id}`)
    return ((await res.json()) as { poll: { voteCount: number } }).poll.voteCount
  }

  /** What the clipboard holds after a copy button: its text/plain and text/html. */
  async function clipboard(page: Page) {
    return page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const read = async (type: string) => (item.types.includes(type) ? await (await item.getType(type)).text() : null)
      return { plain: await read('text/plain'), html: await read('text/html') }
    })
  }

  /** A reader's browser whose visit beacon is captured here (it would send nothing from an automated browser). */
  async function readerWithBeacon(options: BrowserContextOptions) {
    const context = await person(options)
    const signals: unknown[] = []
    await context.exposeFunction('__tiebreakSignal', (body: string) => void signals.push(JSON.parse(body)))
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

  const noSidewaysScroll = async (page: Page, width: number) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

  for (const [size, options] of SIZES) {
    it(`${size}: the creator copies the email block; a reader opens option B's link, finds B picked, and confirming records one vote`, { timeout: 180_000 }, async () => {
      const width = options.viewport!.width
      const { context: creator, page, id } = await creatorWithPoll(options)
      const panel = page.getByRole('region', { name: 'Get votes from your newsletter' })
      await panel.waitFor({ timeout: 60_000 })
      await noSidewaysScroll(page, width)

      // The email block: a table with one link per option, on the clipboard as HTML and as its source.
      await panel.getByRole('button', { name: 'Copy email block (HTML)' }).click()
      await panel.getByRole('button', { name: 'Copied' }).waitFor()
      const email = await clipboard(page)
      expect(email.plain).toMatch(/^<table[\s>]/)
      expect(email.html).toContain('<table')
      const links = ['A', 'B', 'C'].map((l) => `${base}/polls/${id}?pick=${l}&src=newsletter`)

      // The block as an email client shows it: three links, each around its option's photo.
      const inbox = await (await person(options)).newPage()
      await inbox.setContent(email.plain!)
      expect(await inbox.locator('a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))).toEqual(links)
      expect(await inbox.locator('a img').count()).toBe(3)
      expect(await inbox.locator('script, style').count()).toBe(0)

      // The Substack block: Markdown as text, and the same lines as rich HTML (what Substack's editor takes).
      await panel.getByRole('button', { name: 'Copy Substack block (Markdown)' }).click()
      await expect.poll(async () => (await clipboard(page)).plain?.startsWith('**')).toBe(true)
      const post = await clipboard(page)
      expect(post.plain!.split('\n').filter((l) => l.startsWith('!['))).toHaveLength(3)
      expect(post.plain!.split('\n').filter((l) => l.startsWith('['))).toHaveLength(3)
      for (const link of links) expect(post.plain).toContain(`(${link})`)
      expect(post.html).not.toContain('<table')

      // A reader clicks option B in their inbox. Opening the link votes for nothing.
      const { context: reader, signals } = await readerWithBeacon(options)
      const readerPage = await reader.newPage()
      await readerPage.goto(links[1])
      expect(new URL(readerPage.url()).pathname).toBe(`/p/${id}`)
      const confirm = readerPage.getByRole('button', { name: 'Confirm vote' })
      await confirm.waitFor({ timeout: 60_000 })
      expect(await confirm.count()).toBe(1)
      expect(await readerPage.getByRole('radio').count()).toBe(3)
      expect(await readerPage.getByRole('radio', { checked: true }).count()).toBe(1)
      expect(await readerPage.getByRole('radio').nth(1).isChecked()).toBe(true)
      await noSidewaysScroll(readerPage, width)
      expect(await voteCount(id)).toBe(0)

      // The landing's visit: the poll's path and source "newsletter".
      await expect
        .poll(() => signals, { timeout: 30_000 })
        .toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, path: `/p/${id}`, source: 'newsletter' }])

      const voted = readerPage.waitForResponse((r) => r.url().endsWith(`/polls/${id}/votes`))
      await confirm.click()
      expect((await voted).status()).toBe(201)
      await readerPage.getByText('You picked').waitFor()
      expect(await readerPage.getByText('Red sun').count()).toBeGreaterThan(0)
      expect(await confirm.count()).toBe(0)
      expect(await voteCount(id)).toBe(1)

      await reader.close()
      await creator.close()
    })
  }

  it('a second confirm by the same voter (another tab, opened first) gets a 409, and the count stays at one', { timeout: 180_000 }, async () => {
    const [, phone] = SIZES[1]
    const { context: creator, id } = await creatorWithPoll(phone)
    const reader = await person(phone)
    // Two tabs of one browser: the first confirm mints the voter's cookie, and the second tab sends it.
    const first = await reader.newPage()
    await first.goto(`${base}/polls/${id}?pick=A&src=newsletter`)
    await first.getByRole('button', { name: 'Confirm vote' }).waitFor({ timeout: 60_000 })
    const second = await reader.newPage()
    await second.goto(`${base}/polls/${id}?pick=C&src=newsletter`)
    await second.getByRole('button', { name: 'Confirm vote' }).waitFor({ timeout: 60_000 })

    const one = first.waitForResponse((r) => r.url().endsWith(`/polls/${id}/votes`))
    await first.getByRole('button', { name: 'Confirm vote' }).click()
    expect((await one).status()).toBe(201)
    await first.getByText('You picked').waitFor()

    const two = second.waitForResponse((r) => r.url().endsWith(`/polls/${id}/votes`))
    await second.getByRole('button', { name: 'Confirm vote' }).click()
    expect((await two).status()).toBe(409)
    await second.getByText('You already voted on this poll.').waitFor()
    expect(await voteCount(id)).toBe(1)
    await reader.close()
    await creator.close()
  })

  it('a ?pick= link to a closed poll shows the result page, not a vote button', { timeout: 180_000 }, async () => {
    const [, desktop] = SIZES[0]
    const { context: creator, page, id } = await creatorWithPoll(desktop, 1)
    await page.getByRole('button', { name: /Night ink/ }).click() // the creator's own vote closes it at 1
    await page.getByText('Winner: C').waitFor({ timeout: 60_000 })

    const reader = await person(desktop)
    const readerPage = await reader.newPage()
    await readerPage.goto(`${base}/polls/${id}?pick=A&src=newsletter`)
    await readerPage.getByText('Winner: C').waitFor({ timeout: 60_000 })
    expect(await readerPage.getByRole('button', { name: 'Confirm vote' }).count()).toBe(0)
    expect(await readerPage.getByRole('radio').count()).toBe(0)
    await reader.close()
    await creator.close()
  })

  it("the panel isn't there for a reader, only for the creator", { timeout: 180_000 }, async () => {
    const [, phone] = SIZES[1]
    const { context: creator, page, id } = await creatorWithPoll(phone)
    await page.getByRole('region', { name: 'Get votes from your newsletter' }).waitFor({ timeout: 60_000 })
    const reader: BrowserContext = await person(phone)
    const readerPage = await reader.newPage()
    await readerPage.goto(`${base}/p/${id}`)
    await readerPage.getByRole('button', { name: /Teal waves/ }).waitFor({ timeout: 60_000 })
    expect(await readerPage.getByText('Get votes from your newsletter').count()).toBe(0)
    await reader.close()
    await creator.close()
  })
})
