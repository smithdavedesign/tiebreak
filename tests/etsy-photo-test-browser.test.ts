// The Etsy listing photo tester in a real browser: Chromium (playwright-core) against the dev server, on an
// in-memory database with sample data only. Three local photos (landscape, portrait, square) become square
// tiles in the mock Etsy search grid, and the network log shows nothing carries them until a poll is asked
// for. "Let strangers pick" opens the new-poll form with them as options A–C, and the poll it creates shows
// all three, at desktop size and on a 390 px phone. Loading the page sends the visit beacon with its path.
//
// The dev server runs with NEXT_PUBLIC_VERCEL_ENV=production so the beacon's code runs. Nothing leaves this
// machine: every request to another host is answered here (the beacon, with 204) or refused, and Chromium
// can't resolve any host but localhost anyway. Automated browsers send no beacon, so only the beacon test
// unsets navigator.webdriver.
//
// Needs CHROMIUM_PATH (a Chromium or Chrome binary; no browser is downloaded), and is skipped without it. The
// app never sees a real database or Stripe setting from this shell: those variables are dropped.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  devices,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Request,
} from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ETSY_PHOTO_TEST_PATH, SIGNAL_URL } from '@/lib/site'

const CHROMIUM = process.env.CHROMIUM_PATH
const root = fileURLToPath(new URL('..', import.meta.url))
const SIZES: [string, BrowserContextOptions][] = [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', devices['iPhone 13']],
]
const TITLE = 'Free Etsy listing photo tester: compare main photos in a search grid · tiebreak'
const QUESTION = 'Which picture do you think is best for my Etsy listing?'
const LETTERS = ['A', 'B', 'C']
/** Three candidate main photos, one of each shape and type, so the square crop has something to crop. */
const SAMPLES = [
  { name: 'mug-on-shelf.jpg', type: 'image/jpeg', width: 1200, height: 900, colour: '#2a5ac8' },
  { name: 'mug-in-hand.png', type: 'image/png', width: 900, height: 1200, colour: '#8a5a2b' },
  { name: 'mug-flat-lay.webp', type: 'image/webp', width: 1000, height: 1000, colour: '#1f9d55' },
] as const

type Beacon = { slug: string; kind: string; referrer: string | null; path?: string }

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

/** The sample photos as real files from the browser's own encoders: a coloured scene with a white mug shape. */
async function samplePhotos(context: BrowserContext) {
  const page = await context.newPage()
  const encoded = await page.evaluate(async (samples) => {
    const out: string[] = []
    for (const { type, width, height, colour } of samples) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = colour
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(width * 0.3, height * 0.3, width * 0.4, height * 0.45)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.9))
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      out.push(btoa(binary))
    }
    return out
  }, SAMPLES)
  await page.close()
  return SAMPLES.map((s, i) => ({ name: s.name, mimeType: s.type, buffer: Buffer.from(encoded[i], 'base64') }))
}

type Photo = Awaited<ReturnType<typeof samplePhotos>>[number]

/** Whether a request's body holds any of the photos (a run of its bytes from the middle of the file). */
function carriesPhoto(request: Request, photos: Photo[]) {
  const body = request.postDataBuffer()
  if (!body) return false
  return photos.some(({ buffer }) => {
    const mid = Math.floor(buffer.length / 2)
    return body.includes(buffer.subarray(mid, mid + 64))
  })
}

const isPath = (url: string, path: string) => new URL(url).pathname === path
const loaded = (img: Locator) => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)
const naturalSize = (img: Locator) =>
  img.evaluate((el) => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight])
const box = async (el: Locator) => (await el.boundingBox())!

