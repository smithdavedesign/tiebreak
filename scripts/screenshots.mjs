// npm run screenshots: starts the app, drives the main job with Playwright at
// desktop and phone size, saves PNGs to docs/screenshots/ and stops the app. Not
// part of `npm test`. The flow: a seller posts a poll with a photo for each option;
// its link unfurls as the poll's share card; a stranger opens the link, votes and is
// offered "Make your own tiebreak", which opens the start page; two more votes close
// the poll, and its card shows the winner and the split. The cards are images
// (1200×630), so they're taken once, at desktop size. The sample photos are drawn in
// the browser (two mugs), so no real photo is used.
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

const QUESTION = 'Which photo for my ceramic mug listing?'
const OPTION_A = 'Speckled blue glaze, morning light'
const OPTION_B = 'Matte white on a walnut shelf'
const TARGET = 3
const SIZES = ['desktop', 'mobile']
const SHOTS = ['card-open.png', 'card-result.png', ...['voted', 'home'].flatMap((name) => SIZES.map((size) => `${name}-${size}.png`))]

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
 * Two sample product photos, drawn on a canvas in the page and encoded as JPEG the
 * way a phone's photo would arrive: a speckled blue mug in morning light, and a
 * matte white mug on a walnut shelf.
 */
async function samplePhotos(page) {
  const encoded = await page.evaluate(async () => {
    const draw = (scene) => {
      const size = 900
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      const wall = ctx.createLinearGradient(0, 0, size, size)
      wall.addColorStop(0, scene.wall[0])
      wall.addColorStop(1, scene.wall[1])
      ctx.fillStyle = wall
      ctx.fillRect(0, 0, size, size)
      // The surface the mug stands on.
      ctx.fillStyle = scene.surface
      ctx.fillRect(0, 640, size, 260)
      if (scene.grain) {
        ctx.strokeStyle = 'rgba(30, 15, 5, 0.35)'
        ctx.lineWidth = 3
        for (let y = 660; y < size; y += 26) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.bezierCurveTo(300, y - 12, 600, y + 14, size, y - 4)
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
    })
    const white = await draw({
      wall: ['#e7e3dc', '#cfc8bd'],
      surface: '#6b4325',
      grain: true,
      mug: ['#fbfaf7', '#d9d5cd'],
      rim: '#c9c4ba',
    })
    return { a: await toBase64(blue), b: await toBase64(white) }
  })
  return { a: Buffer.from(encoded.a, 'base64'), b: Buffer.from(encoded.b, 'base64') }
}

const allLoaded = (images) => images.evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0))

// Viewport only, from the top of the page (or from an element), without the Next dev-mode badge.
async function shot(page, file, { from } = {}) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  await page.evaluate(() => document.activeElement?.blur())
  if (from) await from.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  else await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${outDir}${file}` })
}

async function waitForImages(page, selector) {
  const images = page.locator(selector)
  for (let i = 0; i < 100 && !(await allLoaded(images)); i++) await page.waitForTimeout(100)
}

/** A poll's share card, opened as an image (what a chat app or social site shows for the link). */
async function shotOfCard(page, path, file) {
  const res = await page.goto(`${base}${path}`)
  if (res?.status() !== 200 || res.headers()['content-type'] !== 'image/png') {
    throw new Error(`The card at ${path} answered ${res?.status()} ${res?.headers()['content-type']}`)
  }
  await page.screenshot({ path: `${outDir}${file}` })
}

async function run(browser, label, contextOptions) {
  const desktop = label === 'desktop'

  // 1. A seller posts a poll with a photo for each option (the main job).
  const seller = await browser.newContext(contextOptions)
  const page = await seller.newPage()
  await page.goto(base)
  await page.getByLabel('Option A text').waitFor()
  await page.getByLabel('Question').fill(QUESTION)
  await page.getByLabel('Option A text').fill(OPTION_A)
  await page.getByLabel('Option B text').fill(OPTION_B)
  await page.getByLabel('Close at').fill(String(TARGET))
  const photos = await samplePhotos(page)
  await page.getByLabel('Option A photo').setInputFiles({ name: 'speckled-blue-mug.jpg', mimeType: 'image/jpeg', buffer: photos.a })
  await page.getByLabel('Option B photo').setInputFiles({ name: 'white-mug-walnut.jpg', mimeType: 'image/jpeg', buffer: photos.b })
  await page.locator('img.thumb').nth(1).waitFor()
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()
  const id = new URL(page.url()).pathname.split('/').pop()

  // 2. What its link unfurls as: the poll's own card, the question and both photos.
  if (desktop) await shotOfCard(page, `/p/${id}/card?v=open`, 'card-open.png')

  // 3. A stranger opens the shared link (no cookie: a new anonymous account), picks
  // one, and is offered a poll of their own.
  const stranger = await browser.newContext(contextOptions)
  const voter = await stranger.newPage()
  await voter.goto(`${base}/p/${id}`)
  await waitForImages(voter, '.swipe-card img')
  await voter.getByRole('button', { name: 'Pick A' }).click()
  const makeYourOwn = voter.getByRole('link', { name: 'Make your own tiebreak' })
  await makeYourOwn.waitFor()
  await shot(voter, `voted-${label}.png`)

  // 4. The link opens the start page, tagged ?ref=poll for the visit counter.
  await makeYourOwn.click()
  await voter.waitForURL(`${base}/?ref=poll`)
  await voter.getByLabel('Question').waitFor()
  await shot(voter, `home-${label}.png`)

  // 5. Two more strangers vote; the poll closes at 3, and its card shows the winner and the split.
  if (desktop) {
    await strangerVotes(id, 0)
    await strangerVotes(id, 1)
    await shotOfCard(page, `/p/${id}/card?v=closed`, 'card-result.png')
  }

  await stranger.close()
  await seller.close()
}

/** This script owns docs/screenshots/: PNGs from older runs that it no longer takes go. */
async function removeStaleShots() {
  const current = new Set(SHOTS)
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
  console.log(`Saved ${SHOTS.length} screenshots to docs/screenshots/`)
} finally {
  stopApp()
}
