// npm run screenshots: starts the app, drives it with Playwright at desktop and
// phone size, saves PNGs to docs/screenshots/ and stops the app. Not part of
// `npm test`.
//
// What it shows (growth, 2026-11-07: the old Vercel deploy now redirects to the
// Workers site):
// - redirect.png: vercel.json's redirect answering real HEAD and POST requests, on
//   a local stand-in for Vercel's router (tests/redirect-to-workers.ts), plus the
//   config Vercel builds. The deployed redirect is checked by tests/live-site.test.ts.
// - workers-build.png: the app run with the env the Workers build sets (package.json
//   cf:build): each public page's canonical link, read from its HTML, and the visit
//   beacon's requests per page load at 1280 and 390 px. Signals are answered here;
//   nothing reaches RepoHQ.
// - The main job, at desktop and phone size: a seller posts a poll with a photo for
//   each option; two strangers vote; a third opens the link and casts the vote that
//   closes it, and sees the result and "Make your own tiebreak", which opens the
//   start page. The sample photos are drawn in the browser (two mugs).
//
// Needs CHROMIUM_PATH (a Chromium/Chrome binary; no browser is downloaded). The
// dev server is used because the production build requires DATABASE_URL, while
// dev runs on an in-process Postgres (PGlite) with sample data only. The app
// never sees a real database or Stripe setting from this shell: those variables
// are dropped.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright-core'
// TypeScript modules with no aliases; Node strips their types.
import { PUBLIC_PAGES, SIGNAL_URL } from '../lib/site.ts'
import { VERCEL_URL, canonicalOf, readVercelConfig, scriptEnv, vercelRedirect } from '../tests/redirect-to-workers.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = fileURLToPath(new URL('../docs/screenshots/', import.meta.url))
const port = Number(process.env.SCREENSHOT_PORT ?? 3187)
const base = `http://localhost:${port}`

const QUESTION = 'Which photo for my ceramic mug listing?'
const OPTION_A = 'Speckled blue glaze, morning light'
const OPTION_B = 'Matte white on a walnut shelf'
const TARGET = 3
const SIZES = ['desktop', 'mobile']
const DESKTOP = { viewport: { width: 1280, height: 800 } }
const PHONE = devices['iPhone 13']
const SHOTS = ['redirect.png', 'workers-build.png', ...['result', 'home'].flatMap((name) => SIZES.map((size) => `${name}-${size}.png`))]
const SIGNALS = `${new URL(SIGNAL_URL).origin}/**`

if (!process.env.CHROMIUM_PATH) {
  console.error('Set CHROMIUM_PATH to a Chromium or Chrome binary (no browser is downloaded).')
  process.exit(1)
}

// The build-time env the Workers deploy sets (its address, and production, so the beacon is armed).
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const workersEnv = scriptEnv(pkg.scripts['cf:build'])

