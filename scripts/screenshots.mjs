// npm run screenshots: starts the app, drives the main job with Playwright at
// desktop and phone size, saves PNGs to docs/screenshots/ and stops the app. Not
// part of `npm test`. The flow (vote from your newsletter): an author posts a poll
// with three cover photos on the start page; the poll page offers them "Get votes
// from your newsletter", with a preview of the email block and its two copy buttons;
// a reader clicks option B in that block, as pasted into an email, and lands on the
// poll with B picked and one "Confirm vote" button (no vote yet); confirming votes.
// The sample covers are drawn in the browser, so no real photo is used.
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

const QUESTION = 'Which cover for The Salt Road?'
const COVERS = [
  { label: 'Teal waves', scene: 'waves' },
  { label: 'Red sun', scene: 'sun' },
  { label: 'Night ink', scene: 'stars' },
]
const TARGET = 20
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
 * Three sample book covers for a made-up novel, drawn on a canvas in the page and
 * encoded as JPEG the way a phone's photo would arrive: teal waves, a red sun, and
 * stars on dark ink.
 */
async function sampleCovers(page) {
  const encoded = await page.evaluate(async (scenes) => {
    const draw = (scene) => {
      const [w, h] = [600, 900]
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const palette = {
        waves: { bg: ['#0f5d66', '#1b8a8f'], ink: '#f4efe6', accent: '#9fd8cf' },
        sun: { bg: ['#f3d9b1', '#e9b37a'], ink: '#4a1712', accent: '#b8322a' },
        stars: { bg: ['#14142b', '#2b2d5c'], ink: '#f1e9d2', accent: '#e8c46a' },
      }[scene]
      const sky = ctx.createLinearGradient(0, 0, 0, h)
      sky.addColorStop(0, palette.bg[0])
      sky.addColorStop(1, palette.bg[1])
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = palette.accent
      ctx.fillStyle = palette.accent
      if (scene === 'waves') {
        ctx.lineWidth = 10
        for (let y = 520; y < h; y += 46) {
          ctx.beginPath()
          for (let x = 0; x <= w; x += 10) ctx.lineTo(x, y + Math.sin((x + y) / 45) * 16)
          ctx.stroke()
        }
      } else if (scene === 'sun') {
        ctx.beginPath()
        ctx.arc(w / 2, 560, 170, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = palette.ink
        ctx.fillRect(0, 700, w, 200)
      } else {
        for (let i = 0; i < 90; i++) {
          ctx.beginPath()
          ctx.arc((i * 137) % w, 380 + ((i * 89) % 500), 2 + (i % 3), 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(430, 470, 60, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = palette.ink
      ctx.textAlign = 'center'
      ctx.font = 'bold 76px Georgia, serif'
      ctx.fillText('THE SALT', w / 2, 170)
      ctx.fillText('ROAD', w / 2, 255)
      ctx.font = 'italic 34px Georgia, serif'
      ctx.fillText('a novel', w / 2, 320)
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    }
    const toBase64 = async (blob) => {
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    const out = []
    for (const scene of scenes) out.push(await toBase64(await draw(scene)))
    return out
  }, COVERS.map((c) => c.scene))
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

async function waitForImages(page, selector) {
  const images = page.locator(selector)
  for (let i = 0; i < 100 && !(await allLoaded(images)); i++) await page.waitForTimeout(100)
}

/** The email block as a reader's inbox shows it: pasted under a line of the author's own. */
function inbox(block) {
  return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<body style="margin:0;background:#f2f2f2;font-family:Georgia,serif;color:#1d1d1f">
<div style="max-width:640px;margin:0 auto;background:#fff;padding:20px">
<p style="font-size:17px;line-height:1.5">I'm down to three covers for The Salt Road. Which one would you pick up?</p>
${block}
</div></body>`
}

async function run(browser, label, contextOptions) {
  // 1. An author posts a poll with three cover photos on the start page (the main job).
  const author = await browser.newContext(contextOptions)
  const page = await author.newPage()
  await page.goto(base)
  await page.getByLabel('Option A text').waitFor()
  await page.getByRole('button', { name: '+ Add option' }).click()
  await page.getByLabel('Question').fill(QUESTION)
  const covers = await sampleCovers(page)
  for (const [i, cover] of COVERS.entries()) {
    const letter = 'ABC'[i]
    await page.getByLabel(`Option ${letter} text`).fill(cover.label)
    await page.getByLabel(`Option ${letter} photo`).setInputFiles({ name: `cover-${cover.scene}.jpg`, mimeType: 'image/jpeg', buffer: covers[i] })
  }
  await page.getByLabel('Close at').fill(String(TARGET))
  await page.locator('img.thumb').nth(2).waitFor()
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()
  const id = new URL(page.url()).pathname.split('/').pop()

  // 2. Their poll page offers "Get votes from your newsletter": the email block's preview and two copy buttons.
  const panel = page.getByRole('region', { name: 'Get votes from your newsletter' })
  await panel.waitFor()
  const preview = page.frameLocator('iframe.newsletter-preview')
  await preview.locator('img').nth(2).waitFor()
  await waitForImages(page, '.newsletter-preview')
  await page.waitForTimeout(300) // the frame takes its content's height on load
  await shot(page, `newsletter-${label}.png`, { from: panel })
  const block = await page.getByLabel('Email block (HTML)').inputValue()

  // 3. A reader taps option B in the email; the link opens the poll with B picked, and nothing is voted yet.
  const readerContext = await browser.newContext(contextOptions)
  const reader = await readerContext.newPage()
  await reader.setContent(inbox(block))
  await reader.getByRole('link', { name: /Vote B/ }).click()
  await reader.waitForURL(`${base}/p/${id}?pick=B&src=newsletter`)
  const confirm = reader.getByRole('button', { name: 'Confirm vote' })
  await confirm.waitFor()
  await waitForImages(reader, '.confirm-pick img')
  const before = await (await fetch(`${base}/polls/${id}`)).json()
  if (before.poll.voteCount !== 0) throw new Error(`Opening the link voted: ${before.poll.voteCount} votes`)
  await shot(reader, `confirm-${label}.png`, label === 'mobile' ? { from: reader.locator('.confirm-pick') } : {})

  // 4. Confirming records the vote.
  await confirm.click()
  await reader.getByText('You picked').waitFor()
  await shot(reader, `voted-${label}.png`)

  await readerContext.close()
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
