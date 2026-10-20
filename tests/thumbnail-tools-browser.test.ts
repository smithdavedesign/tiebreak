// The thumbnail tools in a real browser: Chromium (playwright-core) against the dev server every browser test
// shares (tests/dev-server.ts), on an in-memory database with sample images only.
//   1. Each tool page answers 200 with its own <title>, meta description and h1, and is in /sitemap.xml.
//   2. Three images added on the Etsy page show in a search grid at 1:1, 4:3 and 5:4 (9 tiles), drawn from
//      the device: nothing is uploaded, or sent at all, until the poll button.
//   3. Book covers show about 160 px and 80 px tall side by side; YouTube candidates show at 16:9 in a
//      desktop-grid tile and a phone-feed tile.
//   4. 'Let strangers pick' uploads the images and opens the new-poll form with them as options A–C, which
//      posts a poll with those photos, at desktop size and at phone width (390 px), on every tool page.
//   5. A visit that lands on a tool page sends the beacon with that page's path. RepoHQ's endpoint is
//      stubbed in every context here, so nothing reaches it.
//
// Needs CHROMIUM_PATH (a Chromium or Chrome binary; no browser is downloaded), and is skipped without it.
import { chromium, devices, type Browser, type BrowserContextOptions, type Locator, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES } from '@/lib/limits'
import { SIGNAL_URL } from '@/lib/site'
import { TOOLS, type Tool, type ToolKind } from '@/lib/tools'
import { CHROMIUM, appBase, noSidewaysScroll } from './browser'
import { png } from './image-bytes'

const SIZES: Record<'desktop' | 'phone', BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: devices['iPhone 13'],
}
/** Sample images in the shape each tool's candidates usually come in: plain colour blocks, one per option. */
const SHAPES: Record<ToolKind, [number, number]> = { etsy: [1200, 900], 'book-cover': [400, 600], youtube: [1280, 720] }
const COLOURS: [number, number, number][] = [
  [42, 90, 200],
  [138, 90, 43],
  [80, 150, 110],
]
const samples = (kind: ToolKind) =>
  COLOURS.map((rgb, i) => ({
    name: `${kind}-${'abc'[i]}.png`,
    mimeType: 'image/png',
    buffer: png({ width: SHAPES[kind][0], height: SHAPES[kind][1], rgb }),
  }))

const toolOf = (kind: ToolKind) => TOOLS.find((t) => t.kind === kind)!
const pathOf = (url: string) => new URL(url).pathname
const loaded = (img: Locator) =>
  img.evaluateAll((els) => els.length > 0 && els.every((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
async function boxes(locator: Locator) {
  const all = await locator.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, option: (el as HTMLElement).dataset.option }
    }),
  )
  for (const b of all) expect(b.width * b.height).toBeGreaterThan(0)
  return all
}

