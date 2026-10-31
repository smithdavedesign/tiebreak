// npm run screenshots: starts the app, drives the Etsy listing photo tester with
// Playwright at desktop and phone size (add three candidate main photos to the
// mock Etsy search grid, press "Let strangers pick", post the poll it opens, see
// all three photos on the poll page), saves PNGs to docs/screenshots/ and stops
// the app. Not part of `npm test`. The sample photos are drawn in the browser
// (three mugs, one landscape, one portrait, one square), so no real photo is used.
//
// Needs CHROMIUM_PATH (a Chromium/Chrome binary; no browser is downloaded). The
// dev server is used because the production build requires DATABASE_URL, while
// dev runs on an in-process Postgres (PGlite) with sample data only. The app
// never sees a real database or Stripe setting from this shell: those variables
// are dropped.
import { spawn } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = fileURLToPath(new URL('../docs/screenshots/', import.meta.url))
const port = Number(process.env.SCREENSHOT_PORT ?? 3187)
const base = `http://localhost:${port}`

const TESTER_PATH = '/tools/etsy-listing-photo-test'
const LISTING_TITLE = 'Speckled ceramic coffee mug, 12 oz, handmade stoneware'
const PRICE = '$28.00'
const OPTIONS = ['Blue glaze, morning light', 'White mug on walnut', 'Terracotta, flat lay']
const TARGET = 15
const SHOTS = ['etsy-grid', 'etsy-poll-form', 'etsy-poll']
const SIZES = ['desktop', 'mobile']

if (!process.env.CHROMIUM_PATH) {
  console.error('Set CHROMIUM_PATH to a Chromium or Chrome binary (no browser is downloaded).')
  process.exit(1)
}

// Sample data only: no real database, no real Stripe, no visit beacon (not production).
const appEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => name !== 'DATABASE_URL' && !name.startsWith('STRIPE_') && !name.endsWith('VERCEL_ENV'),
  ),
)
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: {
    ...appEnv,
    NEXT_TELEMETRY_DISABLED: '1',
    HOUSE_POLLS: 'off',
  },
})
const stopApp = () => {
  try {
    process.kill(-app.pid, 'SIGTERM')
  } catch {}
}
process.on('exit', stopApp)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1))

