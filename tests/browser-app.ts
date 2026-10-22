// vitest globalSetup: one dev server for the browser tests (tests/*-browser.test.ts), started once and shared,
// because Next locks .next per project and a second `next dev` in this directory exits. It starts only when
// CHROMIUM_PATH is set (a Chromium or Chrome binary; no browser is downloaded); without it those tests skip.
//
// The app runs on an in-memory database with sample data only: this shell's DATABASE_URL, Stripe settings and
// Vercel env never reach it, and neither does vitest's NODE_ENV. NEXT_PUBLIC_VERCEL_ENV is set to production
// so the visit beacon's code runs as it does live; automated browsers (navigator.webdriver) still send nothing,
// and the one test that clears that flag answers the signal endpoint itself, so nothing leaves the machine.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'
import { png } from './image-bytes'

declare module 'vitest' {
  export interface ProvidedContext {
    /** The shared dev server's URL, or '' when CHROMIUM_PATH is unset and the browser tests skip. */
    appBase: string
  }
}

const root = fileURLToPath(new URL('..', import.meta.url))

async function freePort() {
  const server = createServer().listen(0)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  server.close()
  await once(server, 'close')
  return port
}

async function waitForApp(base: string, app: ChildProcess) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error('The dev server exited before it answered.')
    try {
      if ((await fetch(base)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The dev server did not answer on ${base}`)
}

export default async function setup(project: TestProject) {
  project.provide('appBase', '')
  if (!process.env.CHROMIUM_PATH) return

  const port = await freePort()
  const base = `http://localhost:${port}`
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', HOUSE_POLLS: 'off' }
  for (const name of Object.keys(env)) {
    const drop =
      name === 'DATABASE_URL' ||
      name === 'NODE_ENV' ||
      name.startsWith('STRIPE_') ||
      name.startsWith('VITEST') ||
      name.endsWith('VERCEL_ENV')
    if (drop) delete env[name]
  }
  env.NEXT_PUBLIC_VERCEL_ENV = 'production'
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env,
  })
  const stop = () => {
    try {
      if (app.pid) process.kill(-app.pid, 'SIGTERM')
    } catch {}
  }
  try {
    await waitForApp(base, app)
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([
      fetch(`${base}/images`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png() }),
      fetch(`${base}/images/AAAAAAAAAAAAAAAA`),
      fetch(`${base}/polls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${base}/p/AAAAAAAAAAAA`),
      fetch(`${base}/tools/etsy-thumbnail-preview`),
      fetch(`${base}/tools/book-cover-thumbnail-test`),
      fetch(`${base}/tools/youtube-thumbnail-preview`),
      fetch(`${base}/sitemap.xml`),
    ])
  } catch (error) {
    stop()
    throw error
  }
  project.provide('appBase', base)
  return stop
}