describe.skipIf(!CHROMIUM)('the Etsy listing photo tester in Chromium', () => {
  let app: ChildProcess | undefined
  let browser: Browser | undefined
  let base = ''

  beforeAll(async () => {
    const port = await freePort()
    base = `http://localhost:${port}`
    // Sample data only: no real database and no Stripe; and not vitest's NODE_ENV.
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
      fetch(`${base}${ETSY_PHOTO_TEST_PATH}`),
      fetch(`${base}/which-etsy-photo-is-best`),
      fetch(`${base}/sitemap.xml`),
      fetch(`${base}/images`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'x' }),
      fetch(`${base}/images/AAAAAAAAAAAAAAAA`),
      fetch(`${base}/polls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${base}/p/AAAAAAAAAAAA`),
    ])
    // A backstop to the routes below: no host but localhost resolves, so no test event reaches RepoHQ.
    browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
    try {
      if (app?.pid) process.kill(-app.pid, 'SIGTERM')
    } catch {}
  })

  /**
   * A browser context whose requests to other hosts never leave: the beacon is answered here and recorded,
   * anything else is refused. `counted` unsets navigator.webdriver, the one thing that keeps the beacon quiet.
   */
  async function newContext(options: BrowserContextOptions, { counted = false } = {}) {
    const context = await browser!.newContext(options)
    const beacons: Beacon[] = []
    await context.route(
      (url) => url.origin !== base,
      async (route) => {
        if (route.request().url() !== SIGNAL_URL) return route.abort()
        beacons.push(JSON.parse(route.request().postData() ?? 'null'))
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      },
    )
    if (counted) await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }))
    // Everything the pages ask for, from the start.
    const requests: Request[] = []
    context.on('request', (r) => requests.push(r))
    return { context, beacons, requests }
  }

  async function openTester(context: BrowserContext) {
    const page = await context.newPage()
    await page.goto(`${base}${ETSY_PHOTO_TEST_PATH}`)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await page.getByLabel('Add photos').waitFor({ state: 'attached' })
    return page
  }

  const noSidewaysScroll = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)

  /** The grid's photo tiles, once all three have drawn. */
  async function tilesOf(page: Page) {
    const grid = page.getByRole('region', { name: 'Mock Etsy search results' })
    const imgs = grid.locator('.etsy-tile img.etsy-img')
    await expect.poll(() => imgs.count()).toBe(3)
    for (let i = 0; i < 3; i++) await expect.poll(() => loaded(imgs.nth(i))).toBe(true)
    return { grid, imgs }
  }

  it('serves the page with 200, its own <title>, a meta description and an h1 naming the tool; sitemap.xml lists it', async () => {
    const res = await fetch(`${base}${ETSY_PHOTO_TEST_PATH}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    const titleOf = (page: string) => page.match(/<title>([^<]*)<\/title>/)?.[1]
    expect(titleOf(html)).toBe(TITLE)
    for (const other of ['/', '/which-etsy-photo-is-best']) {
      expect(titleOf(await (await fetch(`${base}${other}`)).text())).not.toBe(TITLE)
    }
    expect(html.match(/<meta name="description" content="([^"]*)"/)?.[1]).toMatch(/Etsy.{60,}/)
    expect(html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1]).toBe('Free Etsy listing photo tester')

    const xml = await (await fetch(`${base}/sitemap.xml`)).text()
    expect(xml).toMatch(new RegExp(`<loc>https?://[^<]+${ETSY_PHOTO_TEST_PATH}</loc>`))
  })

  it('shows 3 local photos as square tiles side by side in the mock Etsy search grid, and sends none of them', { timeout: 120_000 }, async () => {
    const { context, requests } = await newContext(SIZES[0][1])
    const photos = await samplePhotos(context)
    const page = await openTester(context)
    await page.getByLabel('Add photos').setInputFiles(photos)

    const { grid, imgs } = await tilesOf(page)
    const boxes = []
    for (let i = 0; i < 3; i++) {
      const img = imgs.nth(i)
      expect(await img.getAttribute('src')).toMatch(/^blob:/) // drawn from the file, on this device
      expect(await naturalSize(img)).toEqual([SAMPLES[i].width, SAMPLES[i].height])
      expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover')
      const b = await box(img)
      expect(Math.abs(b.width - b.height)).toBeLessThanOrEqual(1) // 1:1, whatever the photo's shape
      expect(b.width).toBeGreaterThan(150)
      boxes.push(b)
    }
    // One row, left to right, none overlapping: A, B, C as they were picked.
    for (let i = 1; i < 3; i++) {
      expect(Math.abs(boxes[i].y - boxes[0].y)).toBeLessThanOrEqual(1)
      expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width)
    }
    expect(await grid.locator('.etsy-tile .etsy-letter').allTextContents()).toEqual(LETTERS)
    await noSidewaysScroll(page)

    // Opening the poll form still sends nothing: the photos go up when the poll is posted.
    await page.getByRole('button', { name: 'Let strangers pick' }).click()
    await page.getByRole('region', { name: 'New poll' }).waitFor()
    await page.waitForTimeout(500)
    expect(requests.filter((r) => carriesPhoto(r, photos)).map((r) => r.url())).toEqual([])
    expect(requests.filter((r) => isPath(r.url(), '/images'))).toEqual([])

    // Posting it is asking for the poll: now, and only now, each photo is uploaded once.
    await page.getByRole('button', { name: 'Create poll' }).click()
    await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })
    const carriers = requests.filter((r) => carriesPhoto(r, photos))
    expect(carriers.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual(Array(3).fill('POST /images'))
    await context.close()
  })

  it.each(SIZES)('on %s, "Let strangers pick" opens the new-poll form with the photos as A–C, and the poll shows all three', { timeout: 180_000 }, async (size, options) => {
    const { context } = await newContext(options)
    const photos = await samplePhotos(context)
    const page = await openTester(context)
    if (size === 'phone') expect(page.viewportSize()?.width).toBe(390)
    const uploads: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && isPath(r.url(), '/images')) uploads.push(r.status())
    })

    expect(await page.getByRole('button', { name: 'Let strangers pick' }).isDisabled()).toBe(true)
    await page.getByLabel('Add photos').setInputFiles(photos)
    const { imgs } = await tilesOf(page)
    if (size === 'phone') {
      // Two to a row, as on a phone: A and B side by side, C under A.
      const [a, b, c] = [await box(imgs.nth(0)), await box(imgs.nth(1)), await box(imgs.nth(2))]
      expect(Math.abs(a.width - a.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1)
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
      expect(c.y).toBeGreaterThanOrEqual(a.y + a.height)
      expect(Math.abs(c.x - a.x)).toBeLessThanOrEqual(1)
    }
    await noSidewaysScroll(page)

    await page.getByRole('button', { name: 'Let strangers pick' }).click()
    const form = page.getByRole('region', { name: 'New poll' })
    await form.waitFor()
    expect(await form.getByLabel('Question').inputValue()).toBe(QUESTION)
    for (const [i, letter] of LETTERS.entries()) {
      const thumb = form.getByRole('group', { name: `Option ${letter}`, exact: true }).locator('img.thumb')
      await expect.poll(() => loaded(thumb)).toBe(true)
      expect(await naturalSize(thumb)).toEqual([SAMPLES[i].width, SAMPLES[i].height])
    }
    expect(await form.getByRole('group', { name: 'Option D', exact: true }).count()).toBe(0)
    expect(uploads).toEqual([])
    await noSidewaysScroll(page)

    await form.getByRole('button', { name: 'Create poll' }).click()
    await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })
    expect(uploads).toEqual([201, 201, 201])
    await expect.poll(() => page.locator('h1').textContent()).toBe(QUESTION)

    const faces = page.locator('.grid .face img')
    await expect.poll(() => faces.count(), { timeout: 30_000 }).toBe(3)
    const srcs = await faces.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))
    for (const src of srcs) expect(src).toMatch(new RegExp(`^${base}/images/[A-Za-z0-9_-]{16}$`))
    for (const [i] of SAMPLES.entries()) {
      await expect.poll(() => loaded(faces.nth(i)), { timeout: 30_000 }).toBe(true)
      expect(await naturalSize(faces.nth(i))).toEqual([SAMPLES[i].width, SAMPLES[i].height])
    }
    const types = await Promise.all(srcs.map(async (src) => (await context.request.get(src)).headers()['content-type']))
    expect(types).toEqual(SAMPLES.map((s) => s.type))
    expect(await page.locator('.grid .face b').allTextContents()).toEqual(LETTERS)
    await noSidewaysScroll(page)
    await context.close()
  })

  it('takes up to 4 photos, says which files it left out, and re-letters the tiles when one is removed', { timeout: 120_000 }, async () => {
    const { context } = await newContext(SIZES[0][1])
    const photos = await samplePhotos(context)
    const page = await openTester(context)
    // The tester's own notes (Next's route announcer is an alert too).
    const notes = page.locator('div.error[role="alert"]')

    await page.getByLabel('Add photos').setInputFiles([...photos, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') }])
    const { grid, imgs } = await tilesOf(page)
    expect(await notes.textContent()).toContain('notes.txt: only JPEG, PNG or WebP')

    // A fourth photo fits; the next two don't, and the picker goes once the grid is full.
    await page.getByLabel('Add photos').setInputFiles(photos)
    await expect.poll(() => imgs.count()).toBe(4)
    expect(await notes.locator('p').allTextContents()).toEqual([
      "mug-in-hand.png wasn't added: a poll takes up to 4 photos.",
      "mug-flat-lay.webp wasn't added: a poll takes up to 4 photos.",
    ])
    expect(await page.getByLabel('Add photos').count()).toBe(0)

    await page.getByRole('button', { name: 'Remove photo B' }).click()
    await expect.poll(() => imgs.count()).toBe(3)
    expect(await grid.locator('.etsy-tile .etsy-letter').allTextContents()).toEqual(LETTERS)
    const sizes = []
    for (let i = 0; i < 3; i++) sizes.push(await naturalSize(imgs.nth(i)))
    expect(sizes).toEqual([0, 2, 0].map((j) => [SAMPLES[j].width, SAMPLES[j].height]))
    expect(await notes.count()).toBe(0)
    expect(await page.getByLabel('Add photos').count()).toBe(1)
    await context.close()
  })

  it('loading the page sends the visit beacon with its path, apart from the search pages', { timeout: 120_000 }, async () => {
    const tester: Beacon = { slug: 'tiebreak', kind: 'visit', referrer: null, path: ETSY_PHOTO_TEST_PATH }

    // Landing on it: one visit, with its path.
    let { context, beacons } = await newContext(SIZES[0][1], { counted: true })
    let page = await openTester(context)
    await expect.poll(() => beacons).toEqual([tester])
    await page.reload()
    await page.getByLabel('Add photos').waitFor({ state: 'attached' })
    await page.waitForTimeout(1000)
    expect(beacons).toEqual([tester]) // once per session
    await context.close()

    // Landing on the Etsy search page from a search engine, then following its link to the tester.
    ;({ context, beacons } = await newContext(SIZES[1][1], { counted: true }))
    page = await context.newPage()
    await page.goto(`${base}/which-etsy-photo-is-best`, { referer: 'https://www.google.com/' })
    await expect.poll(() => beacons).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/' }])
    await page.locator(`article a[href="${ETSY_PHOTO_TEST_PATH}"]`).first().click()
    await page.waitForURL(`${base}${ETSY_PHOTO_TEST_PATH}`)
    await expect.poll(() => beacons.length).toBe(2)
    expect(beacons[1]).toEqual(tester)
    await context.close()
  })
})
