// npm run screenshots: starts the app, drives the free Etsy thumbnail preview with
// Playwright at desktop and phone size (add three listing photos, see them in the
// search grid at each crop, "Let strangers pick", the new-poll form opened with them
// as options A–C, post it, strangers vote, the result), saves PNGs to
// docs/screenshots/ and stops the app. Not part of `npm test`. The sample photos are
// drawn in the browser (three mugs), so no real photo is used.
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
const TARGET = 3
const SHOTS = ['etsy-preview', 'prefilled-form', 'result']
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
 * Three sample listing photos, drawn on a canvas in the page and encoded as JPEG the
 * way a phone's photo would arrive, landscape (4:3) so each crop trims something: a
 * speckled blue mug in morning light, a matte white mug on a walnut shelf, and a sage
 * green mug on linen.
 */
async function samplePhotos(page) {
  const encoded = await page.evaluate(async () => {
    const draw = (scene) => {
      const width = 1200
      const height = 900
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      const wall = ctx.createLinearGradient(0, 0, width, height)
      wall.addColorStop(0, scene.wall[0])
      wall.addColorStop(1, scene.wall[1])
      ctx.fillStyle = wall
      ctx.fillRect(0, 0, width, height)
      // The surface the mug stands on.
      ctx.fillStyle = scene.surface
      ctx.fillRect(0, 640, width, 260)
      if (scene.grain) {
        ctx.strokeStyle = scene.grain
        ctx.lineWidth = 3
        for (let y = 660; y < height; y += 26) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.bezierCurveTo(400, y - 12, 800, y + 14, width, y - 4)
          ctx.stroke()
        }
      }
      // The mug, drawn in a 900-wide frame, moved to the scene's spot.
      ctx.translate(scene.x, 0)
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
    const scenes = [
      { x: 150, wall: ['#fff3dc', '#f4d9b0'], surface: '#efe6da', mug: ['#4f86d9', '#1f4f9e'], rim: '#183f80', speckles: true },
      {
        x: 330,
        wall: ['#e7e3dc', '#cfc8bd'],
        surface: '#6b4325',
        grain: 'rgba(30, 15, 5, 0.35)',
        mug: ['#fbfaf7', '#d9d5cd'],
        rim: '#c9c4ba',
      },
      { x: 20, wall: ['#f3f1ea', '#dfe3d6'], surface: '#d8d2c4', grain: 'rgba(255, 255, 255, 0.4)', mug: ['#9dbf9a', '#5f8a5c'], rim: '#4f7a4c' },
    ]
    return Promise.all(scenes.map(async (scene) => toBase64(await draw(scene))))
  })
  const names = ['speckled-blue-mug.jpg', 'white-mug-walnut.jpg', 'sage-mug-linen.jpg']
  return encoded.map((b64, i) => ({ name: names[i], mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') }))
}

const allLoaded = (images) => images.evaluateAll((els) => els.length > 0 && els.every((el) => el.complete && el.naturalWidth > 0))

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

  // 1. The free Etsy thumbnail preview with three listing photos added: each shows
  // in a mock search grid at every crop, drawn from the device (nothing uploaded).
  await page.goto(base + TOOL)
  await page.getByLabel('Add images').waitFor({ state: 'attached' })
  await page.getByLabel('Add images').setInputFiles(await samplePhotos(page))
  await page.locator('[data-tile="etsy"]').nth(8).waitFor()
  await waitForImages('[data-tile="etsy"] img')
  // On a phone the grids sit below the intro and the picked list, so the shot starts at them.
  await shot('etsy-preview', label === 'mobile' ? { from: page.locator('.previews') } : {})

  // 2. "Let strangers pick": the photos upload and the new-poll form opens with
  // them as options A–C and the tool's question.
  await page.getByRole('button', { name: 'Let strangers pick' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await page.locator('img.thumb').nth(2).waitFor()
  await waitForImages('img.thumb')
  await page.getByLabel('Close at').fill(String(TARGET))
  await shot('prefilled-form', { from: page.locator('form') })

  // 3. Post it; strangers vote on the shared link, the poll closes at its target and
  // shows the winning photo with the split.
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  const id = new URL(page.url()).pathname.split('/').pop()
  await strangerVotes(id, 1)
  await strangerVotes(id, 0)
  await strangerVotes(id, 1)
  await page.goto(`${base}/p/${id}`)
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
