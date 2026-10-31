// Share cards and the voter loop against the dev server, in Chromium at phone width
// (iPhone 13). The poll page's HTML carries og:image and twitter:image for the poll's
// own card, and that card is a 1200×630 PNG with the uploaded photo in it. Then a voter
// votes, follows "Make your own tiebreak" (a full page load, so the visit beacon runs
// on arrival) and the beacon records a visit with ref=poll.
//
// The beacon only sends on production, so the dev server gets NEXT_PUBLIC_VERCEL_ENV=
// production, and the browser reports itself as not automated. Nothing reaches RepoHQ:
// the page's fetch to the signal endpoint is answered inside the page and handed to the
// test, and any request to RepoHQ that got past that would be aborted.
//
// Needs CHROMIUM_PATH (no browser is downloaded), and is skipped without it. The app gets
// sample data only: the database and Stripe settings of this shell are dropped.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium, devices, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CARD, tileBoxes } from '@/lib/share-card'
import { SIGNAL_URL } from '@/lib/site'
import { orientationOnlyExif } from './image-bytes'
import { decodePng, inkIn, rgb, shareOf } from './png-pixels'

const CHROMIUM = process.env.CHROMIUM_PATH
const PHONE = devices['iPhone 13']
const root = fileURLToPath(new URL('..', import.meta.url))
const GREEN: [number, number, number] = [32, 160, 64]

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

/** A photo from the browser's own encoder: one colour, as JPEG or WebP bytes. */
async function encode(page: Page, type: 'image/jpeg' | 'image/webp', colour: [number, number, number]) {
  const base64 = await page.evaluate(
    async ({ type, colour }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = `rgb(${colour.join(',')})`
      ctx.fillRect(0, 0, 320, 240)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.95))
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    },
    { type, colour },
  )
  return Buffer.from(base64, 'base64')
}

/** A <meta> tag's content, by its property or name. */
function metaContent(html: string, key: string): string[] {
  const found: string[] = []
  for (const tag of html.match(/<meta [^>]*>/g) ?? []) {
    if (tag.includes(`property="${key}"`) || tag.includes(`name="${key}"`)) found.push(tag.match(/content="([^"]*)"/)?.[1] ?? '')
  }
  return found
}

