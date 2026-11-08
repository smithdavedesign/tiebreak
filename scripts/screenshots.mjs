// npm run screenshots: starts the app, drives it with Playwright, saves PNGs to
// docs/screenshots/ and stops the app. Not part of `npm test`. Two parts:
// - The main job, at desktop and phone size: on the start page a seller fills in a
//   poll with a photo for each option (home-*.png) and posts it; three strangers
//   vote, the poll closes at its target, and its page shows the winner and the
//   split (result-*.png). The sample photos are drawn in the browser (two mugs), so
//   no real photo is used.
// - The move off Vercel (GROWTH.md 2026-11-08), on two plain evidence pages: old
//   links asked of a local stand-in for Vercel's router that applies vercel.json
//   (redirect.png), and old links followed in Chromium at 1280 and 390 px onto the
//   Workers address, which the local app plays, with the visit beacon each page
//   load sends (beacon.png). Nothing reaches Vercel, Cloudflare or RepoHQ.
//
// Needs CHROMIUM_PATH (a Chromium/Chrome binary; no browser is downloaded). The
// dev server is used because the production build requires DATABASE_URL, while
// dev runs on an in-process Postgres (PGlite) with sample data only. The app
// never sees a real database or Stripe setting from this shell: those variables
// are dropped. It's built as the Workers deploy is (its address, production), so
// the beacon's code runs; automated browsers send nothing, and the evidence
// browser's signals are answered here.
import { spawn } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright-core'
import { SIGNAL_URL } from '../lib/site.ts'
import { VERCEL_URL, WORKERS_URL, vercelAnswer, vercelConfig, visitWorkersFrom } from '../tests/workers-move.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = fileURLToPath(new URL('../docs/screenshots/', import.meta.url))
const port = Number(process.env.SCREENSHOT_PORT ?? 3187)
const base = `http://localhost:${port}`

const QUESTION = 'Which photo for my ceramic mug listing?'
const OPTION_A = 'Speckled blue glaze, morning light'
const OPTION_B = 'Matte white on a walnut shelf'
const TARGET = 3
const SIZES = ['desktop', 'mobile']
const SHOTS = [...['home', 'result'].flatMap((name) => SIZES.map((size) => `${name}-${size}.png`)), 'redirect.png', 'beacon.png']

if (!process.env.CHROMIUM_PATH) {
  console.error('Set CHROMIUM_PATH to a Chromium or Chrome binary (no browser is downloaded).')
  process.exit(1)
}

// Sample data only: no real database, no real Stripe; built like the Workers deploy (cf:build's env, its address).
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
    NEXT_PUBLIC_DEPLOY_ENV: 'production',
    NEXT_PUBLIC_SITE_URL: WORKERS_URL,
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

