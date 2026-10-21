// The thumbnail preview tools in a real browser: Chromium (playwright-core) at desktop size (1280×800) and
// at phone width (iPhone 13, 390 px), against the dev server on an in-memory database with sample data only.
// - Each tool page answers 200 with its own <title>, meta description and h1, and /sitemap.xml lists it.
// - Local images are previewed with no request leaving the page: Etsy, 9 tiles at 1:1, 4:3 and 5:4; book
//   covers at 160 and 80 px tall, side by side; YouTube at 16:9 in a desktop grid and a phone feed.
// - "Let strangers pick" uploads them and opens the new-poll form with them as options A–C; posting it
//   creates the poll, which shows the three photos from tiebreak.
// - Each tool page sends the visit beacon with its own path.
//
// Needs CHROMIUM_PATH (no browser is downloaded) and is skipped without it, like
// tests/photo-upload-browser.test.ts. The beacon's code is compiled in (NEXT_PUBLIC_VERCEL_ENV=production)
// so it can be checked, but no event leaves the machine: every browser context answers the signal URL
// itself, and only the beacon test turns navigator.webdriver off. No real database or Stripe setting from
// this shell reaches the app.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium, devices, type Browser, type Locator, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SIGNAL_URL } from '@/lib/site'
import { TOOLS, toolBySlug, type Tool } from '@/lib/tools'
import { png } from './image-bytes'

const CHROMIUM = process.env.CHROMIUM_PATH
const SIZES = { desktop: { viewport: { width: 1280, height: 800 } }, phone: devices['iPhone 13'] }
type Size = keyof typeof SIZES
const SIZE_NAMES = Object.keys(SIZES) as Size[]
const root = fileURLToPath(new URL('..', import.meta.url))

async function freePort() {
  const server = createServer().listen(0)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  server.close()
  await once(server, 'close')
  return port
}

