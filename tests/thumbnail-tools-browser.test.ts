// The thumbnail tools in a real browser: Chromium (playwright-core) on the shared dev server (tests/browser-app.ts:
// in-memory database, sample data only) at desktop size (1280×800) and phone size (iPhone 13, 390 px wide). The
// sample images are drawn in the page, as JPEG, PNG and WebP.
//
// Checks, per GROWTH.md 2026-10-22: each tool page answers 200 with its own <title>, description and h1, and is in
// /sitemap.xml; the Etsy page shows 3 local images as 9 search-grid tiles at 1:1, 4:3 and 5:4 without uploading
// anything; book covers show at 160 and 80 px tall side by side; YouTube candidates show at 16:9 in a desktop-grid
// tile and a phone-feed tile; "Let strangers pick" uploads the images and opens the new-poll form with them as
// options A–C, which posts a poll (a refused photo keeps you on the tool page, with the reason next to it); and
// each tool page sends the visit beacon with its own path.
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it.
import { chromium, devices, type Browser, type BrowserContextOptions, type Locator, type Page, type Request } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { GUIDES } from '@/lib/guides'
import { MAX_IMAGE_BYTES } from '@/lib/limits'
import { SITE_DESCRIPTION } from '@/lib/site'
import { COVER_HEIGHTS, ETSY_CROPS, TOOLS } from '@/lib/tools'

const CHROMIUM = process.env.CHROMIUM_PATH
const SIZES: Record<'desktop' | 'phone', BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { ...devices['iPhone 13'] },
}
const sizes = Object.keys(SIZES) as (keyof typeof SIZES)[]
const pathOf = (kind: (typeof TOOLS)[number]['kind']) => TOOLS.find((t) => t.kind === kind)!.path
const SIGNALS = 'https://idea-factory.1426davejobs.workers.dev/**'

type Sample = { name: string; type: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number; colour: string }

/** Real images from the browser's own encoder: a coloured field with a white square in the middle and a dark band down the left edge, so crops show. */
async function draw(page: Page, samples: Sample[]) {
  const encoded = await page.evaluate(async (samples) => {
    const out: string[] = []
    for (const s of samples) {
      const canvas = document.createElement('canvas')
      canvas.width = s.width
      canvas.height = s.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = s.colour
      ctx.fillRect(0, 0, s.width, s.height)
      ctx.fillStyle = '#222222'
      ctx.fillRect(0, 0, Math.round(s.width / 10), s.height)
      ctx.fillStyle = '#ffffff'
      const side = Math.round(Math.min(s.width, s.height) / 3)
      ctx.fillRect((s.width - side) / 2, (s.height - side) / 2, side, side)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), s.type, 0.9))
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      out.push(btoa(binary))
    }
    return out
  }, samples)
  return samples.map((s, i) => ({ name: s.name, mimeType: s.type, buffer: Buffer.from(encoded[i], 'base64') }))
}

// Three candidates in three formats and three sizes, so the order A–C can be checked after the upload too.
const LISTING_PHOTOS: Sample[] = [
  { name: 'blue-mug.jpg', type: 'image/jpeg', width: 1200, height: 900, colour: '#2a5ac8' },
  { name: 'white-mug.png', type: 'image/png', width: 900, height: 900, colour: '#d9d5cd' },
  { name: 'green-mug.webp', type: 'image/webp', width: 1000, height: 800, colour: '#4c8a5a' },
]
const COVERS: Sample[] = [
  { name: 'cover-red.jpg', type: 'image/jpeg', width: 600, height: 900, colour: '#a0262d' },
  { name: 'cover-navy.png', type: 'image/png', width: 640, height: 1000, colour: '#1d2f5a' },
  { name: 'cover-gold.webp', type: 'image/webp', width: 625, height: 1000, colour: '#c99a2e' },
]
const THUMBNAILS: Sample[] = [
  { name: 'face.jpg', type: 'image/jpeg', width: 1280, height: 720, colour: '#e0662a' },
  { name: 'product.png', type: 'image/png', width: 1280, height: 720, colour: '#3a3a8a' },
  { name: 'text.webp', type: 'image/webp', width: 1200, height: 900, colour: '#2a8a7a' },
]
const SAMPLES = { etsy: LISTING_PHOTOS, 'book-cover': COVERS, youtube: THUMBNAILS }

