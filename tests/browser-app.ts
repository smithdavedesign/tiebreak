// The browser tests' dev server: one `next dev`, started once for the whole run (vitest globalSetup) and
// shared by every *-browser.test.ts file. Next 16 locks .next per project, so two test files can't each
// start their own. It starts only when CHROMIUM_PATH is set (the browser tests skip without it), and the
// files that use it wait for it with appReady().
//
// Sample data only: the app runs on its in-memory database, and never sees a real database or Stripe
// setting from this shell (those variables are dropped, as in scripts/screenshots.mjs). It does run with
// NEXT_PUBLIC_VERCEL_ENV=production, so the visit beacon behaves as it does live. Automated browsers still
// send nothing (navigator.webdriver), and the one test that clears that flag answers the signal endpoint
// itself, so no test reaches RepoHQ.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    /** The shared dev server's URL, e.g. http://localhost:41234 ('' when CHROMIUM_PATH is unset). */
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

export default async function setup(project: TestProject) {
  project.provide('appBase', '')
  if (!process.env.CHROMIUM_PATH) return
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    HOUSE_POLLS: 'off',
  }
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
  project.provide('appBase', `http://localhost:${port}`)
  return () => {
    try {
      if (app.pid) process.kill(-app.pid, 'SIGTERM')
    } catch {}
  }
}

/** Resolves once the shared dev server answers (it compiles on first use, so give it a few minutes). */
export async function appReady(base: string) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The dev server did not answer on ${base}`)
}
