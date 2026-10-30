// The Etsy listing photo test in a real browser: Chromium (playwright-core) at desktop size (1280×800) and on an
// iPhone 13 (390 px wide), against the browser tests' shared dev server (tests/browser-app.ts), on its in-memory
// database with sample photos drawn in the page.
//   1. The page answers 200 with its own <title>, description and h1, and /sitemap.xml lists it.
//   2. Three photos (wide, tall and square) show as square tiles side by side in the mock Etsy search grid, and
//      no request carries a photo.
//   3. "Let strangers pick" opens the new-poll form with them as options A–C; still nothing is sent until
//      "Create poll", which uploads the three and posts a poll whose page shows all three, in order.
//   4. Landing on the page sends the visit beacon with its path; landing elsewhere sends one without.
// Needs CHROMIUM_PATH (a Chromium or Chrome binary; no browser is downloaded), and is skipped without it.
import { chromium, devices, type Browser, type BrowserContextOptions, type Locator, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { PUBLIC_PAGES, SIGNAL_URL } from '@/lib/site'
import { POLL_QUESTION } from '@/app/tools/etsy-listing-photo-test/photo-test'
import { appReady } from './browser-app'

const CHROMIUM = process.env.CHROMIUM_PATH
const PATH = '/tools/etsy-listing-photo-test'
const LETTERS = ['A', 'B', 'C']
const SIZES: [string, BrowserContextOptions][] = [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { ...devices['iPhone 13'] }],
]

type Sample = { name: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; buffer: Buffer }

