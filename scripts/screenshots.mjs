// npm run screenshots: starts the app, drives the main job with Playwright at
// desktop and phone size, saves PNGs to docs/screenshots/ and stops the app. Not
// part of `npm test`. The flow (GROWTH.md, 2026-11-05): an indie author fills in
// the new-poll form on the start page with a photo of each cover and ticks
// "Publish the result when it closes"; strangers vote until the poll closes; the
// closed poll's public result page (/results/<slug>) is what a searcher lands on;
// and /sitemap.xml lists it. The sitemap is text, so it's taken once, at desktop
// size. The sample covers are drawn in the browser, so no real photo is used.
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

const QUESTION = 'Which cover for my cozy mystery paperback?'
const OPTION_A = 'Teal, teacup and serif title'
const OPTION_B = 'Plum, lamplit street and script title'
const TARGET = 5
// Five strangers: 3 for B, 2 for A.
const VOTES = [1, 0, 1, 1, 0]
const SIZES = ['desktop', 'mobile']
const SHOTS = [...['form', 'result'].flatMap((name) => SIZES.map((size) => `${name}-${size}.png`)), 'sitemap-desktop.png']

if (!process.env.CHROMIUM_PATH) {
  console.error('Set CHROMIUM_PATH to a Chromium or Chrome binary (no browser is downloaded).')
  process.exit(1)
}

// Sample data only: no real database, no real Stripe, no visit beacon (not production).
const appEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      name !== 'DATABASE_URL' && !name.startsWith('STRIPE_') && !name.endsWith('VERCEL_ENV') && name !== 'NEXT_PUBLIC_DEPLOY_ENV',
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
 * Two sample paperback covers, drawn on a canvas in the page and encoded as JPEG the
 * way a phone's photo would arrive: a teal cover with a teacup and a serif title, and
 * a plum cover with a lamplit street and a script title. The book is made up.
 */
async function sampleCovers(page) {
  const encoded = await page.evaluate(async () => {
    const width = 600
    const height = 900
    const draw = (scene) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      const sky = ctx.createLinearGradient(0, 0, 0, height)
      sky.addColorStop(0, scene.top)
      sky.addColorStop(1, scene.bottom)
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, width, height)
      scene.art(ctx)
      ctx.fillStyle = scene.ink
      ctx.textAlign = 'center'
      ctx.font = scene.titleFont
      ctx.fillText('The Teapot', width / 2, 150)
      ctx.fillText('Affair', width / 2, 235)
      ctx.font = '600 30px Georgia, serif'
      ctx.fillText('A COZY MYSTERY', width / 2, 820)
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    }
    const teacup = (ctx) => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.beginPath()
      ctx.ellipse(300, 650, 190, 34, 0, 0, Math.PI * 2) // saucer
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(170, 430)
      ctx.lineTo(430, 430)
      ctx.quadraticCurveTo(420, 630, 300, 630)
      ctx.quadraticCurveTo(180, 630, 170, 430)
      ctx.fill()
      ctx.lineWidth = 26
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.beginPath()
      ctx.ellipse(440, 500, 50, 60, 0, -Math.PI / 2, Math.PI / 2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.lineWidth = 8
      for (const x of [260, 300, 340]) {
        ctx.beginPath()
        ctx.moveTo(x, 400)
        ctx.bezierCurveTo(x - 25, 360, x + 25, 330, x, 290)
        ctx.stroke()
      }
    }
    const street = (ctx) => {
      ctx.fillStyle = 'rgba(20, 8, 30, 0.85)'
      for (const [x, w, h] of [[0, 130, 330], [120, 150, 420], [260, 120, 300], [370, 140, 390], [500, 100, 340]]) {
        ctx.fillRect(x, height - 150 - h, w, h)
      }
      ctx.fillStyle = 'rgba(255, 214, 120, 0.9)'
      for (let i = 0; i < 18; i++) ctx.fillRect(20 + ((i * 97) % 540), height - 420 + ((i * 53) % 220), 18, 26)
      ctx.strokeStyle = '#1a0a22'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(470, height - 150)
      ctx.lineTo(470, 470)
      ctx.stroke()
      const glow = ctx.createRadialGradient(470, 460, 5, 470, 460, 120)
      glow.addColorStop(0, 'rgba(255, 220, 140, 0.95)')
      glow.addColorStop(1, 'rgba(255, 220, 140, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(350, 340, 240, 240)
    }
    const toBase64 = async (blob) => {
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    const teal = await draw({ top: '#2f8f8a', bottom: '#14504d', ink: '#fdf6e3', titleFont: '700 76px Georgia, serif', art: teacup })
    const plum = await draw({ top: '#5b2a6e', bottom: '#24102e', ink: '#ffe3a3', titleFont: 'italic 600 80px "Brush Script MT", cursive', art: street })
    return { a: await toBase64(teal), b: await toBase64(plum) }
  })
  return { a: Buffer.from(encoded.a, 'base64'), b: Buffer.from(encoded.b, 'base64') }
}

