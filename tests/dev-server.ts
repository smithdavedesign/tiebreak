// vitest globalSetup: one `next dev` for every browser test file. Next 16 runs one dev server per project
// directory (a second exits at once), and vitest runs test files in parallel, so the browser tests share
// this one. It starts only when CHROMIUM_PATH is set, since those tests skip without it, and the files
// wait for it to answer (tests/browser.ts), so unit tests don't wait on it.
//
// Sample data only: the app never sees a real database or Stripe setting from this shell (those variables
// are dropped, so it runs on the in-memory PGlite), and house polls are off. NEXT_PUBLIC_VERCEL_ENV is
// "production" so the visit beacon is live in the browser code, as it is on the real site: automated
// browsers never send it (navigator.webdriver), and the one test that checks it stubs RepoHQ's endpoint.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    /** The shared dev server's URL; unset when CHROMIUM_PATH isn't. */
    devServer: string
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

export default async function startDevServer(project: TestProject) {
  if (!process.env.CHROMIUM_PATH) return
  const port = await freePort()
  // Not vitest's NODE_ENV either: next dev sets its own.
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
  project.provide('devServer', `http://localhost:${port}`)
  return () => {
    try {
      if (app.pid) process.kill(-app.pid, 'SIGTERM')
    } catch {}
  }
}