/** Three product photos of different shapes, encoded by the browser: wide JPEG, tall PNG, square WebP. */
async function samplePhotos(page: Page): Promise<Sample[]> {
  const shapes = [
    { name: 'blue-mug-wide.jpg', type: 'image/jpeg', width: 1200, height: 800, colour: '#2a5ac8' },
    { name: 'white-mug-tall.png', type: 'image/png', width: 600, height: 900, colour: '#d9d5cd' },
    { name: 'green-mug-square.webp', type: 'image/webp', width: 800, height: 800, colour: '#3c8a4a' },
  ] as const
  const encoded = await page.evaluate(
    async (shapes) =>
      Promise.all(
        shapes.map(async ({ type, width, height, colour }) => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#f4ead9'
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = colour
          ctx.fillRect(width * 0.3, height * 0.3, width * 0.4, height * 0.45)
          // Noise, so each file's bytes are its own.
          for (let i = 0; i < 400; i++) {
            ctx.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`
            ctx.fillRect((i * 97) % width, (i * 53) % height, 4, 4)
          }
          const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.9))
          let binary = ''
          for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
          return btoa(binary)
        }),
      ),
    shapes,
  )
  return shapes.map((s, i) => ({ name: s.name, mimeType: s.type, buffer: Buffer.from(encoded[i], 'base64') }))
}

const loaded = (img: Locator) => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)
const pathOf = (url: string) => new URL(url).pathname

describe.skipIf(!CHROMIUM)('the Etsy listing photo test in Chromium', () => {
  let browser: Browser | undefined
  const base = inject('appBase')

  beforeAll(async () => {
    await appReady(base)
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([
      fetch(`${base}${PATH}`),
      fetch(`${base}/sitemap.xml`),
      fetch(`${base}/images`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: '' }),
      fetch(`${base}/images/AAAAAAAAAAAAAAAA`),
      fetch(`${base}/polls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${base}/p/AAAAAAAAAAAA`),
    ])
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  /**
   * A page at this size that records every request to the app, without the Next dev-mode badge. The browser is
   * automated (navigator.webdriver), so the visit beacon stays quiet here.
   */
  async function open(options: BrowserContextOptions) {
    const context = await browser!.newContext(options)
    const page = await context.newPage()
    const requests: { method: string; path: string; body: Buffer | null }[] = []
    page.on('request', (r) => {
      if (r.url().startsWith('http')) requests.push({ method: r.method(), path: pathOf(r.url()), body: r.postDataBuffer() })
    })
    await page.goto(`${base}${PATH}`)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await page.getByLabel('Add photos').waitFor({ state: 'attached' })
    return { context, page, requests }
  }

  /** Adds the three sample photos with the page's own picker; resolves once all three tiles have drawn. */
  async function addPhotos(page: Page) {
    const photos = await samplePhotos(page)
    await page.getByLabel('Add photos').setInputFiles(photos)
    const tiles = page.getByRole('list', { name: 'Mock Etsy search results' }).locator('img')
    await expect.poll(() => tiles.count()).toBe(3)
    for (let i = 0; i < 3; i++) await expect.poll(() => loaded(tiles.nth(i))).toBe(true)
    return { photos, tiles }
  }

  /** No request so far carried any of these photos' bytes, or went to the upload endpoint. */
  function expectNothingSent(requests: { method: string; path: string; body: Buffer | null }[], photos: Sample[]) {
    expect(requests.filter((r) => r.path === '/images')).toEqual([])
    for (const { buffer } of photos) {
      const middle = buffer.subarray(buffer.length >> 1, (buffer.length >> 1) + 48)
      expect(requests.filter((r) => r.body?.includes(middle))).toEqual([])
    }
  }

  const noSidewaysScroll = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

  it('answers 200 with its own title, description and h1, and is in /sitemap.xml', { timeout: 180_000 }, async () => {
    const res = await fetch(`${base}${PATH}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    expect(title).toMatch(/Etsy listing photo test/i)
    const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
    expect(description.length).toBeGreaterThan(80)
    const h1s = html.match(/<h1[^>]*>(.*?)<\/h1>/g) ?? []
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toMatch(/Etsy listing photo test/i)

    // No other public page shares the title.
    const others = await Promise.all(
      PUBLIC_PAGES.filter((p) => p !== PATH).map(async (p) => (await (await fetch(`${base}${p}`)).text()).match(/<title>([^<]*)<\/title>/)?.[1]),
    )
    expect(others).not.toContain(title)

    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text()
    expect(sitemap).toMatch(new RegExp(`<loc>https?://[^<]+${PATH}</loc>`))
  })

  describe.each(SIZES)('at %s size', (size, options) => {
    it('shows three photos as square tiles side by side in the mock Etsy search grid, sending none of them', { timeout: 180_000 }, async () => {
      const { context, page, requests } = await open(options)
      const { photos, tiles } = await addPhotos(page)
      if (size === 'phone') expect(page.viewportSize()?.width).toBe(390)

      const grid = await page.getByRole('list', { name: 'Mock Etsy search results' }).boundingBox()
      const boxes = await tiles.evaluateAll((els) =>
        els.map((el) => {
          const img = el as HTMLImageElement
          const r = img.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height, fit: getComputedStyle(img).objectFit, src: img.src, natural: img.naturalWidth / img.naturalHeight, alt: img.alt }
        }),
      )
      // Each photo, wide, tall or square, is drawn as a square crop that fills its tile.
      expect(boxes.map((b) => b.natural)).toEqual([1.5, 600 / 900, 1])
      for (const [i, b] of boxes.entries()) {
        expect(Math.abs(b.w - b.h)).toBeLessThanOrEqual(1)
        expect(b.w).toBeGreaterThan(100)
        expect(b.fit).toBe('cover')
        expect(b.src).toMatch(/^blob:/)
        expect(b.alt).toContain(`Photo ${LETTERS[i]}`)
        // Inside the grid.
        expect(b.x).toBeGreaterThanOrEqual(grid!.x - 1)
        expect(b.x + b.w).toBeLessThanOrEqual(grid!.x + grid!.width + 1)
      }
      // Next to each other: one row on a desktop; two to a row on a phone, as Etsy's phone grid has.
      if (size === 'desktop') {
        expect(boxes[1].y).toBeCloseTo(boxes[0].y, 0)
        expect(boxes[2].y).toBeCloseTo(boxes[0].y, 0)
        expect(boxes[0].x).toBeLessThan(boxes[1].x)
        expect(boxes[1].x).toBeLessThan(boxes[2].x)
      } else {
        expect(boxes[1].y).toBeCloseTo(boxes[0].y, 0)
        expect(boxes[0].x).toBeLessThan(boxes[1].x)
        expect(boxes[2].y).toBeGreaterThan(boxes[0].y + boxes[0].h)
        expect(boxes[2].x).toBeCloseTo(boxes[0].x, 0)
      }
      await expect.poll(() => page.getByRole('button', { name: 'Let strangers pick' }).isEnabled()).toBe(true)
      await noSidewaysScroll(page)

      // Removing one re-letters the rest; the photos still haven't gone anywhere.
      await page.getByRole('button', { name: 'Remove photo A' }).click()
      await expect.poll(() => tiles.count()).toBe(2)
      expect(await tiles.first().getAttribute('alt')).toContain('Photo A')
      expectNothingSent(requests, photos)
      await context.close()
    })

    it('"Let strangers pick" opens the new-poll form with them as A–C, and the poll it posts shows all three', { timeout: 180_000 }, async () => {
      const { context, page, requests } = await open(options)
      const { photos } = await addPhotos(page)
      await page.getByRole('button', { name: 'Let strangers pick' }).click()

      // The existing new-poll form, with the photos as options A–C and the question filled in.
      await page.waitForURL((url) => url.pathname === '/', { timeout: 60_000 })
      for (const letter of LETTERS) {
        const thumb = page.getByRole('group', { name: `Option ${letter}` }).locator('img.thumb')
        await thumb.waitFor()
        expect(await thumb.getAttribute('src')).toMatch(/^blob:/)
        await expect.poll(() => loaded(thumb)).toBe(true)
      }
      expect(await page.getByRole('group', { name: 'Option D' }).count()).toBe(0)
      expect(await page.getByLabel('Question').inputValue()).toBe(POLL_QUESTION)
      expectNothingSent(requests, photos) // they go up when the poll is created
      await noSidewaysScroll(page)

      const uploads: number[] = []
      page.on('response', (r) => {
        if (r.request().method() === 'POST' && pathOf(r.url()) === '/images') uploads.push(r.status())
      })
      await page.getByRole('button', { name: 'Create poll' }).click()
      await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}$/, { timeout: 60_000 })
      expect(uploads).toEqual([201, 201, 201])

      // The poll page: three options to pick from, each with its photo, served by tiebreak, in A–C order.
      const imgs = page.locator('.grid .face img')
      await expect.poll(() => imgs.count(), { timeout: 30_000 }).toBe(3)
      for (let i = 0; i < 3; i++) await expect.poll(() => loaded(imgs.nth(i)), { timeout: 30_000 }).toBe(true)
      const srcs = await imgs.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))
      for (const src of srcs) expect(src).toMatch(new RegExp(`^${base}/images/[A-Za-z0-9_-]{16}$`))
      const served = await Promise.all(srcs.map((src) => context.request.get(src)))
      expect(served.map((r) => r.status())).toEqual([200, 200, 200])
      expect(served.map((r) => r.headers()['content-type'])).toEqual(photos.map((p) => p.mimeType))
      expect(await page.locator('.grid button.face-button').count()).toBe(3)
      await noSidewaysScroll(page)
      await context.close()
    })
  })

  describe('the visit beacon', () => {
    /** A visitor's browser (not flagged as automated) whose beacon requests are answered here, never sent. */
    async function visitor() {
      const context = await browser!.newContext()
      await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
      const signals: unknown[] = []
      await context.route(SIGNAL_URL, async (route) => {
        signals.push(JSON.parse(route.request().postData() ?? 'null'))
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      })
      const page = await context.newPage()
      return { context, page, signals }
    }

    it('fires on landing with path /tools/etsy-listing-photo-test', { timeout: 120_000 }, async () => {
      const { context, page, signals } = await visitor()
      await page.goto(`${base}${PATH}`)
      await expect.poll(() => signals.length, { timeout: 30_000 }).toBe(1)
      expect(signals[0]).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, path: PATH })
      await context.close()
    })

    it('carries no path for a visit that lands on a search page, and counts the session once', { timeout: 120_000 }, async () => {
      const { context, page, signals } = await visitor()
      await page.goto(`${base}/which-etsy-photo-is-best`)
      await expect.poll(() => signals.length, { timeout: 30_000 }).toBe(1)
      expect(signals[0]).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null })
      // Opening the tool later in the same session is the same visitor: no second visit.
      await page.goto(`${base}${PATH}`)
      await page.getByLabel('Add photos').waitFor({ state: 'attached' })
      await page.waitForTimeout(1500)
      expect(signals).toHaveLength(1)
      await context.close()
    })
  })
})
