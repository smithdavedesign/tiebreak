// npm run screenshots: starts the app, drives the main job with Playwright at
// desktop and phone size, saves PNGs to docs/screenshots/ and stops the app. Not
// part of `npm test`. The flow (public result pages, GROWTH.md 2026-11-04): an
// author posts a poll with three book-cover photos and ticks "Publish the result
// when it closes"; five strangers vote on the link and it closes; its poll page
// links to the public result page; that page is titled with the question and shows
// the winner and the split; and /sitemap.xml lists it. The covers are drawn in the
// browser (made-up titles), so no real photo, book or person is used.
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

const QUESTION = 'Which cover for my cozy mystery novel?'
const OPTIONS = ['Lighthouse at dusk', 'Bakery window at night', 'Teacup and toast, bright']
const VOTES = [1, 1, 0, 1, 2] // five strangers: B wins 3 of 5
const SIZES = ['desktop', 'mobile']
const SHOTS = [...['form-publish', 'result-page'].flatMap((name) => SIZES.map((size) => `${name}-${size}.png`)), 'poll-closed-desktop.png', 'sitemap-desktop.png']

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
 * Three sample book covers, drawn on a canvas in the page and encoded as JPEG the way
 * a phone's photo would arrive: a lighthouse at dusk, a lit bakery window at night,
 * and a teacup with toast. The titles are made up.
 */
async function sampleCovers(page) {
  const encoded = await page.evaluate(async () => {
    const W = 600
    const H = 900
    const title = (ctx, lines, colour, y) => {
      ctx.fillStyle = colour
      ctx.textAlign = 'center'
      ctx.font = 'bold 64px Georgia, serif'
      lines.forEach((line, i) => ctx.fillText(line, W / 2, y + i * 74))
      ctx.font = 'italic 30px Georgia, serif'
      ctx.fillText('A cozy mystery', W / 2, y + lines.length * 74 + 10)
    }
    const covers = [
      (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, H)
        sky.addColorStop(0, '#1d2b53')
        sky.addColorStop(0.65, '#e9875a')
        sky.addColorStop(1, '#f6c58b')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#2b3a55'
        ctx.fillRect(0, 760, W, 140) // the sea
        ctx.fillStyle = '#f4f1ea'
        ctx.beginPath()
        ctx.moveTo(270, 760)
        ctx.lineTo(290, 470)
        ctx.lineTo(350, 470)
        ctx.lineTo(370, 760)
        ctx.fill()
        ctx.fillStyle = '#c0392b'
        ctx.fillRect(280, 430, 80, 40)
        ctx.fillStyle = 'rgba(255, 236, 160, 0.9)'
        ctx.beginPath()
        ctx.moveTo(320, 450)
        ctx.lineTo(600, 380)
        ctx.lineTo(600, 520)
        ctx.fill()
        title(ctx, ['THE', 'LIGHTHOUSE', 'RECIPE'], '#fdf6e3', 110)
      },
      (ctx) => {
        ctx.fillStyle = '#1b1b2f'
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#3a2f2f'
        ctx.fillRect(90, 430, 420, 400) // the shop front
        const glow = ctx.createRadialGradient(300, 600, 20, 300, 600, 220)
        glow.addColorStop(0, '#ffe08a')
        glow.addColorStop(1, '#d98b2b')
        ctx.fillStyle = glow
        ctx.fillRect(140, 470, 320, 250)
        ctx.strokeStyle = '#3a2f2f'
        ctx.lineWidth = 12
        ctx.beginPath()
        ctx.moveTo(300, 470)
        ctx.lineTo(300, 720)
        ctx.moveTo(140, 595)
        ctx.lineTo(460, 595)
        ctx.stroke()
        ctx.fillStyle = '#5a1e1e'
        ctx.beginPath()
        ctx.ellipse(230, 680, 60, 26, 0, 0, Math.PI * 2) // a loaf in the window
        ctx.fill()
        title(ctx, ['MURDER AT', 'THE', 'BAKEHOUSE'], '#ffe08a', 110)
      },
      (ctx) => {
        ctx.fillStyle = '#fbe7a1'
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#f2b5c4'
        for (let x = 0; x < W; x += 60) ctx.fillRect(x, 0, 30, H) // striped tablecloth
        ctx.fillStyle = '#fbe7a1'
        ctx.fillRect(40, 60, 520, 330)
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.ellipse(300, 690, 210, 50, 0, 0, Math.PI * 2) // saucer
        ctx.fill()
        ctx.fillStyle = '#5bb3a9'
        ctx.beginPath()
        ctx.moveTo(190, 520)
        ctx.lineTo(410, 520)
        ctx.quadraticCurveTo(400, 680, 300, 680)
        ctx.quadraticCurveTo(200, 680, 190, 520)
        ctx.fill()
        ctx.strokeStyle = '#5bb3a9'
        ctx.lineWidth = 18
        ctx.beginPath()
        ctx.ellipse(420, 580, 40, 50, 0, -Math.PI / 2, Math.PI / 2)
        ctx.stroke()
        ctx.fillStyle = '#d9a35b'
        ctx.fillRect(400, 760, 140, 100) // toast
        title(ctx, ['TEA, TOAST', 'AND', 'TROUBLE'], '#7a2e3a', 130)
      },
    ]
    const toBase64 = async (blob) => {
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    const out = []
    for (const draw of covers) {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      draw(canvas.getContext('2d'))
      out.push(await toBase64(await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))))
    }
    return out
  })
  return encoded.map((b64) => Buffer.from(b64, 'base64'))
}