const loaded = (img: Locator) => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)
const pathname = (url: string) => new URL(url).pathname
/** Anything that would carry an image off the device: a non-GET request, or any request to /images or /polls. */
const uploadsIn = (requests: Request[]) =>
  requests.filter((r) => r.method() !== 'GET' || /^\/(images|polls)(\/|$)/.test(pathname(r.url()))).map((r) => `${r.method()} ${r.url()}`)
const ratioOf = async (el: Locator) => {
  const box = (await el.boundingBox())!
  return box.width / box.height
}
const boxesOf = async (els: Locator) => Promise.all((await els.all()).map(async (el) => (await el.boundingBox())!))

describe.skipIf(!CHROMIUM)('the thumbnail tools in Chromium, at desktop size and 390 px', () => {
  let browser: Browser | undefined
  const base = inject('appBase')

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
  })

  /** A tool page, hydrated (so picking files reaches React), without the Next dev-mode badge, recording every request. */
  async function open(path: string, size: keyof typeof SIZES) {
    const context = await browser!.newContext(SIZES[size])
    const page = await context.newPage()
    const requests: Request[] = []
    page.on('request', (r) => requests.push(r))
    await page.goto(base + path)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]')
      return !!input && Object.keys(input).some((key) => key.startsWith('__reactProps'))
    })
    if (size === 'phone') expect(page.viewportSize()?.width).toBe(390)
    return { context, page, requests }
  }

  async function addImages(page: Page, samples: Sample[]) {
    await page.getByLabel('Add images').setInputFiles(await draw(page, samples))
    const imgs = page.locator('.preview-tile img')
    await expect.poll(() => imgs.count()).toBeGreaterThan(0)
    for (const img of await imgs.all()) await expect.poll(() => loaded(img)).toBe(true)
  }

  const noSidewaysScroll = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

  it('serves each tool page (200) with its own <title>, meta description and an h1 naming the tool, all in /sitemap.xml', async () => {
    const titles = new Set<string>()
    const descriptions = new Set<string>()
    for (const tool of TOOLS) {
      const res = await fetch(base + tool.path)
      expect(res.status).toBe(200)
      const html = await res.text()
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
      const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
      expect(title).toContain(tool.name)
      expect(description.toLowerCase()).toContain(tool.name.toLowerCase())
      expect(description).not.toBe(SITE_DESCRIPTION)
      expect(html.match(/<h1[ >]/g)).toHaveLength(1)
      expect(html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1].replace(/<[^>]+>/g, '')).toBe(tool.name)
      titles.add(title)
      descriptions.add(description)
    }
    expect(titles.size).toBe(TOOLS.length)
    expect(descriptions.size).toBe(TOOLS.length)

    const sitemap = await fetch(`${base}/sitemap.xml`)
    expect(sitemap.status).toBe(200)
    const xml = await sitemap.text()
    for (const tool of TOOLS) expect(xml).toMatch(new RegExp(`<loc>https?://[^<]+${tool.path}</loc>`))
  })

  it.each(sizes)('Etsy (%s): 3 local images make 9 search-grid tiles at 1:1, 4:3 and 5:4, and nothing is uploaded', { timeout: 120_000 }, async (size) => {
    const { context, page, requests } = await open(pathOf('etsy'), size)
    await addImages(page, LISTING_PHOTOS)

    await expect.poll(() => page.locator('.preview-tile').count()).toBe(9)
    let order: string[] | undefined
    for (const crop of ETSY_CROPS) {
      const imgs = page.locator(`section[data-crop="${crop.label}"] .preview-tile img`)
      expect(await imgs.count()).toBe(3)
      const srcs = await imgs.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))
      for (const src of srcs) expect(src).toMatch(/^blob:/)
      expect(new Set(srcs).size).toBe(3)
      order ??= srcs
      expect(srcs).toEqual(order) // A, B, C in every grid
      for (const img of await imgs.all()) {
        expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover')
        expect(Math.abs((await ratioOf(img)) - crop.width / crop.height)).toBeLessThan(0.02)
      }
      expect(await page.locator(`section[data-crop="${crop.label}"] figcaption b`).allTextContents()).toEqual(['A', 'B', 'C'])
    }
    expect(uploadsIn(requests)).toEqual([])
    await noSidewaysScroll(page)
    await context.close()
  })

  it.each(sizes)('Book covers (%s): each cover at about 160 px and 80 px tall, next to the others', { timeout: 120_000 }, async (size) => {
    const { context, page, requests } = await open(pathOf('book-cover'), size)
    await addImages(page, COVERS)

    for (const height of COVER_HEIGHTS) {
      const boxes = await boxesOf(page.locator(`section[data-height="${height}"] .preview-tile img`))
      expect(boxes).toHaveLength(3)
      for (const box of boxes) expect(Math.abs(box.height - height)).toBeLessThanOrEqual(2)
      for (let i = 1; i < boxes.length; i++) {
        expect(Math.abs(boxes[i].y - boxes[0].y)).toBeLessThanOrEqual(1) // one row
        expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 0.5) // side by side, in order
      }
    }
    expect(uploadsIn(requests)).toEqual([])
    await noSidewaysScroll(page)
    await context.close()
  })

  it.each(sizes)('YouTube (%s): each candidate at 16:9 in a desktop-grid tile and a phone-feed tile', { timeout: 120_000 }, async (size) => {
    const { context, page, requests } = await open(pathOf('youtube'), size)
    await addImages(page, THUMBNAILS)

    const grid = page.locator('section.yt-desktop .preview-tile img')
    const feed = page.locator('section.yt-phone .preview-tile img')
    expect(await grid.count()).toBe(3)
    expect(await feed.count()).toBe(3)
    for (const img of [...(await grid.all()), ...(await feed.all())]) {
      expect(Math.abs((await ratioOf(img)) - 16 / 9)).toBeLessThan(0.02)
    }
    const gridBoxes = await boxesOf(grid)
    const feedBoxes = await boxesOf(feed)
    expect(Math.abs(gridBoxes[1].y - gridBoxes[0].y)).toBeLessThanOrEqual(1) // a grid: side by side
    for (let i = 1; i < 3; i++) {
      expect(Math.abs(feedBoxes[i].x - feedBoxes[0].x)).toBeLessThanOrEqual(1) // a feed: one column
      expect(feedBoxes[i].y).toBeGreaterThan(feedBoxes[i - 1].y + feedBoxes[i - 1].height)
    }
    expect(feedBoxes[0].width).toBeGreaterThan(gridBoxes[0].width) // a phone feed tile spans the phone
    expect(feedBoxes[0].width).toBeLessThanOrEqual(430)
    expect(uploadsIn(requests)).toEqual([])
    await noSidewaysScroll(page)
    await context.close()
  })

  const handOffCases = TOOLS.flatMap((tool) => sizes.map((size) => [tool.kind, size] as const))

  it.each(handOffCases)(
    '%s (%s): Let strangers pick uploads the images, opens the new-poll form with them as options A–C, and posts the poll',
    { timeout: 180_000 },
    async (kind, size) => {
      const { context, page, requests } = await open(pathOf(kind), size)
      const uploads: { status: number; url: string | undefined }[] = []
      page.on('response', async (r) => {
        if (r.request().method() === 'POST' && pathname(r.url()) === '/images') {
          uploads.push({ status: r.status(), url: (await r.json().catch(() => null))?.url })
        }
      })
      const samples = SAMPLES[kind]
      await addImages(page, samples)
      expect(uploadsIn(requests)).toEqual([])
      await noSidewaysScroll(page)

      await page.getByRole('button', { name: 'Let strangers pick' }).click()
      await page.waitForURL((url) => url.pathname === '/', { timeout: 60_000 })
      await expect.poll(() => uploads.length).toBe(3)
      expect(uploads.map((u) => u.status)).toEqual([201, 201, 201])

      // The new-poll form, prefilled: one photo per option, A–C, and no fourth option.
      for (const letter of ['A', 'B', 'C']) {
        const thumb = page.getByRole('group', { name: `Option ${letter}` }).locator('img.thumb')
        await thumb.waitFor()
        expect(await thumb.getAttribute('src')).toMatch(/^blob:/)
        await expect.poll(() => loaded(thumb)).toBe(true)
      }
      expect(await page.getByRole('group', { name: 'Option D' }).count()).toBe(0)
      expect(await page.getByLabel('Question').inputValue()).not.toBe('')
      await noSidewaysScroll(page)

      const pollPost = page.waitForRequest((r) => r.method() === 'POST' && pathname(r.url()) === '/polls')
      const created = page.waitForResponse((r) => r.request().method() === 'POST' && pathname(r.url()) === '/polls')
      await page.getByRole('button', { name: 'Create poll' }).click()
      const sent = JSON.parse((await pollPost).postData() ?? 'null') as { options: { imageUrl?: string }[] }
      expect((await created).status()).toBe(201)
      await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })

      // The poll uses the photos the tool uploaded (not uploaded again), in the tool's order.
      expect(uploads).toHaveLength(3)
      const urls = sent.options.map((o) => o.imageUrl)
      expect(urls).toHaveLength(3)
      expect(new Set(urls)).toEqual(new Set(uploads.map((u) => u.url)))
      const imgs = page.locator('.face img')
      await expect.poll(() => imgs.count(), { timeout: 30_000 }).toBe(3)
      for (const img of await imgs.all()) await expect.poll(() => loaded(img), { timeout: 30_000 }).toBe(true)
      expect(await imgs.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))).toEqual(urls)
      expect(await imgs.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).naturalWidth))).toEqual(samples.map((s) => s.width))
      const types = await Promise.all(urls.map(async (url) => (await context.request.get(url!)).headers()['content-type']))
      expect(types).toEqual(samples.map((s) => s.type))
      await noSidewaysScroll(page)
      await context.close()
    },
  )

  it('refuses a photo over 5 MB next to it and posts nothing; the retry uploads only the image that isn’t up yet (phone)', { timeout: 180_000 }, async () => {
    const { context, page, requests } = await open(pathOf('etsy'), 'phone')
    const uploads: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && pathname(r.url()) === '/images') uploads.push(r.status())
    })
    const huge = { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff) }
    await page.getByLabel('Add images').setInputFiles([...(await draw(page, [LISTING_PHOTOS[0]])), huge])
    const listed = page.locator('.candidates li')
    await expect.poll(() => listed.count()).toBe(2)

    await page.getByRole('button', { name: 'Let strangers pick' }).click()
    await expect.poll(() => uploads.length).toBe(2)
    expect([...uploads].sort()).toEqual([201, 413])
    await expect.poll(() => listed.nth(1).getByRole('alert').textContent()).toMatch(/over 5 MB/)
    expect(await listed.nth(0).getByRole('alert').count()).toBe(0)
    await expect.poll(() => page.locator('.tool-cta').getByRole('alert').textContent()).toMatch(/didn't upload/)
    expect(pathname(page.url())).toBe(pathOf('etsy'))
    expect(requests.filter((r) => pathname(r.url()) === '/polls')).toEqual([])

    await listed.nth(1).getByRole('button', { name: 'Remove' }).click()
    await page.getByLabel('Add images').setInputFiles(await draw(page, [LISTING_PHOTOS[1]]))
    await page.getByRole('button', { name: 'Let strangers pick' }).click()
    await page.waitForURL((url) => url.pathname === '/', { timeout: 60_000 })
    expect(uploads).toHaveLength(3) // A went up the first time
    expect(uploads[2]).toBe(201)
    for (const letter of ['A', 'B']) await page.getByRole('group', { name: `Option ${letter}` }).locator('img.thumb').waitFor()
    expect(await page.getByRole('group', { name: 'Option C' }).count()).toBe(0)
    await context.close()
  })

  /** A browser the beacon counts (navigator.webdriver cleared), whose signals are answered here and recorded. */
  async function countedBrowser() {
    const context = await browser!.newContext(SIZES.desktop)
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
    const signals: Record<string, unknown>[] = []
    await context.route(SIGNALS, async (route) => {
      signals.push(JSON.parse(route.request().postData() ?? 'null'))
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    return { context, page: await context.newPage(), signals }
  }

  it.each(TOOLS.map((t) => t.path))('%s sends one visit, with its own path', { timeout: 60_000 }, async (path) => {
    const { context, page, signals } = await countedBrowser()
    await page.goto(base + path)
    await expect.poll(() => signals.length).toBe(1)
    await page.waitForTimeout(500) // no second visit for the same landing
    expect(signals).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, path }])
    await context.close()
  })

  it('a search page’s visit has no path, and a tool page reached from it is counted under its own', { timeout: 60_000 }, async () => {
    const { context, page, signals } = await countedBrowser()
    await page.goto(base + GUIDES[1].path)
    await expect.poll(() => signals.length).toBe(1)
    expect(signals[0]).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null })

    await page.locator('footer').getByRole('link', { name: TOOLS[0].name }).click()
    await page.waitForURL((url) => url.pathname === TOOLS[0].path)
    await expect.poll(() => signals.length).toBe(2)
    expect(signals[1]).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, path: TOOLS[0].path })
    await context.close()
  })
})