/** The main job at one size; returns the poll's id. */
async function run(browser, label, contextOptions) {
  // 1. The start page: a seller fills in a poll with a photo for each option.
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
  await shot(page, `home-${label}.png`)

  // 2. The core action: the poll is posted.
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()
  const id = new URL(page.url()).pathname.split('/').pop()

  // 3. Its result: three strangers vote through the poll's API, as its page does (each
  // without a cookie, so each is a new anonymous account), the poll closes at its
  // target of 3, and the seller's page shows the winner and the split.
  for (const option of [0, 1, 0]) await strangerVotes(id, option)
  await page.goto(`${base}/p/${id}`)
  await page.getByText(/^Winner: A/).waitFor()
  await waitForImages(page, 'main img')
  await shot(page, `result-${label}.png`)

  await seller.close()
  return id
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** A plain evidence page, drawn at desktop size. */
async function shotOfEvidence(browser, file, title, intro, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    body { font: 15px/1.45 system-ui, sans-serif; margin: 28px 36px; color: #1d1d1f }
    h1 { font-size: 22px; margin: 0 0 6px } p { margin: 0 0 14px; color: #444; max-width: 1180px }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; table-layout: fixed } th { text-align: left; font-weight: 600; background: #f2f2f4 }
    th, td { border: 1px solid #d8d8dc; padding: 5px 9px; vertical-align: top; overflow-wrap: anywhere } code, pre, td.mono { font: 13px/1.4 ui-monospace, Menlo, monospace }
    pre { background: #f7f7f9; border: 1px solid #d8d8dc; padding: 10px 12px; margin: 0 } .ok { color: #1a7f37; font-weight: 600 }
  </style></head><body><h1>${escapeHtml(title)}</h1><p>${intro}</p>${body}</body></html>`)
  await page.screenshot({ path: `${outDir}${file}` })
  await page.close()
}

/**
 * Old links asked of a local stand-in for Vercel's router: a real HTTP server that answers each request the way
 * vercel.json makes Vercel answer it (vercelAnswer, tests/workers-move.ts).
 */
async function redirectEvidence(browser, id) {
  const config = vercelConfig()
  const standIn = createServer((req, res) => {
    const to = vercelAnswer(config, `${VERCEL_URL}${req.url}`)
    res.writeHead(to ? to.status : 404, to ? { location: to.location } : {})
    res.end()
  }).listen(0, '127.0.0.1')
  await new Promise((resolve) => standIn.once('listening', resolve))
  const requests = [
    ['HEAD', '/', 'criterion 1'],
    ['HEAD', '/polls/abc123', 'criterion 1'],
    ['HEAD', '/polls/abc123?src=x', 'criterion 1'],
    ['GET', `/p/${id}?ref=poll`, 'a shared poll link, tagged'],
    ['POST', `/polls/${id}/votes`, 'the native app’s vote: a 308 keeps the POST'],
    ['GET', '//evil.example/x', 'stays on the Workers host'],
  ]
  const rows = []
  try {
    for (const [method, path, what] of requests) {
      const res = await fetch(`http://127.0.0.1:${standIn.address().port}${path}`, {
        method,
        redirect: 'manual',
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{"option":0}' } : {}),
      })
      rows.push(`<tr><td class="mono">${method} ${escapeHtml(VERCEL_URL + path)}</td><td class="mono ok">${res.status}</td>
        <td class="mono">${escapeHtml(res.headers.get('location'))}</td><td>${escapeHtml(what)}</td></tr>`)
    }
  } finally {
    standIn.close()
  }
  await shotOfEvidence(
    browser,
    'redirect.png',
    'Old links on tiebreak-phi.vercel.app, answered the way vercel.json makes Vercel answer them',
    'Real HTTP requests to a local stand-in for Vercel’s router, which applies vercel.json’s one rule as Vercel documents it ' +
      '(<code>tests/workers-move.ts</code>). Vercel itself can’t be reached from the build sandbox: once the merge is deployed, ' +
      '<code>LIVE_SITE=1 npx vitest run tests/live-site.test.ts</code> asks the real one.',
    `<table><tr><th style="width: 33%">Request</th><th style="width: 7%">Status</th><th style="width: 40%">Location</th><th>What it shows</th></tr>${rows.join('')}</table>
     <pre>${escapeHtml(JSON.stringify(config, null, 2))}</pre>`,
  )
}

/**
 * Old links followed in Chromium at 1280 and 390 px: vercel.json's rule answers each with a 308, and the browser
 * opens its Location on the Workers address, which the local app plays (visitWorkersFrom, tests/workers-move.ts;
 * Playwright routes only a redirect's first URL, so the hop is taken here). The page's visit beacon is answered here.
 */
async function beaconEvidence(browser, id) {
  const config = vercelConfig()
  const runs = [
    ['1280 px', { viewport: { width: 1280, height: 800 } }, `${VERCEL_URL}/`, undefined],
    ['390 px (iPhone 13)', { ...devices['iPhone 13'] }, `${VERCEL_URL}/p/${id}?ref=old-link`, 'https://www.reddit.com/'],
  ]
  const rows = []
  for (const [label, contextOptions, oldLink, referer] of runs) {
    const context = await browser.newContext(contextOptions)
    const signals = await visitWorkersFrom(context, base, SIGNAL_URL)
    const page = await context.newPage()
    const hop = vercelAnswer(config, oldLink)
    const res = await page.goto(hop.location, { referer })
    await page.locator('h1, h2').first().waitFor()
    for (let i = 0; i < 300 && signals.length === 0; i++) await page.waitForTimeout(100)
    await page.waitForTimeout(2000) // a second beacon for the same load would show by now
    if (signals.length !== 1) throw new Error(`${label}: ${signals.length} visit beacons for one page load`)
    const canonical = await page.locator('link[rel="canonical"]').evaluateAll((links) => links.map((l) => l.href))
    const robots = await page.locator('meta[name="robots"]').evaluateAll((metas) => metas.map((m) => m.content))
    rows.push(`<tr><td>${escapeHtml(label)}${referer ? `<br>from ${escapeHtml(referer)}` : ''}</td>
      <td class="mono">${escapeHtml(oldLink)}<br>→ ${hop.status} → ${res.status()} ${escapeHtml(page.url())}</td>
      <td class="mono"><span class="ok">${signals.length} request</span>, sent from ${escapeHtml(signals[0].pageUrl)}<br>${escapeHtml(JSON.stringify(signals[0].body))}</td>
      <td class="mono">${canonical.length ? escapeHtml(canonical.join(' ')) : `none (${escapeHtml(robots.join(' '))})`}</td></tr>`)
    await context.close()
  }
  await shotOfEvidence(
    browser,
    'beacon.png',
    'Old links followed in Chromium onto the Workers site, where the visit beacon counts them once',
    'vercel.json’s rule answers each old link with a 308 (as in redirect.png), and Chromium opens its Location on ' +
      `<code>${escapeHtml(WORKERS_URL)}</code>, played by the local app built as the Workers deploy is (its address, production). ` +
      'The beacon’s request to RepoHQ’s signal endpoint is answered here, so nothing left the machine; the real site and ' +
      'endpoint are checked by <code>LIVE_SITE=1</code> runs of <code>tests/live-site.test.ts</code>.',
    `<table><tr><th style="width: 15%">Viewport</th><th style="width: 30%">Old link → page opened</th><th style="width: 33%">Visit beacon for that page load</th><th>Canonical link</th></tr>${rows.join('')}</table>`,
  )
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
    const id = await run(browser, 'desktop', { viewport: { width: 1280, height: 800 } })
    await run(browser, 'mobile', { ...devices['iPhone 13'] })
    await redirectEvidence(browser, id)
    await beaconEvidence(browser, id)
  } finally {
    await browser.close()
  }
  console.log(`Saved ${SHOTS.length} screenshots to docs/screenshots/`)
} finally {
  stopApp()
}