const allLoaded = (images) => images.evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0))

async function waitForImages(page, selector) {
  const images = page.locator(selector)
  for (let i = 0; i < 100 && !(await allLoaded(images)); i++) await page.waitForTimeout(100)
}

// Viewport only, without the Next dev-mode badge: from the top of the page, or with an element at the bottom.
async function shot(page, file, { endAt } = {}) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  await page.evaluate(() => document.activeElement?.blur())
  if (endAt) await endAt.evaluate((el) => el.scrollIntoView({ block: 'end' }))
  else await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${outDir}${file}` })
}

async function run(browser, label, contextOptions) {
  // 1. The start page: the author fills in the new-poll form with both covers and ticks "Publish the result".
  const author = await browser.newContext(contextOptions)
  const page = await author.newPage()
  await page.goto(base)
  await page.getByLabel('Option A text').waitFor()
  await page.getByLabel('Question').fill(`${QUESTION}`)
  await page.getByLabel('Option A text').fill(OPTION_A)
  await page.getByLabel('Option B text').fill(OPTION_B)
  await page.getByLabel('Close at').fill(String(TARGET))
  const covers = await sampleCovers(page)
  await page.getByLabel('Option A photo').setInputFiles({ name: 'teal-cover.jpg', mimeType: 'image/jpeg', buffer: covers.a })
  await page.getByLabel('Option B photo').setInputFiles({ name: 'plum-cover.jpg', mimeType: 'image/jpeg', buffer: covers.b })
  await page.locator('img.thumb').nth(1).waitFor()
  const publish = page.getByLabel('Publish the result when it closes')
  await publish.check()
  await shot(page, `form-${label}.png`, { endAt: page.getByRole('button', { name: 'Create poll' }) })

  // 2. Posting it (the core action), then strangers vote until it closes at the target.
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('the result gets its own public page').waitFor()
  const id = new URL(page.url()).pathname.split('/').pop()
  for (const option of VOTES) await strangerVotes(id, option)

  // 3. The poll page now links its public result page; a searcher lands there (no cookie).
  await page.reload()
  const link = page.getByRole('link', { name: 'see its public page' })
  await link.waitFor()
  const path = await link.getAttribute('href')
  const searcher = await browser.newContext(contextOptions)
  const result = await searcher.newPage()
  const res = await result.goto(`${base}${path}`)
  if (res?.status() !== 200) throw new Error(`${path} answered ${res?.status()}`)
  await result.getByRole('link', { name: 'Make your own tiebreak' }).waitFor()
  await waitForImages(result, '.result-option img')
  await shot(result, `result-${label}.png`)

  // 4. The sitemap lists it, after the site's own pages: scrolled to its entry.
  if (label === 'desktop') {
    await result.goto(`${base}/sitemap.xml`)
    const entry = result.getByText(path).last() // Chrome's XML viewer keeps a hidden copy of the source too
    await entry.waitFor()
    await entry.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await result.screenshot({ path: `${outDir}sitemap-desktop.png` })
  }

  await searcher.close()
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
