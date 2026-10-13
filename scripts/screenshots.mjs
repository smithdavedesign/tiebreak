// npm run screenshots: starts the app, drives the main job (post a poll, collect
// votes, read the result) with Playwright at desktop and phone size, saves PNGs
// to docs/screenshots/, and stops the app. Not part of `npm test`.
//
// Needs CHROMIUM_PATH (a Chromium/Chrome binary; no browser is downloaded). The
// dev server is used because the production build requires DATABASE_URL, while
// dev runs on an in-process Postgres (PGlite) with sample data only.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
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

if (!process.env.CHROMIUM_PATH) {
  console.error('Set CHROMIUM_PATH to a Chromium or Chrome binary (no browser is downloaded).')
  process.exit(1)
}

const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', HOUSE_POLLS: 'off' },
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

async function run(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  // Viewport only, from the top of the page, without the Next dev-mode badge.
  const shot = async (name) => {
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await page.evaluate(() => {
      document.activeElement?.blur()
      window.scrollTo(0, 0)
    })
    await page.screenshot({ path: `${outDir}${name}-${label}.png` })
  }

  // 1. The start page with a poll filled in.
  await page.goto(base)
  await page.getByLabel('Option A text').waitFor()
  await page.getByLabel('Question').fill(QUESTION)
  await page.getByLabel('Option A text').fill(OPTION_A)
  await page.getByLabel('Option B text').fill(OPTION_B)
  await page.getByLabel('Close at').fill(String(TARGET))
  await shot('home')

  // 2. Post it; two strangers vote; the creator reloads to see 2 of 3 and the swipe card.
  await page.getByRole('button', { name: 'Create poll' }).click()
  await page.waitForURL(/\/p\/[^/?]+/)
  await page.getByText('Your poll is live').waitFor()
  const id = new URL(page.url()).pathname.split('/').pop()
  await strangerVotes(id, 1)
  await strangerVotes(id, 0)
  await page.goto(`${base}/p/${id}`)
  await page.getByText(`2 of ${TARGET} votes`).waitFor()
  await page.getByText(/left$/).waitFor()
  await shot('vote')

  // 3. The creator casts the last vote: the poll closes and shows its winner.
  await page.getByRole('button', { name: 'Pick A' }).click()
  await page.getByText(/^Winner:/).waitFor()
  await page.getByText(`Closed with ${TARGET} votes`).waitFor()
  await shot('result')

  await context.close()
}

try {
  await mkdir(outDir, { recursive: true })
  await waitForApp()
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  try {
    await run(browser, 'desktop', { viewport: { width: 1280, height: 800 } })
    await run(browser, 'mobile', { ...devices['iPhone 13'] })
  } finally {
    await browser.close()
  }
  console.log(`Saved 6 screenshots to docs/screenshots/`)
} finally {
  stopApp()
}