async function waitForApp(base: string, app: ChildProcess) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error('The dev server exited before it answered.')
    try {
      if ((await fetch(base)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The dev server did not answer on ${base}`)
}

type Sample = { name: string; mimeType: string; buffer: Buffer }

/** Sample images from the browser's own JPEG encoder: each its own colour, with a white block in the middle. */
async function samples(page: Page, n: number, { width = 600, height = 800 } = {}): Promise<Sample[]> {
  const encoded = await page.evaluate(
    async ({ n, width, height }) => {
      const colours = ['#2a5ac8', '#8a5a2b', '#2f8f5b', '#b0306a']
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = colours[i % colours.length]
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(width / 4, height / 4, width / 2, height / 2)
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
        let binary = ''
        for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
        out.push(btoa(binary))
      }
      return out
    },
    { n, width, height },
  )
  return encoded.map((b64, i) => ({ name: `candidate-${'abcd'[i]}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') }))
}

const isPath = (url: string, path: string) => url.startsWith('http') && new URL(url).pathname === path
const allLoaded = (imgs: Locator) =>
  imgs.evaluateAll((els) => els.length > 0 && els.every((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
const boxes = (imgs: Locator) =>
  imgs.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }),
  )
const ratioOf = (b: { width: number; height: number }) => b.width / b.height
const decode = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

describe.skipIf(!CHROMIUM)('the thumbnail preview tools in Chromium, at desktop size and phone width', () => {
  let app: ChildProcess | undefined
  let browser: Browser | undefined
  let base = ''

  beforeAll(async () => {
    const port = await freePort()
    base = `http://localhost:${port}`
    const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', HOUSE_POLLS: 'off' }
    for (const name of Object.keys(env)) {
      const drop =
        name === 'DATABASE_URL' ||
        name === 'NODE_ENV' ||
        name.startsWith('STRIPE_') ||
        name.startsWith('VITEST') ||
        name.endsWith('VERCEL_ENV')
      if (drop) delete env[name]
    }
    // The beacon's code is live, so its path can be checked; the signal URL never leaves the browser (open()).
    env.NEXT_PUBLIC_VERCEL_ENV = 'production'
    const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env,
    })
    app = server
    await waitForApp(base, server)
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([
      ...TOOLS.map((t) => fetch(base + t.path)),
      fetch(`${base}/sitemap.xml`),
      fetch(`${base}/images`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png() }),
      fetch(`${base}/polls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${base}/p/AAAAAAAAAAAA`),
    ])
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
    try {
      if (app?.pid) process.kill(-app.pid, 'SIGTERM')
    } catch {}
  })

  /**
   * A fresh browser (so a fresh session) on `path`, once the page is ready to take files. The signal URL is
   * answered here and recorded, so no event leaves the machine. `beacon` makes the browser look like a
   * person's (navigator.webdriver false), so the beacon sends.
   */
  async function open(size: Size, path: string, { beacon = false } = {}) {
    const context = await browser!.newContext({ ...SIZES[size] })
    const signals: unknown[] = []
    await context.route(SIGNAL_URL, async (route) => {
      signals.push(JSON.parse(route.request().postData() ?? 'null'))
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    if (beacon) await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }))
    const page = await context.newPage()
    await page.goto(base + path)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    if (path.startsWith('/tools/')) await expect.poll(() => page.getByLabel('Add images').isEnabled(), { timeout: 60_000 }).toBe(true)
    return { context, page, signals }
  }

  const addImages = (page: Page, files: Sample[]) => page.getByLabel('Add images').setInputFiles(files)
  const noSidewaysScroll = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

  it('each tool page answers 200 with its own <title>, meta description and h1, and /sitemap.xml lists all three', async () => {
    const titles = new Set<string>()
    const descriptions = new Set<string>()
    for (const tool of TOOLS) {
      const res = await fetch(base + tool.path)
      expect(res.status).toBe(200)
      const html = await res.text()
      const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '')
      const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '')
      const h1s = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')))
      expect(title).toBe(`${tool.title} · tiebreak`)
      expect(description).toBe(tool.description)
      expect(h1s).toEqual([tool.name])
      titles.add(title)
      descriptions.add(description)
    }
    expect(titles.size).toBe(3)
    expect(descriptions.size).toBe(3)
    const sitemap = await fetch(`${base}/sitemap.xml`)
    expect(sitemap.status).toBe(200)
    const xml = await sitemap.text()
    for (const tool of TOOLS) expect(xml).toMatch(new RegExp(`<loc>https?://[^<]+${tool.path}</loc>`))
    expect((await fetch(`${base}/tools/instagram-thumbnail-preview`)).status).toBe(404)
  })

  it.each(SIZE_NAMES)(
    'Etsy (%s): 3 local images make 9 search-grid tiles, at 1:1, 4:3 and 5:4, and nothing leaves the page',
    { timeout: 180_000 },
    async (size) => {
      const { context, page } = await open(size, '/tools/etsy-thumbnail-preview')
      const sent: string[] = []
      page.on('request', (r) => {
        if (r.method() !== 'GET' || isPath(r.url(), '/images')) sent.push(`${r.method()} ${r.url()}`)
      })
      await addImages(page, await samples(page, 3))
      await expect.poll(() => page.locator('img[data-view]').count()).toBe(9)
      for (const [view, ratio] of [['1:1', 1], ['4:3', 4 / 3], ['5:4', 5 / 4]] as const) {
        const imgs = page.locator(`.mock-grid img[data-view="${view}"]`)
        expect(await imgs.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.option))).toEqual(['A', 'B', 'C'])
        await expect.poll(() => allLoaded(imgs)).toBe(true)
        for (const box of await boxes(imgs)) expect(Math.abs(ratioOf(box) - ratio)).toBeLessThan(0.02)
        for (const src of await imgs.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))) expect(src).toMatch(/^blob:/)
      }
      // The images were drawn from the device: no upload, no POST, nothing but page loads.
      expect(sent).toEqual([])
      await noSidewaysScroll(page)
      await context.close()
    },
  )

  it.each(SIZE_NAMES)(
    'book covers (%s): each cover at about 160 px and about 80 px tall, next to the others',
    { timeout: 180_000 },
    async (size) => {
      const { context, page } = await open(size, '/tools/book-cover-thumbnail-test')
      // 1600×2560 is a common ebook cover shape (5:8); these are a quarter of that.
      await addImages(page, await samples(page, 3, { width: 400, height: 640 }))
      for (const [view, px] of [['160', 160], ['80', 80]] as const) {
        const imgs = page.locator(`.mock-shelf img[data-view="${view}"]`)
        await expect.poll(() => imgs.count()).toBe(3)
        await expect.poll(() => allLoaded(imgs)).toBe(true)
        const row = await boxes(imgs)
        for (const box of row) {
          expect(Math.abs(box.height - px)).toBeLessThan(2)
          expect(Math.abs(ratioOf(box) - 400 / 640)).toBeLessThan(0.02) // whole, not cropped
        }
        // Side by side: one row, A then B then C, not overlapping.
        for (let i = 1; i < row.length; i++) {
          expect(Math.abs(row[i].y - row[0].y)).toBeLessThan(2)
          expect(row[i].x).toBeGreaterThanOrEqual(row[i - 1].x + row[i - 1].width)
        }
      }
      await noSidewaysScroll(page)
      await context.close()
    },
  )

  it.each(SIZE_NAMES)(
    'YouTube (%s): each candidate at 16:9 in a desktop-grid tile and in a phone-feed tile',
    { timeout: 180_000 },
    async (size) => {
      const { context, page } = await open(size, '/tools/youtube-thumbnail-preview')
      await addImages(page, await samples(page, 3, { width: 1024, height: 768 }))
      const grid = page.locator('.mock-grid img[data-view="desktop"]')
      const feed = page.locator('.mock-feed img[data-view="phone"]')
      for (const imgs of [grid, feed]) {
        await expect.poll(() => imgs.count()).toBe(3)
        await expect.poll(() => allLoaded(imgs)).toBe(true)
        expect(await imgs.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.option))).toEqual(['A', 'B', 'C'])
        for (const box of await boxes(imgs)) expect(Math.abs(ratioOf(box) - 16 / 9)).toBeLessThan(0.02)
      }
      // The desktop grid puts tiles side by side; the phone feed stacks phone-wide tiles in one column.
      const gridBoxes = await boxes(grid)
      expect(Math.abs(gridBoxes[1].y - gridBoxes[0].y)).toBeLessThan(2)
      expect(gridBoxes[1].x).toBeGreaterThan(gridBoxes[0].x)
      const feedBoxes = await boxes(feed)
      for (let i = 1; i < feedBoxes.length; i++) {
        expect(Math.abs(feedBoxes[i].x - feedBoxes[0].x)).toBeLessThan(2)
        expect(feedBoxes[i].y).toBeGreaterThan(feedBoxes[i - 1].y + feedBoxes[i - 1].height)
      }
      for (const box of feedBoxes) expect(box.width).toBeLessThanOrEqual(390)
      if (size === 'desktop') expect(feedBoxes[0].width).toBeLessThan(gridBoxes[0].width * 2)
      await noSidewaysScroll(page)
      await context.close()
    },
  )

  const FLOWS = TOOLS.flatMap((t) => SIZE_NAMES.map((size) => [t.slug, size] as [string, Size]))

  it.each(FLOWS)(
    '%s (%s): "Let strangers pick" uploads the images, opens the new-poll form with them as A–C, and posting it creates the poll',
    { timeout: 180_000 },
    async (slug, size) => {
      const tool = toolBySlug(slug) as Tool
      const { context, page } = await open(size, tool.path)
      const uploads: { status: number; id?: string }[] = []
      const pollPosts: { question: string; options: { imageUrl?: string }[] }[] = []
      page.on('response', async (r) => {
        if (r.request().method() === 'POST' && isPath(r.url(), '/images')) {
          const body = await r.json().catch(() => ({}))
          uploads.push({ status: r.status(), id: body.id })
        }
      })
      page.on('request', (r) => {
        if (r.method() === 'POST' && isPath(r.url(), '/polls')) pollPosts.push(r.postDataJSON())
      })

      await addImages(page, await samples(page, 3))
      await expect.poll(() => page.locator('img[data-view]').count()).toBe(3 * tool.views.length)
      expect(uploads).toEqual([])
      await noSidewaysScroll(page)

      await page.getByRole('button', { name: 'Let strangers pick' }).click()
      await page.waitForURL((url) => url.pathname === '/' && url.searchParams.getAll('photo').length === 3, { timeout: 60_000 })
      await expect.poll(() => uploads.length).toBe(3)
      expect(uploads.map((u) => u.status)).toEqual([201, 201, 201])
      const query = new URL(page.url()).searchParams
      const photos = query.getAll('photo')
      expect(query.get('tool')).toBe(slug)
      expect([...photos].sort()).toEqual(uploads.map((u) => u.id).sort())

      // The new-poll form: options A–C, each holding its photo (drawn from the same file), and the tool's question.
      for (const letter of ['A', 'B', 'C']) {
        const thumb = page.getByRole('group', { name: `Option ${letter}` }).locator('img.thumb')
        await thumb.waitFor()
        expect(await thumb.getAttribute('src')).toMatch(/^blob:/)
        await expect.poll(() => allLoaded(thumb)).toBe(true)
      }
      expect(await page.getByRole('group', { name: 'Option D' }).count()).toBe(0)
      expect(await page.getByLabel('Question').inputValue()).toBe(tool.question)
      await noSidewaysScroll(page)

      await page.getByRole('button', { name: 'Create poll' }).click()
      await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })
      expect(uploads).toHaveLength(3) // the form didn't upload them again
      expect(pollPosts).toHaveLength(1)
      expect(pollPosts[0].question).toBe(tool.question)
      expect(pollPosts[0].options.map((o) => new URL(o.imageUrl ?? '').pathname)).toEqual(photos.map((id) => `/images/${id}`))

      // The poll exists, with the three photos as its options, served by tiebreak now that the poll uses them.
      const id = new URL(page.url()).pathname.split('/').pop()
      const res = await context.request.get(`${base}/polls/${id}`)
      expect(res.status()).toBe(200)
      const { poll } = await res.json()
      expect(poll.options.map((o: { imageUrl: string }) => new URL(o.imageUrl).pathname)).toEqual(photos.map((p) => `/images/${p}`))
      const imgs = page.locator('img[src*="/images/"]')
      await expect.poll(() => imgs.count(), { timeout: 30_000 }).toBe(3)
      await expect.poll(() => allLoaded(imgs), { timeout: 30_000 }).toBe(true)
      for (const p of photos) expect((await context.request.get(`${base}/images/${p}`)).status()).toBe(200)
      await context.close()
    },
  )

  it('takes 2–4 images: one is not enough for a poll, a fifth is left out, and a refused upload is named in its slot', { timeout: 180_000 }, async () => {
    const { context, page } = await open('phone', '/tools/etsy-thumbnail-preview')
    const pick = page.getByRole('button', { name: 'Let strangers pick' })
    const uploads: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && isPath(r.url(), '/images')) uploads.push(r.status())
    })
    const [a, b, c, d] = await samples(page, 4)

    await addImages(page, [a])
    await expect.poll(() => page.locator('img[data-view]').count()).toBe(3)
    expect(await pick.isDisabled()).toBe(true)

    await addImages(page, [b, c, d, { ...a, name: 'fifth.jpg' }])
    await expect.poll(() => page.locator('img[data-view="1:1"]').count()).toBe(4)
    await expect.poll(() => page.getByRole('status').textContent()).toMatch(/1 was left out/)
    await page.getByRole('listitem').filter({ hasText: 'candidate-d.jpg' }).getByRole('button', { name: 'Remove' }).click()
    await page.getByRole('listitem').filter({ hasText: 'candidate-c.jpg' }).getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => page.locator('img[data-view="1:1"]').count()).toBe(2)

    // Not a photo, whatever its label says: the server refuses it, and the slot says why. Nothing opens.
    await addImages(page, [{ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not a photo') }])
    await pick.click()
    const slot = page.getByRole('listitem').filter({ hasText: 'notes.png' })
    await expect.poll(() => slot.getByRole('alert').textContent(), { timeout: 30_000 }).toMatch(/JPEG, PNG or WebP/)
    expect([...uploads].sort()).toEqual([201, 201, 415])
    expect(new URL(page.url()).pathname).toBe('/tools/etsy-thumbnail-preview')

    // Without it, the two that were stored go on as A and B, without being sent again.
    await slot.getByRole('button', { name: 'Remove' }).click()
    await pick.click()
    await page.waitForURL((url) => url.pathname === '/', { timeout: 60_000 })
    expect(uploads).toHaveLength(3)
    expect(new URL(page.url()).searchParams.getAll('photo')).toHaveLength(2)
    for (const letter of ['A', 'B']) await page.getByRole('group', { name: `Option ${letter}` }).locator('img.thumb').waitFor()
    expect(await page.getByRole('group', { name: 'Option C' }).count()).toBe(0)
    await context.close()
  })

  it('each tool page sends the visit beacon with its own path, apart from the search pages', { timeout: 180_000 }, async () => {
    const paths = [...TOOLS.map((t) => t.path), '/which-etsy-photo-is-best']
    for (const path of paths) {
      const { context, page, signals } = await open('desktop', path, { beacon: true })
      await expect.poll(() => signals.length, { timeout: 30_000 }).toBe(1)
      expect(signals[0]).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, path })
      // Once per session: moving on to another page sends nothing more.
      await page.goto(`${base}/tools/youtube-thumbnail-preview`)
      await page.waitForLoadState('load')
      expect(signals).toHaveLength(1)
      await context.close()
    }
  })
})