async function waitForApp() {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error('The dev server exited before it answered.')
    try {
      if ((await fetch(base)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('The dev server did not answer on ' + base)
}

/**
 * Three sample product photos, drawn on a canvas in the page and encoded as JPEG
 * the way a phone's photo would arrive: a speckled blue mug in morning light
 * (landscape), a matte white mug on a walnut shelf (portrait) and a terracotta
 * mug from above (square). The shapes differ so the grid's square crop shows.
 */
async function samplePhotos(page) {
  const encoded = await page.evaluate(async () => {
    const draw = (scene) => {
      const { width, height } = scene
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      const wall = ctx.createLinearGradient(0, 0, width, height)
      wall.addColorStop(0, scene.wall[0])
      wall.addColorStop(1, scene.wall[1])
      ctx.fillStyle = wall
      ctx.fillRect(0, 0, width, height)
      // The scene is drawn on a 900 × 900 stage, centred in the photo.
      const ox = (width - 900) / 2
      const oy = (height - 900) / 2
      // The surface the mug stands on, across the whole photo.
      ctx.fillStyle = scene.surface
      ctx.fillRect(0, oy + 640, width, height - oy - 640)
      if (scene.grain) {
        ctx.strokeStyle = 'rgba(30, 15, 5, 0.35)'
        ctx.lineWidth = 3
        for (let y = oy + 660; y < height; y += 26) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.bezierCurveTo(width / 3, y - 12, (2 * width) / 3, y + 14, width, y - 4)
          ctx.stroke()
        }
      }
      ctx.translate(ox, oy)
      // Shadow, handle, body and rim.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
      ctx.beginPath()
      ctx.ellipse(470, 668, 250, 34, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 46
      ctx.strokeStyle = scene.mug[1]
      ctx.beginPath()
      ctx.ellipse(630, 450, 95, 120, 0, -Math.PI / 2, Math.PI / 2)
      ctx.stroke()
      const body = ctx.createLinearGradient(250, 0, 640, 0)
      body.addColorStop(0, scene.mug[1])
      body.addColorStop(0.45, scene.mug[0])
      body.addColorStop(1, scene.mug[1])
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.moveTo(250, 290)
      ctx.lineTo(250, 610)
      ctx.quadraticCurveTo(250, 665, 310, 665)
      ctx.lineTo(580, 665)
      ctx.quadraticCurveTo(640, 665, 640, 610)
      ctx.lineTo(640, 290)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = scene.rim
      ctx.beginPath()
      ctx.ellipse(445, 290, 195, 38, 0, 0, Math.PI * 2)
      ctx.fill()
      if (scene.speckles) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
        for (let i = 0; i < 260; i++) {
          const x = 262 + ((i * 97) % 366)
          const y = 330 + ((i * 53) % 320)
          ctx.beginPath()
          ctx.arc(x, y, 2 + (i % 4), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    }
    const toBase64 = async (blob) => {
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    const blue = await draw({
      width: 1200,
      height: 900,
      wall: ['#fff3dc', '#f4d9b0'],
      surface: '#efe6da',
      mug: ['#4f86d9', '#1f4f9e'],
      rim: '#183f80',
      speckles: true,
    })
    const white = await draw({
      width: 900,
      height: 1200,
      wall: ['#e7e3dc', '#cfc8bd'],
      surface: '#6b4325',
      grain: true,
      mug: ['#fbfaf7', '#d9d5cd'],
      rim: '#c9c4ba',
    })
    const terracotta = await draw({
      width: 1000,
      height: 1000,
      wall: ['#f6efe6', '#e9dccb'],
      surface: '#d9cbb8',
      mug: ['#d0764a', '#9c4a26'],
      rim: '#8a3f1f',
    })
    return [await toBase64(blue), await toBase64(white), await toBase64(terracotta)]
  })
  const names = ['speckled-blue-mug.jpg', 'white-mug-walnut.jpg', 'terracotta-mug.jpg']
  return encoded.map((b64, i) => ({ name: names[i], mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') }))
}

const allLoaded = (images) => images.evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0))

async function run(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  // Viewport only, from the top of the page (or from an element), without the Next dev-mode badge.
  const shot = async (name, { from } = {}) => {
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await page.evaluate(() => document.activeElement?.blur())
    if (from) await from.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    else await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${outDir}${name}-${label}.png` })
  }
  const waitForImages = async (selector) => {
    const images = page.locator(selector)
    for (let i = 0; i < 100 && !(await allLoaded(images)); i++) await page.waitForTimeout(100)
  }

  // 1. The tester with three candidate main photos added: square tiles in the
  // mock Etsy search grid, drawn on this device before anything is uploaded.
  await page.goto(`${base}${TESTER_PATH}`)
  await page.getByLabel('Add photos').waitFor({ state: 'attached' })
  await page.getByLabel('Listing title').fill(LISTING_TITLE)
  await page.getByLabel('Price').fill(PRICE)
  await page.getByLabel('Add photos').setInputFiles(await samplePhotos(page))
  await page.locator('.etsy-tile img.etsy-img').nth(2).waitFor()
  await waitForImages('.etsy-tile img.etsy-img')
  // On a phone the grid sits below the intro, so the shot starts at the grid.
  await shot('etsy-grid', label === 'mobile' ? { from: page.locator('.etsy-mock') } : {})

  // 2. "Let strangers pick" (the core action): the new-poll form opens with the
  // three photos as options A–C.
  await page.getByRole('button', { name: 'Let strangers pick' }).click()
  const form = page.getByRole('region', { name: 'New poll' })
  await form.waitFor()
  for (const [i, text] of OPTIONS.entries()) await form.getByLabel(`Option ${'ABC'[i]} text`).fill(text)
  await form.getByLabel('Close at').fill(String(TARGET))
  await waitForImages('.tester-poll img.thumb')
  await shot('etsy-poll-form', { from: form })

  // 3. Post it: the photos upload, and the poll page shows all three, served by
  // tiebreak, for strangers to pick from.
  await form.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()
  await waitForImages('.grid .face img')
  await shot('etsy-poll')

  await context.close()
}

/** This script owns docs/screenshots/: PNGs from older runs that it no longer takes go. */
async function removeStaleShots() {
  const current = new Set(SHOTS.flatMap((name) => SIZES.map((size) => `${name}-${size}.png`)))
  for (const file of await readdir(outDir)) {
    if (file.endsWith('.png') && !current.has(file)) await rm(`${outDir}${file}`)
  }
}

try {
  await mkdir(outDir, { recursive: true })
  await removeStaleShots()
  await waitForApp()
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  try {
    await run(browser, 'desktop', { viewport: { width: 1280, height: 800 } })
    await run(browser, 'mobile', { ...devices['iPhone 13'] })
  } finally {
    await browser.close()
  }
  console.log(`Saved ${SHOTS.length * SIZES.length} screenshots to docs/screenshots/`)
} finally {
  stopApp()
}