describe.skipIf(!CHROMIUM)('share cards and "Make your own tiebreak" in Chromium', () => {
  let app: ChildProcess | undefined
  let browser: Browser | undefined
  let base = ''

  const post = async (path: string, body: BodyInit, type: string) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': type }, body })

  async function newPoll(options: unknown[], question: string) {
    const res = await post('/polls', JSON.stringify({ question, options, target: 3, durationHours: 24 }), 'application/json')
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  beforeAll(async () => {
    const port = await freePort()
    base = `http://localhost:${port}`
    // Sample data only: no real database or Stripe; and not vitest's NODE_ENV.
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
    env.NEXT_PUBLIC_VERCEL_ENV = 'production' // so the beacon runs; its requests never leave the browser (below)
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
      fetch(`${base}/p/AAAAAAAAAAAA`),
      fetch(`${base}/p/AAAAAAAAAAAA/card`),
      post('/polls', '{}', 'application/json'),
      post('/polls/AAAAAAAAAAAA/votes', '{}', 'application/json'),
      post('/images', new Uint8Array([0]), 'image/png'),
    ])
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
    try {
      if (app?.pid) process.kill(-app.pid, 'SIGTERM')
    } catch {}
  })

  it("a poll page's HTML points og:image and twitter:image at its own card, a 1200×630 PNG with the photo in it", { timeout: 180_000 }, async () => {
    const page = await browser!.newPage()
    const jpeg = await encode(page, 'image/jpeg', GREEN)
    const webp = await encode(page, 'image/webp', [140, 90, 40])
    await page.close()
    const uploaded = await Promise.all([post('/images', jpeg, 'image/jpeg'), post('/images', webp, 'image/webp')])
    const [jpegUrl, webpUrl] = await Promise.all(uploaded.map(async (r) => ((await r.json()) as { url: string }).url))
    const id = await newPoll(
      [{ text: 'Speckled blue', imageUrl: jpegUrl }, 'Matte white', { text: 'Walnut shelf', imageUrl: webpUrl }],
      'Which photo should lead my mug listing?',
    )

    const html = await (await fetch(`${base}/p/${id}`)).text()
    const [ogImage, ...moreOg] = metaContent(html, 'og:image')
    expect(moreOg).toEqual([]) // only the poll's card, not the site's
    expect(new URL(ogImage).pathname).toBe(`/p/${id}/card`)
    expect(new URL(ogImage).search).toBe('?v=open')
    expect(metaContent(html, 'og:image:width')).toEqual(['1200'])
    expect(metaContent(html, 'og:image:height')).toEqual(['630'])
    expect(metaContent(html, 'og:image:alt')[0]).toContain('Which photo should lead my mug listing?')
    expect(metaContent(html, 'twitter:card')).toEqual(['summary_large_image'])
    expect(metaContent(html, 'twitter:image')).toEqual([ogImage])

    // The tags carry the public site's address; this server answers the same path.
    const { pathname, search } = new URL(ogImage)
    const card = await fetch(`${base}${pathname}${search}`)
    expect(card.status).toBe(200)
    expect(card.headers.get('content-type')).toBe('image/png')
    const pixels = decodePng(new Uint8Array(await card.arrayBuffer()))
    expect([pixels.width, pixels.height]).toEqual([1200, 630])
    const inset = CARD.tileBorder + CARD.tilePad
    const inside = tileBoxes(3).map((t) => ({ x: t.x + inset, y: t.y + inset, width: t.width - 2 * inset, height: t.height - 2 * inset }))
    expect(shareOf(pixels, inside[0], GREEN, 16)).toBeGreaterThan(0.25) // the uploaded JPEG
    expect(inkIn(pixels, inside[1], rgb(CARD.colors.tile)).length).toBeGreaterThan(200) // text
    expect(inkIn(pixels, inside[2], rgb(CARD.colors.tile)).length).toBeGreaterThan(200) // the WebP's text, not a blank
  })

  it('turns a sideways phone photo (EXIF orientation 6) upright on the card, as the browser shows it', { timeout: 180_000 }, async () => {
    // Stored as a phone stores a portrait shot: landscape pixels (green on top, red below)
    // and "turn 90° clockwise" in EXIF. Upright, green is on the right and red on the left.
    const page = await browser!.newPage()
    const base64 = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'rgb(32,160,64)'
      ctx.fillRect(0, 0, 320, 120)
      ctx.fillStyle = 'rgb(200,30,40)'
      ctx.fillRect(0, 120, 320, 120)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95))
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    })
    await page.close()
    const stored = Buffer.from(base64, 'base64')
    const sideways = Buffer.concat([stored.subarray(0, 2), orientationOnlyExif(6), stored.subarray(2)])
    const { url } = (await (await post('/images', sideways, 'image/jpeg')).json()) as { url: string }
    const id = await newPoll([{ text: 'Portrait shot', imageUrl: url }, 'Plain'], 'Which way up?')

    const pixels = decodePng(new Uint8Array(await (await fetch(`${base}/p/${id}/card`)).arrayBuffer()))
    const tile = tileBoxes(2)[0]
    const inset = CARD.tileBorder + CARD.tilePad
    const label = 44 // the option's letter row above the photo, and the gap under it
    const photo = { x: tile.x + inset, y: tile.y + inset + label, width: tile.width - 2 * inset, height: tile.height - 2 * inset - label }
    const half = { ...photo, width: photo.width / 2 }
    expect(shareOf(pixels, half, [200, 30, 40], 24)).toBeGreaterThan(0.8)
    expect(shareOf(pixels, { ...half, x: half.x + half.width }, [32, 160, 64], 24)).toBeGreaterThan(0.8)
  })

  it('a voter follows "Make your own tiebreak" to /?ref=poll, and the visit beacon records ref=poll', { timeout: 180_000 }, async () => {
    const id = await newPoll(['Hot dog is a sandwich', 'Hot dog is not a sandwich'], 'Is a hot dog a sandwich?')
    const context = await browser!.newContext({ ...PHONE })
    const signals: unknown[] = []
    await context.exposeFunction('__tiebreakSignal', (body: string) => {
      signals.push(JSON.parse(body))
    })
    await context.route('https://repohq.vercel.app/**', (route) => route.abort())
    await context.addInitScript((signalUrl: string) => {
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

    const page = await context.newPage()
    await page.goto(`${base}/p/${id}`)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await expect.poll(() => signals, { timeout: 30_000 }).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null }])
    const link = page.getByRole('link', { name: 'Make your own tiebreak' })
    expect(await link.count()).toBe(0)

    await page.getByRole('button', { name: 'Pick A' }).click()
    await link.waitFor({ timeout: 30_000 })
    expect(await link.getAttribute('href')).toBe('/?ref=poll')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await link.click()
    await page.waitForURL(`${base}/?ref=poll`, { timeout: 60_000 })
    await page.getByLabel('Question').waitFor({ timeout: 30_000 })
    await expect
      .poll(() => signals, { timeout: 30_000 })
      .toEqual([
        { slug: 'tiebreak', kind: 'visit', referrer: null },
        { slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'poll' },
      ])
    await context.close()
  })
})
