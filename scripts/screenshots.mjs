// npm run screenshots: starts the app, drives the main job with Playwright at
// desktop and phone size (the Etsy thumbnail preview with three listing photos
// side by side, "Let strangers pick" opening the new-poll form with them as
// options A–C, posting it, collecting votes, reading the result), saves PNGs to
// docs/screenshots/ and stops the app. Not part of `npm test`. The sample photos
// are drawn in the browser (three mugs), so no real photo is used.
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

const TOOL = '/tools/etsy-thumbnail-preview'
const OPTIONS = ['Speckled blue glaze', 'Matte white on walnut', 'Sage green on linen']
const TARGET = 3
const SHOTS = ['tool', 'form', 'result']
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

/** A stranger's vote: no cookie, so the app mints them a fresh anonymous account. */
async function strangerVotes(id, option) {
  const res = await fetch(`${base}/polls/${id}/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ option }),
  })
  if (res.status !== 201) throw new Error(`Stranger vote failed: ${res.status}`)
}

/**
 * Three sample product photos, drawn on a canvas in the page and encoded as JPEG the
 * way a phone's photo would arrive: a speckled blue mug in morning light, a matte
 * white mug on a walnut shelf and a sage green mug on linen. They're wider than tall
 * (5:4) with the mug off centre, so the tool's three crops differ.
 */
async function samplePhotos(page) {
  const encoded = await page.evaluate(async () => {
    const draw = (scene) => {
      const width = 1200
      const height = 960
      const size = 900 // the scene's own square, scaled to the photo's height
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      const wall = ctx.createLinearGradient(0, 0, width, height)
      wall.addColorStop(0, scene.wall[0])
      wall.addColorStop(1, scene.wall[1])
      ctx.fillStyle = wall
      ctx.fillRect(0, 0, width, height)
      ctx.scale(height / size, height / size)
      ctx.translate(scene.offset, 0)
      // The surface the mug stands on.
      ctx.fillStyle = scene.surface
      ctx.fillRect(-scene.offset, 640, width, 260)
      if (scene.grain) {
        ctx.strokeStyle = 'rgba(30, 15, 5, 0.35)'
        ctx.lineWidth = 3
        for (let y = 660; y < size; y += 26) {
          ctx.beginPath()
          ctx.moveTo(-scene.offset, y)
          ctx.bezierCurveTo(300, y - 12, 600, y + 14, width, y - 4)
          ctx.stroke()
        }
      }
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
      wall: ['#fff3dc', '#f4d9b0'],
      surface: '#efe6da',
      mug: ['#4f86d9', '#1f4f9e'],
      rim: '#183f80',
      speckles: true,
      offset: 40,
    })
    const white = await draw({
      wall: ['#e7e3dc', '#cfc8bd'],
      surface: '#6b4325',
      grain: true,
      mug: ['#fbfaf7', '#d9d5cd'],
      rim: '#c9c4ba',
      offset: 330,
    })
    const green = await draw({
      wall: ['#f3efe6', '#e2dccd'],
      surface: '#d8cfbf',
      mug: ['#9cc2a6', '#557a62'],
      rim: '#4a6b55',
      offset: 180,
    })
    return [await toBase64(blue), await toBase64(white), await toBase64(green)]
  })
  const names = ['speckled-blue-mug.jpg', 'white-mug-walnut.jpg', 'sage-mug-linen.jpg']
  return encoded.map((base64, i) => ({ name: names[i], mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') }))
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

  // 1. The Etsy thumbnail preview with three listing photos added: each one in the
  // search-grid mock at 1:1, 4:3 and 5:4, drawn in the browser (nothing uploaded).
  await page.goto(`${base}${TOOL}`)
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]')
    return !!input && Object.keys(input).some((key) => key.startsWith('__reactProps'))
  })
  await page.getByLabel('Add images').setInputFiles(await samplePhotos(page))
  await page.locator('.preview-tile img').nth(8).waitFor()
  await waitForImages('.preview-tile img')
  // The shot starts at the list of images, so the grids below it fit.
  await shot('tool', { from: page.locator('.tool-pick') })

  // 2. Let strangers pick: the photos upload and the new-poll form opens with them
  // as options A–C (the core action is posting it).
  await page.getByRole('button', { name: 'Let strangers pick' }).click()
  await page.waitForURL(`${base}/`)
  await page.getByRole('group', { name: 'Option C' }).locator('img.thumb').waitFor()
  await waitForImages('img.thumb')
  for (const [i, text] of OPTIONS.entries()) await page.getByLabel(`Option ${'ABC'[i]} text`).fill(text)
  await page.getByLabel('Close at').fill(String(TARGET))
  await shot('form', { from: page.locator('form') })

  // 3. Post it; two strangers vote and the creator taps the last vote, which closes
  // the poll and shows its winner with the split.
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()
  const id = new URL(page.url()).pathname.split('/').pop()
  await strangerVotes(id, 0)
  await strangerVotes(id, 2)
  await page.goto(`${base}/p/${id}`)
  await page.getByText(`2 of ${TARGET} votes`).waitFor()
  await page.getByRole('button', { name: new RegExp(OPTIONS[0]) }).click()
  await page.getByText(/^Winner:/).waitFor()
  await page.getByText(`Closed with ${TARGET} votes`).waitFor()
  await waitForImages('.result img')
  await shot('result')

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