const allLoaded = (images) => images.evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0))

async function waitForImages(page, selector) {
  const images = page.locator(selector)
  for (let i = 0; i < 100 && !(await allLoaded(images)); i++) await page.waitForTimeout(100)
}

// Viewport only, from the top of the page (or with an element in the middle), without the Next dev-mode badge.
async function shot(page, file, { center } = {}) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  await page.evaluate(() => document.activeElement?.blur())
  if (center) await center.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  else await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${outDir}${file}` })
}

/** The new-poll form filled in with the three covers and the publish box ticked. Returns the page. */
async function fillForm(context, covers) {
  const page = await context.newPage()
  await page.goto(base)
  await page.getByLabel('Option A text').waitFor()
  await page.getByRole('button', { name: '+ Add option' }).click()
  await page.getByLabel('Question').fill(QUESTION)
  for (const [i, letter] of ['A', 'B', 'C'].entries()) {
    await page.getByLabel(`Option ${letter} text`).fill(OPTIONS[i])
    await page.getByLabel(`Option ${letter} photo`).setInputFiles({ name: `cover-${letter.toLowerCase()}.jpg`, mimeType: 'image/jpeg', buffer: covers[i] })
  }
  await page.locator('img.thumb').nth(2).waitFor()
  await page.getByLabel('Close at').fill(String(VOTES.length))
  await page.getByLabel(/Publish the result when it closes/).check()
  return page
}

/** A request and its response, shown on a plain page (for what has no page of its own: the sitemap). */
async function shotOfRequest(context, path, slug, file) {
  const res = await fetch(`${base}${path}`)
  const xml = await res.text()
  if (res.status !== 200 || !xml.includes(`/results/${slug}</loc>`)) throw new Error(`${path} answered ${res.status} without the result page`)
  const entries = xml.match(/<url>.*?<\/url>/gs) ?? []
  const shown = entries.filter((e) => e.includes('/results/'))
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const page = await context.newPage()
  await page.setContent(`<!doctype html><meta charset="utf-8"><title>GET ${path}</title>
    <body style="font: 16px/1.5 system-ui, sans-serif; margin: 32px; color: #1d1d1f">
    <p style="margin:0 0 4px"><b>Request</b></p>
    <pre style="background:#f5f5f7;padding:12px 16px;border-radius:8px;margin:0 0 20px">GET ${escape(path)}</pre>
    <p style="margin:0 0 4px"><b>Response</b>: ${res.status}, ${escape(res.headers.get('content-type') ?? '')}, ${entries.length} &lt;url&gt; entries</p>
    <p style="margin:0 0 8px;color:#6e6e73">The first ${entries.length - shown.length} are tiebreak's public pages (/, /feed, the guides and tools). Then the published results:</p>
    <pre style="background:#f5f5f7;padding:12px 16px;border-radius:8px;white-space:pre-wrap">${escape(shown.join('\n'))}</pre>
    </body>`)
  await page.screenshot({ path: `${outDir}${file}` })
  await page.close()
}

async function run(browser) {
  // 1. Desktop: an author fills in the new-poll form with three covers and ticks the box (the core action).
  const author = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const probe = await author.newPage()
  await probe.goto(base)
  const covers = await sampleCovers(probe)
  await probe.close()
  const form = await fillForm(author, covers)
  await shot(form, 'form-publish-desktop.png', { center: form.getByLabel(/Publish the result when it closes/) })
  await form.getByRole('button', { name: 'Create poll' }).click()
  await form.waitForURL(/\/p\/[^/?]+/)
  await form.getByText('When it closes, its result gets a public page').waitFor()
  const id = new URL(form.url()).pathname.split('/').pop()

  // 2. Five strangers vote on the shared link; the poll closes at 5, and its page links to the published result.
  for (const option of VOTES) await strangerVotes(id, option)
  await form.goto(`${base}/p/${id}`)
  const published = form.getByRole('link', { name: QUESTION })
  await published.waitFor()
  await waitForImages(form, '.result img')
  await shot(form, 'poll-closed-desktop.png')
  const path = await published.getAttribute('href')
  const slug = path.replace('/results/', '')

  // 3. The public result page, titled with the question: the winner, then every option's split.
  for (const [size, options] of [
    ['desktop', { viewport: { width: 1280, height: 800 } }],
    ['mobile', { ...devices['iPhone 13'] }],
  ]) {
    const visitor = await browser.newContext(options)
    const page = await visitor.newPage()
    const res = await page.goto(`${base}${path}`)
    if (res?.status() !== 200 || (await page.title()) !== QUESTION) throw new Error(`${path} answered ${res?.status()}`)
    await waitForImages(page, '.result-page img')
    await shot(page, `result-page-${size}.png`)
    await visitor.close()
  }

  // 4. The sitemap lists it.
  await shotOfRequest(author, '/sitemap.xml', slug, 'sitemap-desktop.png')
  await author.close()

  // 5. Phone: the same form, with the box ticked.
  const phone = await browser.newContext({ ...devices['iPhone 13'] })
  const phoneForm = await fillForm(phone, covers)
  await shot(phoneForm, 'form-publish-mobile.png', { center: phoneForm.getByLabel(/Publish the result when it closes/) })
  await phone.close()
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
    await run(browser)
  } finally {
    await browser.close()
  }
  console.log(`Saved ${SHOTS.length} screenshots to docs/screenshots/`)
} finally {
  stopApp()
}