// Sample data only: no real database, no real Stripe, no deploy env from this shell.
const appEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      name !== 'DATABASE_URL' &&
      !name.startsWith('STRIPE_') &&
      !name.endsWith('VERCEL_ENV') &&
      !(name in workersEnv),
  ),
)
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: {
    ...appEnv,
    ...workersEnv,
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

/**
 * A browser context whose RepoHQ signals are answered here (the app runs with the beacon armed, as on
 * Workers), each recorded in `signals` with the page that sent it. `counted` clears navigator.webdriver,
 * which otherwise keeps automated browsers from sending anything.
 */
async function newContext(browser, options, { counted = false, signals = [] } = {}) {
  const context = await browser.newContext(options)
  if (counted) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
  await context.route(SIGNALS, async (route) => {
    const request = route.request()
    let body = null
    try {
      body = JSON.parse(request.postData() ?? 'null')
    } catch {}
    signals.push({ url: request.url(), page: request.frame().url(), body })
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  return context
}

async function run(browser, label, contextOptions) {
  // 1. A seller posts a poll with a photo for each option (the main job).
  const seller = await newContext(browser, contextOptions)
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

  // 2. Two strangers vote on the shared link, one for each option: 2 of 3 votes.
  await strangerVotes(id, 0)
  await strangerVotes(id, 1)

  // 3. A third stranger opens the link (no cookie: a new anonymous account) and picks
  // A, which closes the poll at its target: the result, and a poll of their own.
  const stranger = await newContext(browser, contextOptions)
  const voter = await stranger.newPage()
  await voter.goto(`${base}/p/${id}`)
  await waitForImages(voter, '.swipe-card img')
  await voter.getByRole('button', { name: 'Pick A' }).click()
  await voter.getByText(/^Winner: A/).waitFor()
  const makeYourOwn = voter.getByRole('link', { name: 'Make your own tiebreak' })
  await makeYourOwn.waitFor()
  await waitForImages(voter, 'main img')
  await shot(voter, `result-${label}.png`)

  // 4. The link opens the start page, tagged ?ref=poll for the visit counter.
  await makeYourOwn.click()
  await voter.waitForURL(`${base}/?ref=poll`)
  await voter.getByLabel('Question').waitFor()
  await shot(voter, `home-${label}.png`)

  await stranger.close()
  await seller.close()
}

/** A plain HTML page of evidence, at desktop size. */
async function shotOfPage(browser, file, title, body) {
  const context = await browser.newContext(DESKTOP)
  const page = await context.newPage()
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body { font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px 32px; color: #1d1d1f; background: #f4f4f6 }
    h1 { font-size: 20px; margin: 0 0 6px } h2 { font-size: 15px; margin: 18px 0 6px }
    p { margin: 4px 0 } .note { color: #555 }
    table { border-collapse: collapse; background: #fff; width: 100% }
    th, td { text-align: left; padding: 4px 8px; border: 1px solid #ddd; vertical-align: top }
    th { background: #ececf0 } .ok { color: #137333; font-weight: bold }
    pre { background: #fff; border: 1px solid #ddd; padding: 8px 10px; margin: 0; white-space: pre-wrap }
  </style></head><body><h1>${esc(title)}</h1>${body}</body></html>`)
  await page.screenshot({ path: `${outDir}${file}` })
  await context.close()
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`

/**
 * vercel.json's redirect, answering real requests: a local HTTP server that applies the file's rules the
 * way Vercel's router does (tests/redirect-to-workers.ts). Not the live deploy, which isn't reachable from
 * a build; tests/live-site.test.ts checks that one.
 */
async function redirectEvidence() {
  const config = readVercelConfig()
  const server = createServer((req, res) => {
    const answer = vercelRedirect(config, req.url ?? '/')
    res.writeHead(answer?.status ?? 404, answer ? { location: answer.location } : {})
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const standIn = `http://127.0.0.1:${server.address().port}`
  const requests = [
    ['HEAD', '/'],
    ['HEAD', '/polls/abc123'],
    ['HEAD', '/polls/abc123?src=x'],
    ['HEAD', '/p/K6voqRLCfGQ0?ref=poll'],
    ['POST', '/polls/abc123/votes'],
  ]
  const answers = []
  try {
    for (const [method, path] of requests) {
      const res = await fetch(`${standIn}${path}`, { method, redirect: 'manual', ...(method === 'POST' ? { body: '{"option":0}' } : {}) })
      answers.push([method, path, res.status, res.headers.get('location')])
    }
  } finally {
    server.close()
  }
  return { config, answers }
}

/** Each public page's canonical link, from the HTML the app serves with the Workers build's env. */
async function canonicalEvidence() {
  const found = []
  for (const path of PUBLIC_PAGES) {
    const res = await fetch(`${base}${path}`)
    found.push([path, res.status, canonicalOf(await res.text())])
  }
  return found
}

/** The visit beacon on one page load, in a fresh browser session the beacon counts. */
async function beaconEvidence(browser, label, options) {
  const signals = []
  const context = await newContext(browser, options, { counted: true, signals })
  const page = await context.newPage()
  const width = page.viewportSize()?.width
  await page.goto(`${base}/`)
  await page.getByLabel('Question').waitFor()
  await page.waitForTimeout(3_000) // and no second visit
  await context.close()
  const visits = signals.filter((s) => s.url === SIGNAL_URL && s.body?.kind === 'visit')
  return [label, width, visits]
}

async function evidenceShots(browser, redirect, canonicals, beacons) {
  // Evidence that doesn't hold is a failed run, not a screenshot.
  const workersHost = new URL(workersEnv.NEXT_PUBLIC_SITE_URL).host
  for (const [, , status, loc] of redirect.answers) if (status !== 308 || !loc) throw new Error(`Redirect answered ${status} ${loc}`)
  for (const [path, , href] of canonicals) {
    if (!href || new URL(href).host !== workersHost) throw new Error(`${path}: canonical ${href} is not on ${workersHost}`)
  }
  for (const [label, , visits] of beacons) if (visits.length !== 1) throw new Error(`${label}: ${visits.length} visit beacons`)

  const location = (l) => (l ? esc(l) : '<em>none</em>')
  await shotOfPage(
    browser,
    'redirect.png',
    'tiebreak-phi.vercel.app now redirects everything to the Workers site',
    `<p class="note">vercel.json's rule answering real requests on a local stand-in for Vercel's router
      (tests/redirect-to-workers.ts), as ${esc(VERCEL_URL)} will once deployed. The live redirect is checked by
      tests/live-site.test.ts (LIVE_SITE=1).</p>
    <h2>Requests and answers</h2>
    <table><tr><th>Request</th><th>Status</th><th>Location</th></tr>
      ${redirect.answers.map(([method, path, status, loc]) => row([`${method} ${esc(VERCEL_URL)}${esc(path)}`, `<span class="ok">${status}</span>`, location(loc)])).join('')}
    </table>
    <p class="note">308 keeps the method and body, so the native app's POSTs to the old API address still arrive.</p>
    <h2>vercel.json: what Vercel builds (no install, no Next.js build, one static page it never serves)</h2>
    <pre>${esc(JSON.stringify(redirect.config, null, 2))}</pre>`,
  )
  await shotOfPage(
    browser,
    'workers-build.png',
    'The Workers build: canonical links on the Workers host, one visit beacon per page load',
    `<p class="note">The app run on localhost with the env package.json's cf:build sets:
      ${Object.entries(workersEnv).map(([k, v]) => `${esc(k)}=${esc(v)}`).join(' ')}</p>
    <h2>&lt;link rel="canonical"&gt; of every public page, read from its HTML</h2>
    <table><tr><th>Page</th><th>Status</th><th>Canonical</th></tr>
      ${canonicals.map(([path, status, href]) => row([esc(path), String(status), location(href)])).join('')}
    </table>
    <h2>Visit beacon: requests to ${esc(SIGNAL_URL)} per page load (fresh session; answered here, not sent)</h2>
    <table><tr><th>Browser</th><th>Width</th><th>Visit requests</th><th>Sent from page</th></tr>
      ${beacons.map(([label, width, visits]) => row([esc(label), `${width} px`, `<span class="ok">${visits.length}</span>`, esc(visits.map((v) => v.page).join(', '))])).join('')}
    </table>`,
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
    const redirect = await redirectEvidence()
    const canonicals = await canonicalEvidence()
    const beacons = [await beaconEvidence(browser, 'Desktop', DESKTOP), await beaconEvidence(browser, 'iPhone 13', PHONE)]
    await run(browser, 'desktop', DESKTOP)
    await run(browser, 'mobile', PHONE)
    await evidenceShots(browser, redirect, canonicals, beacons)
  } finally {
    await browser.close()
  }
  console.log(`Saved ${SHOTS.length} screenshots to docs/screenshots/`)
} finally {
  stopApp()
}