describe.skipIf(!CHROMIUM)('the thumbnail tools in Chromium', () => {
  let browser: Browser | undefined
  let base = ''

  beforeAll(async () => {
    base = await appBase()
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([
      ...TOOLS.map((t) => fetch(base + t.path)),
      fetch(`${base}/images`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png() }),
      fetch(`${base}/polls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${base}/polls/AAAAAAAAAAAA`),
      fetch(`${base}/p/AAAAAAAAAAAA`),
      fetch(`${base}/sitemap.xml`),
    ])
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  /** A browser context where the visit beacon can never reach RepoHQ: its endpoint answers here. */
  async function newContext(options: BrowserContextOptions, beacon: string[] = []) {
    const context = await browser!.newContext(options)
    await context.route(SIGNAL_URL, async (route) => {
      beacon.push(route.request().postData() ?? '')
      await route.fulfill({ status: 204 })
    })
    return context
  }

  /** A tool page, without the Next dev-mode badge, and its file picker. */
  async function openTool(page: Page, tool: Tool) {
    await page.goto(base + tool.path)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    const picker = page.getByLabel('Add images')
    await picker.waitFor({ state: 'attached' })
    return picker
  }

  describe('1. the pages', () => {
    it('each answers 200 with its own <title>, meta description and an h1 naming the tool', { timeout: 120_000 }, async () => {
      const seen = { titles: new Set<string>(), descriptions: new Set<string>() }
      for (const tool of TOOLS) {
        const res = await fetch(base + tool.path)
        expect(res.status).toBe(200)
        const html = await res.text()
        const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
        const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
        const h1 = (html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1] ?? '').replace(/<[^>]+>/g, '')
        expect(title).toContain(tool.name)
        expect(description.length).toBeGreaterThan(80)
        expect(h1).toBe(tool.name)
        seen.titles.add(title)
        seen.descriptions.add(description)
      }
      expect(seen.titles.size).toBe(TOOLS.length)
      expect(seen.descriptions.size).toBe(TOOLS.length)
    })

    it('are all listed in /sitemap.xml', async () => {
      const res = await fetch(`${base}/sitemap.xml`)
      expect(res.status).toBe(200)
      const locs = [...(await res.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => pathOf(m[1]))
      for (const tool of TOOLS) expect(locs).toContain(tool.path)
    })
  })

  describe('2. the Etsy preview', () => {
    it.each(Object.keys(SIZES) as (keyof typeof SIZES)[])(
      '%s: 3 local images make 9 tiles at 1:1, 4:3 and 5:4, with nothing uploaded',
      { timeout: 180_000 },
      async (size) => {
        const context = await newContext(SIZES[size])
        const page = await context.newPage()
        const picker = await openTool(page, toolOf('etsy'))
        const sent: string[] = []
        page.on('request', (r) => {
          if (r.method() !== 'GET' || pathOf(r.url()).startsWith('/images')) sent.push(`${r.method()} ${r.url()}`)
        })

        await picker.setInputFiles(samples('etsy'))
        const tiles = page.locator('[data-tile="etsy"]')
        await expect.poll(() => tiles.count()).toBe(9)
        await expect.poll(() => loaded(tiles.locator('img'))).toBe(true)
        const srcs = await tiles.locator('img').evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))
        for (const src of srcs) expect(src).toMatch(/^blob:/)

        for (const [crop, ratio] of [
          ['1:1', 1],
          ['4:3', 4 / 3],
          ['5:4', 5 / 4],
        ] as const) {
          const inCrop = await boxes(page.locator(`[data-tile="etsy"][data-crop="${crop}"]`))
          expect(inCrop.map((b) => b.option)).toEqual(['A', 'B', 'C'])
          for (const b of inCrop) expect(b.width / b.height).toBeCloseTo(ratio, 1)
        }
        expect(sent).toEqual([])
        if (size === 'phone') await noSidewaysScroll(page)
        await context.close()
      },
    )
  })

  describe('3. the book cover and YouTube previews', () => {
    it.each(Object.keys(SIZES) as (keyof typeof SIZES)[])(
      '%s: each cover shows about 160 px and about 80 px tall, next to the others',
      { timeout: 180_000 },
      async (size) => {
        const context = await newContext(SIZES[size])
        const page = await context.newPage()
        await (await openTool(page, toolOf('book-cover'))).setInputFiles(samples('book-cover'))
        for (const height of [160, 80]) {
          const covers = page.locator(`[data-tile="cover"][data-height="${height}"]`)
          await expect.poll(() => loaded(covers)).toBe(true)
          const row = await boxes(covers)
          expect(row.map((b) => b.option)).toEqual(['A', 'B', 'C'])
          for (const b of row) {
            expect(Math.abs(b.height - height)).toBeLessThanOrEqual(2)
            expect(b.width / b.height).toBeCloseTo(400 / 600, 1) // the cover keeps its own shape
            expect(b.y).toBeCloseTo(row[0].y, 0) // one row, side by side
          }
          expect(row[1].x).toBeGreaterThan(row[0].x)
          expect(row[2].x).toBeGreaterThan(row[1].x)
        }
        if (size === 'phone') await noSidewaysScroll(page)
        await context.close()
      },
    )

    it.each(Object.keys(SIZES) as (keyof typeof SIZES)[])(
      '%s: each YouTube candidate shows at 16:9 in a desktop-grid tile and a phone-feed tile',
      { timeout: 180_000 },
      async (size) => {
        const context = await newContext(SIZES[size])
        const page = await context.newPage()
        await (await openTool(page, toolOf('youtube'))).setInputFiles(samples('youtube'))
        for (const place of ['youtube-desktop', 'youtube-phone']) {
          const tiles = page.locator(`[data-tile="${place}"]`)
          await expect.poll(() => loaded(tiles.locator('img'))).toBe(true)
          const all = await boxes(tiles)
          expect(all.map((b) => b.option)).toEqual(['A', 'B', 'C'])
          for (const b of all) expect(b.width / b.height).toBeCloseTo(16 / 9, 1)
        }
        // The phone feed is one column at phone width, tiles stacked.
        const feed = await boxes(page.locator('[data-tile="youtube-phone"]'))
        for (const b of feed) {
          expect(b.width).toBeLessThanOrEqual(390)
          expect(b.x).toBeCloseTo(feed[0].x, 0)
        }
        expect(feed[1].y).toBeGreaterThan(feed[0].y + feed[0].height)
        if (size === 'desktop') {
          // The desktop grid puts them side by side.
          const grid = await boxes(page.locator('[data-tile="youtube-desktop"]'))
          for (const b of grid) expect(b.y).toBeCloseTo(grid[0].y, 0)
        } else {
          await noSidewaysScroll(page)
        }
        await context.close()
      },
    )
  })

  describe("4. 'Let strangers pick'", () => {
    const runs = TOOLS.flatMap((tool) => (Object.keys(SIZES) as (keyof typeof SIZES)[]).map((size) => [tool.kind, size] as const))

    it.each(runs)('%s at %s size: uploads the images, opens the form with them as A–C, and posts the poll', { timeout: 180_000 }, async (kind, size) => {
      const tool = toolOf(kind)
      const images = samples(kind)
      const context = await newContext(SIZES[size])
      const page = await context.newPage()
      const uploads: Promise<{ status: number; url?: string }>[] = []
      const pollPosts: number[] = []
      page.on('response', (r) => {
        if (r.request().method() !== 'POST') return
        if (pathOf(r.url()) === '/images') uploads.push(r.json().then((b) => ({ status: r.status(), url: b?.url })))
        if (pathOf(r.url()) === '/polls') pollPosts.push(r.status())
      })

      await (await openTool(page, tool)).setInputFiles(images)
      await expect.poll(() => page.locator('[data-tile]').count()).toBeGreaterThan(0)
      expect(uploads).toHaveLength(0)
      await page.getByRole('button', { name: 'Let strangers pick' }).click()

      // The new-poll form, with the images already up as options A–C.
      await page.waitForURL((url) => url.pathname === '/', { timeout: 60_000 })
      const uploaded = await Promise.all(uploads)
      expect(uploaded.map((u) => u.status)).toEqual([201, 201, 201])
      for (const letter of ['A', 'B', 'C']) {
        const thumb = page.getByRole('group', { name: `Option ${letter}`, exact: true }).locator('img.thumb')
        await expect.poll(() => loaded(thumb), { timeout: 30_000 }).toBe(true)
        expect(await thumb.getAttribute('src')).toMatch(/^blob:/)
      }
      expect(await page.getByRole('group', { name: 'Option D', exact: true }).count()).toBe(0)
      expect(await page.getByLabel('Question').inputValue()).toBe(tool.question)
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
      if (size === 'phone') await noSidewaysScroll(page)

      // Posting it sends no photo again, and the poll's options are those photos, in order.
      await page.getByRole('button', { name: 'Create poll' }).click()
      await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })
      expect(pollPosts).toEqual([201])
      expect(uploads).toHaveLength(3)
      const id = pathOf(page.url()).split('/').pop()!
      const poll = (await (await context.request.get(`${base}/polls/${id}`)).json()).poll
      const urls: string[] = poll.options.map((o: { imageUrl: string }) => o.imageUrl)
      expect([...urls].sort()).toEqual(uploaded.map((u) => u.url).sort())
      for (const [i, url] of urls.entries()) {
        const res = await context.request.get(url)
        expect(res.status()).toBe(200)
        expect(Buffer.from(await res.body()).equals(images[i].buffer)).toBe(true) // option A is the first image, …
      }
      const photos = page.locator('main img[src*="/images/"]')
      await expect.poll(() => photos.count(), { timeout: 30_000 }).toBe(3)
      await expect.poll(() => loaded(photos), { timeout: 30_000 }).toBe(true)
      if (size === 'phone') await noSidewaysScroll(page)
      await context.close()
    })

    it('keeps 4 of 5 images and leaves out a file that isn’t one, saying why', { timeout: 180_000 }, async () => {
      const context = await newContext(SIZES.desktop)
      const page = await context.newPage()
      const picker = await openTool(page, toolOf('etsy'))
      const five = [...samples('etsy'), ...samples('etsy').slice(0, 2)].map((f, i) => ({ ...f, name: `photo-${i}.png` }))
      await picker.setInputFiles([...five, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') }])
      await expect.poll(() => page.locator('.picks li').count()).toBe(4)
      await expect.poll(() => page.locator('[data-tile="etsy"]').count()).toBe(12)
      expect(await page.getByRole('status').textContent()).toBe(
        "Left out 1 file that isn't an image. A poll takes up to 4 images, so 1 didn't fit.",
      )
      expect(await picker.isDisabled()).toBe(true)
      await page.getByRole('button', { name: 'Remove image B' }).click()
      await expect.poll(() => page.locator('.picks li').count()).toBe(3)
      expect(await picker.isDisabled()).toBe(false)
      await context.close()
    })

    it('a refused image says why under it and opens nothing; without it the rest go, uploaded once', { timeout: 180_000 }, async () => {
      const context = await newContext(SIZES.phone)
      const page = await context.newPage()
      const uploads: number[] = []
      page.on('response', (r) => {
        if (r.request().method() === 'POST' && pathOf(r.url()) === '/images') uploads.push(r.status())
      })
      const tool = toolOf('youtube')
      const tooBig = { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff) }
      await (await openTool(page, tool)).setInputFiles([...samples('youtube').slice(0, 2), tooBig])
      await page.getByRole('button', { name: 'Let strangers pick' }).click()
      const slotC = page.locator('.picks li').nth(2)
      await expect.poll(() => slotC.getByRole('alert').textContent(), { timeout: 60_000 }).toMatch(/over 5 MB/)
      expect([...uploads].sort()).toEqual([201, 201, 413])
      expect(pathOf(page.url())).toBe(tool.path)
      await noSidewaysScroll(page)

      await page.getByRole('button', { name: 'Remove image C' }).click()
      await page.getByRole('button', { name: 'Let strangers pick' }).click()
      await page.waitForURL((url) => url.pathname === '/', { timeout: 60_000 })
      expect(uploads).toHaveLength(3) // A and B went up on the first try
      for (const letter of ['A', 'B']) {
        await expect.poll(() => loaded(page.getByRole('group', { name: `Option ${letter}`, exact: true }).locator('img.thumb'))).toBe(true)
      }
      expect(await page.getByRole('group', { name: 'Option C', exact: true }).count()).toBe(0)
      await context.close()
    })
  })

  describe('5. the visit beacon', () => {
    const landings = [...TOOLS.map((t) => t.path), '/which-etsy-photo-is-best']

    it.each(landings)('a visit landing on %s carries that path', { timeout: 120_000 }, async (path) => {
      const beacon: string[] = []
      const context = await newContext(SIZES.desktop, beacon)
      // A visitor's browser, not an automated one: the beacon skips navigator.webdriver.
      await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
      const page = await context.newPage()
      await page.goto(base + path)
      await expect.poll(() => beacon.length, { timeout: 30_000 }).toBe(1)
      expect(JSON.parse(beacon[0])).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, path })
      await context.close()
    })

    // Why the other browser tests never count as visits, though this dev server has the beacon on.
    it('an automated browser sends nothing', { timeout: 120_000 }, async () => {
      const beacon: string[] = []
      const context = await newContext(SIZES.desktop, beacon)
      const page = await context.newPage()
      await page.goto(base + TOOLS[0].path)
      expect(await page.evaluate(() => navigator.webdriver)).toBe(true)
      await page.waitForTimeout(3000)
      expect(beacon).toEqual([])
      await context.close()
    })
  })
})
