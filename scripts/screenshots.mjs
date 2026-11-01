// npm run screenshots: starts the app, drives the main job with Playwright at
// desktop and phone size, saves PNGs to docs/screenshots/ and stops the app. Not
// part of `npm test`. The flow (vote from your newsletter, GROWTH.md 2026-11-01): an
// author posts a poll with three cover photos from the start page; their poll page
// shows "Get votes from your newsletter" with a preview of the email block, and they
// copy it; a reader taps option B's link from that block, lands with B preselected and
// one "Confirm vote" button (opening the link records nothing), confirms, and the vote
// counts. The sample covers are drawn in the browser, so no real photo is used.
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

const QUESTION = 'Which cover should my novel get?'
const COVERS = [
  { text: 'Sunset orange', file: 'cover-sunset.jpg' },
  { text: 'Deep teal', file: 'cover-teal.jpg' },
  { text: 'Black and gold', file: 'cover-gold.jpg' },
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
    ([name]) => name !== 'DATABASE_URL' && !name.startsWith('STRIPE_') && !name.endsWith('VERCEL_ENV') && name !== 'NEXT_PUBLIC_DEPLOY_ENV',
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
 * Three sample book covers for a made-up novel, drawn on a canvas in the page and
 * encoded as JPEG the way a phone's photo would arrive: a sunset, a teal sea and a
 * black-and-gold frame.
 */
async function sampleCovers(page) {
  const encoded = await page.evaluate(async () => {
    const W = 600
    const H = 900
    const draw = (scene) => {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      scene.sky.forEach((colour, i) => sky.addColorStop(i / (scene.sky.length - 1), colour))
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, H)
      scene.art(ctx)
      ctx.textAlign = 'center'
      ctx.fillStyle = scene.ink
      ctx.font = 'bold 74px Georgia, serif'
      ;['HARBOR', 'OF SMALL', 'LIGHTS'].forEach((line, i) => ctx.fillText(line, W / 2, 170 + i * 84))
      ctx.font = 'italic 34px Georgia, serif'
      ctx.fillText('a novel', W / 2, 430)
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    }
    const toBase64 = async (blob) => {
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    const sunset = await draw({
      sky: ['#ffb36b', '#ff6f4f', '#8c2f5a'],
      ink: '#2b1020',
      art: (ctx) => {
        ctx.fillStyle = '#ffe2a6'
        ctx.beginPath()
        ctx.arc(W / 2, 640, 130, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#5a1f3d'
        ctx.fillRect(0, 700, W, 200)
      },
    })
    const teal = await draw({
      sky: ['#bfe7e3', '#2f8f8f', '#0d3b45'],
      ink: '#ffffff',
      art: (ctx) => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
        ctx.lineWidth = 6
        for (let y = 560; y < H; y += 48) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          for (let x = 0; x <= W; x += 60) ctx.quadraticCurveTo(x + 30, y - 22, x + 60, y)
          ctx.stroke()
        }
      },
    })
    const gold = await draw({
      sky: ['#1d1d1f', '#000000'],
      ink: '#d9b45a',
      art: (ctx) => {
        ctx.strokeStyle = '#d9b45a'
        ctx.lineWidth = 8
        ctx.strokeRect(36, 36, W - 72, H - 72)
        ctx.lineWidth = 3
        ctx.strokeRect(56, 56, W - 112, H - 112)
        ctx.fillStyle = '#d9b45a'
        ctx.beginPath()
        ctx.moveTo(W / 2, 560)
        ctx.lineTo(W / 2 + 70, 690)
        ctx.lineTo(W / 2, 820)
        ctx.lineTo(W / 2 - 70, 690)
        ctx.closePath()
        ctx.fill()
      },
    })
    return Promise.all([sunset, teal, gold].map(toBase64))
  })
  return encoded.map((base64) => Buffer.from(base64, 'base64'))
}

const allLoaded = (images) => images.evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0))

async function waitForImages(scope, selector) {
  const images = scope.locator(selector)
  for (let i = 0; i < 100 && !(await allLoaded(images)); i++) await new Promise((resolve) => setTimeout(resolve, 100))
}

/** Waits until React has hydrated the poll page (the share link becomes absolute in an effect). */
async function hydrated(page) {
  const share = page.getByLabel('Share link')
  for (let i = 0; i < 300 && !(await share.inputValue()).startsWith(base); i++) await page.waitForTimeout(100)
}

// Viewport only, from the top of the page (or from an element), without the Next dev-mode badge.
async function shot(page, file, { from } = {}) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  await page.evaluate(() => document.activeElement?.blur())
  if (from) await from.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  else await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${outDir}${file}` })
}

async function run(browser, label, contextOptions) {
  // 1. An author posts a three-cover poll from the start page, with a photo for each option.
  const author = await browser.newContext({ ...contextOptions, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await author.newPage()
  await page.goto(base)
  await page.getByLabel('Option A text').waitFor()
  await page.getByRole('button', { name: '+ Add option' }).click()
  await page.getByLabel('Option C text').waitFor()
  await page.getByLabel('Question').fill(QUESTION)
  const covers = await sampleCovers(page)
  for (const [i, cover] of COVERS.entries()) {
    const letter = 'ABC'[i]
    await page.getByLabel(`Option ${letter} text`).fill(cover.text)
    await page.getByLabel(`Option ${letter} photo`).setInputFiles({ name: cover.file, mimeType: 'image/jpeg', buffer: covers[i] })
  }
  await page.getByLabel('Close at').fill(String(TARGET))
  await page.getByLabel('or after').selectOption('72')
  await page.locator('img.thumb').nth(2).waitFor()
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()
  await hydrated(page)

  // 2. Their poll page offers the newsletter blocks, with a preview of the email one; they copy it.
  const panel = page.getByRole('heading', { name: 'Get votes from your newsletter' })
  await panel.waitFor()
  const preview = page.frameLocator('iframe.newsletter-preview')
  await waitForImages(preview, 'img')
  await waitForImages(page, '.face img')
  await page.getByRole('button', { name: 'Copy HTML block' }).click()
  await page.getByRole('button', { name: 'Copied' }).waitFor()
  const html = await page.evaluate(() => navigator.clipboard.readText())
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href]) => href.replace(/&amp;/g, '&'))
  if (links.length !== COVERS.length) throw new Error(`The copied block has ${links.length} links, not ${COVERS.length}`)
  await page.waitForTimeout(300) // the preview frame has grown to its block's height
  await shot(page, `newsletter-${label}.png`, { from: page.locator('.newsletter') })

  // 3. A reader taps option B in the email: the page opens with B preselected, and no vote yet.
  const reader = await browser.newContext(contextOptions)
  const tab = await reader.newPage()
  await tab.goto(links[1])
  await hydrated(tab)
  await waitForImages(tab, '.face img')
  const confirm = tab.getByRole('button', { name: 'Confirm vote' })
  await confirm.waitFor()
  const before = (await (await fetch(`${base}/polls/${new URL(tab.url()).pathname.split('/').pop()}`)).json()).poll.voteCount
  if (before !== 0) throw new Error(`Opening the link recorded ${before} votes`)
  await shot(tab, `confirm-${label}.png`)

  // 4. They confirm: one vote, theirs.
  await confirm.click()
  await tab.getByText('You picked').waitFor()
  await shot(tab, `voted-${label}.png`)

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
