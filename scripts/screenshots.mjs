// npm run screenshots: starts the app, drives the main job with Playwright at
// desktop and phone size, saves PNGs to docs/screenshots/ and stops the app. Not
// part of `npm test`. The flow (vote from your newsletter, GROWTH.md 2026-11-03): an
// author posts a poll with three cover designs for one novel and gets the "Get votes
// from your newsletter" panel, copies the email block, and a reader who taps cover B
// in that email lands on the poll with B preselected, taps Confirm vote, and has
// voted. The covers are drawn in the browser, and the book is made up, so no real
// photo or person is used.
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

const QUESTION = 'Which cover for The Salt House?'
const COVERS = [
  { text: 'Sea glass', file: 'sea-glass.jpg' },
  { text: 'Night tide', file: 'night-tide.jpg' },
  { text: 'Paper cut', file: 'paper-cut.jpg' },
]
const TARGET = 50
const SIZES = ['desktop', 'mobile']
const SHOTS = ['newsletter', 'confirm', 'voted'].flatMap((name) => SIZES.map((size) => `${name}-${size}.png`))

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
 * Three cover designs for one made-up novel, drawn on a canvas in the page and
 * encoded as JPEG the way a phone's photo would arrive: sea glass (blue-green
 * waves), night tide (a moon over dark water) and paper cut (a red sun on cream).
 */
async function sampleCovers(page) {
  const encoded = await page.evaluate(async () => {
    const W = 600
    const H = 900
    const draw = (paint, ink) => {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      paint(ctx)
      ctx.fillStyle = ink
      ctx.textAlign = 'center'
      ctx.font = 'bold 70px Georgia, "DejaVu Serif", serif'
      ctx.fillText('THE SALT', W / 2, 150)
      ctx.fillText('HOUSE', W / 2, 230)
      ctx.font = 'italic 34px Georgia, "DejaVu Serif", serif'
      ctx.fillText('a novel', W / 2, 290)
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    }
    const toBase64 = async (blob) => {
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    const seaGlass = await draw((ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#e6f4f1')
      sky.addColorStop(1, '#7fc4bd')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, H)
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = `rgba(20, 110, 120, ${0.12 + i * 0.07})`
        ctx.beginPath()
        ctx.moveTo(0, 520 + i * 55)
        for (let x = 0; x <= W; x += 50) ctx.quadraticCurveTo(x + 25, 500 + i * 55, x + 50, 520 + i * 55)
        ctx.lineTo(W, H)
        ctx.lineTo(0, H)
        ctx.fill()
      }
      // The house on the dune.
      ctx.fillStyle = '#f7efe2'
      ctx.fillRect(220, 400, 160, 110)
      ctx.fillStyle = '#b5543c'
      ctx.beginPath()
      ctx.moveTo(205, 405)
      ctx.lineTo(300, 340)
      ctx.lineTo(395, 405)
      ctx.fill()
    }, '#134e52')
    const nightTide = await draw((ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#0b1633')
      sky.addColorStop(1, '#1f3b6e')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#f4ecc8'
      ctx.beginPath()
      ctx.arc(420, 430, 70, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(244, 236, 200, 0.35)'
      for (let i = 0; i < 9; i++) ctx.fillRect(380 - i * 6, 600 + i * 30, 80 + i * 12, 6)
      ctx.fillStyle = '#081026'
      ctx.fillRect(0, 590, W, 6)
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
        ctx.fillRect((i * 137) % W, 320 + ((i * 59) % 240), 2, 2)
      }
    }, '#f4ecc8')
    const paperCut = await draw((ctx) => {
      ctx.fillStyle = '#f3ead8'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#d2412f'
      ctx.beginPath()
      ctx.arc(W / 2, 520, 120, 0, Math.PI * 2)
      ctx.fill()
      const layers = ['#2f4858', '#33658a', '#86bbd8']
      layers.forEach((colour, i) => {
        ctx.fillStyle = colour
        ctx.beginPath()
        ctx.moveTo(0, 600 + i * 70)
        ctx.lineTo(150, 540 + i * 70)
        ctx.lineTo(320, 620 + i * 70)
        ctx.lineTo(470, 560 + i * 70)
        ctx.lineTo(W, 610 + i * 70)
        ctx.lineTo(W, H)
        ctx.lineTo(0, H)
        ctx.fill()
      })
    }, '#2f4858')
    return [await toBase64(seaGlass), await toBase64(nightTide), await toBase64(paperCut)]
  })
  return encoded.map((b64) => Buffer.from(b64, 'base64'))
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

async function waitForImages(images) {
  for (let i = 0; i < 100 && !(await allLoaded(images)); i++) await new Promise((resolve) => setTimeout(resolve, 100))
}

async function run(browser, label, contextOptions) {
  // 1. An author posts a poll with a photo of each cover design, from the start page.
  const author = await browser.newContext(contextOptions)
  await author.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
  const page = await author.newPage()
  await page.goto(base)
  await page.getByLabel('Option A text').waitFor()
  await page.getByLabel('Question').fill(QUESTION)
  await page.getByRole('button', { name: '+ Add option' }).click()
  const covers = await sampleCovers(page)
  for (const [i, cover] of COVERS.entries()) {
    const letter = 'ABC'[i]
    await page.getByLabel(`Option ${letter} text`).fill(cover.text)
    await page.getByLabel(`Option ${letter} photo`).setInputFiles({ name: cover.file, mimeType: 'image/jpeg', buffer: covers[i] })
  }
  await page.getByLabel('Close at').fill(String(TARGET))
  await page.locator('img.thumb').nth(2).waitFor()
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()

  // 2. Their poll page offers the newsletter block; they copy the email version.
  const panel = page.locator('section.newsletter')
  await panel.getByRole('heading', { name: 'Get votes from your newsletter' }).waitFor()
  await waitForImages(page.frameLocator('iframe.newsletter-preview').locator('img'))
  await page.waitForTimeout(300) // the preview frame takes its height once its pictures are in
  await page.getByRole('button', { name: 'Copy email HTML' }).click()
  await page.getByRole('button', { name: 'Copied' }).waitFor()
  await shot(page, `newsletter-${label}.png`, { from: panel })

  // 3. A reader taps cover B in the email: the link opens the poll with B picked, nothing counted yet.
  const emailHtml = await page.getByLabel('Email HTML').inputValue()
  const links = [...emailHtml.matchAll(/<a href="([^"]+)"/g)].map((m) => m.at(1).replaceAll('&amp;', '&'))
  if (links.length !== COVERS.length) throw new Error(`The email block has ${links.length} links, not ${COVERS.length}`)
  const reader = await browser.newContext(contextOptions)
  const readerPage = await reader.newPage()
  await readerPage.goto(links[1])
  await readerPage.getByRole('button', { name: 'Confirm vote' }).waitFor()
  await waitForImages(readerPage.locator('.confirm-pick img'))
  await shot(readerPage, `confirm-${label}.png`)

  // 4. They tap Confirm vote: one vote, and the page says what they picked.
  await readerPage.getByRole('button', { name: 'Confirm vote' }).click()
  await readerPage.getByText('You picked').waitFor()
  await shot(readerPage, `voted-${label}.png`)

  await reader.close()
  await author.close()
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
