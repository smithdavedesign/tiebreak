// The move off Vercel (GROWTH.md 2026-11-08): tiebreak runs on Cloudflare Workers, and the old Vercel address
// answers every request with a permanent redirect there (vercel.json). The addresses, a model of how Vercel
// answers a request under vercel.json, a browser harness that plays the Workers site from a local app, and which
// files the PR may touch. Shared by the tests and by `npm run screenshots` (Node runs this file as plain
// TypeScript there), so it imports nothing from the app.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { BrowserContext, Route, WebSocketRoute } from 'playwright-core'

/** The live site: the Workers deploy of main. */
export const WORKERS_URL = 'https://tiebreak.1426davejobs.workers.dev'
/** The old address: LAUNCH-KIT.md, past posts, shared poll links, Stripe's return page and the native app's API. */
export const VERCEL_URL = 'https://tiebreak-phi.vercel.app'

export type Redirect = {
  source: string
  destination: string
  permanent?: boolean
  statusCode?: number
  has?: unknown
  missing?: unknown
}
export type VercelConfig = { [key: string]: unknown; redirects?: Redirect[] }
export type Answer = { status: number; location: string }

export const VERCEL_JSON = new URL('../vercel.json', import.meta.url)

export function vercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig
}

type Key = { name: string | number }
type Matching = { strict: boolean; sensitive: boolean; delimiter: string }
// The path-to-regexp (v6) that Vercel's router compiles `source` patterns with, from Next's own copy.
const { pathToRegexp } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (path: string, keys: Key[], options: Matching) => RegExp
}
/** Vercel's options for a `source` (@vercel/routing-utils sourceToRegex): no optional trailing slash, case-sensitive. */
const VERCEL_MATCHING: Matching = { strict: true, sensitive: true, delimiter: '/' }

/**
 * How Vercel answers a request under vercel.json's `redirects`, as a model of its documented routing: each rule's
 * `source` is compiled the way Vercel compiles it and matched against the request's path, the named params go into
 * the destination's path, and the request's query string is passed on (as Next's redirects docs state for the same
 * router: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md).
 * `permanent` (and the default) is a 308, `permanent: false` a 307, or the rule's statusCode. Conditions and
 * destination patterns beyond plain `:name` aren't modelled: such a rule throws, so no test passes on a rule this
 * model doesn't understand. Null when no rule matches (Vercel would then serve the build output).
 */
export function vercelAnswer(config: VercelConfig, url: string): Answer | null {
  const { pathname, search } = new URL(url)
  for (const rule of config.redirects ?? []) {
    if (rule.has !== undefined || rule.missing !== undefined) throw new Error(`Not modelled: a condition on ${rule.source}`)
    const destination = new URL(rule.destination)
    if (/[*+?()]/.test(destination.pathname) || destination.hash) throw new Error(`Not modelled: ${rule.destination}`)
    const keys: Key[] = []
    const match = pathToRegexp(rule.source, keys, VERCEL_MATCHING).exec(pathname)
    if (!match) continue
    const path = destination.pathname.replace(/:(\w+)/g, (_, name: string) => {
      const index = keys.findIndex((key) => key.name === name)
      if (index < 0) throw new Error(`${rule.destination} uses :${name}, which ${rule.source} doesn't capture`)
      return match[index + 1] ?? ''
    })
    const query = [destination.search.slice(1), search.slice(1)].filter(Boolean).join('&')
    const status = rule.statusCode ?? (rule.permanent === false ? 307 : 308)
    return { status, location: `${destination.origin}${path}${query ? `?${query}` : ''}` }
  }
  return null
}

/** Where an old link should land: the same path and query string on the Workers site. */
export function workersTwin(oldUrl: string): string {
  const { pathname, search } = new URL(oldUrl)
  return `${WORKERS_URL}${pathname}${search}`
}

/** A funnel event the page sent, as the browser sent it. */
export type Signal = { body: Record<string, unknown>; pageUrl: string; origin: string | undefined }

/** Request headers that would tell the local app the page is on another host, or that can't be forwarded as they are. */
const NOT_FORWARDED = new Set(['host', 'connection', 'content-length', 'origin', 'referer', 'accept-encoding'])
/** Response headers that describe the local app's wire format, which fetch() has already undone. */
const NOT_RETURNED = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie'])

/** A request to the Workers address, sent to the local app as it is; its answer comes back to the page. */
async function fromLocalApp(route: Route, base: string) {
  const request = route.request()
  const { pathname, search } = new URL(request.url())
  const headers = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(([name]) => !name.startsWith(':') && !name.startsWith('sec-fetch-') && !NOT_FORWARDED.has(name)),
  )
  const posted = request.postDataBuffer()
  const res = await fetch(`${base}${pathname}${search}`, {
    method: request.method(),
    headers,
    body: posted ? new Uint8Array(posted) : undefined,
    redirect: 'manual',
  })
  const returned: Record<string, string> = {}
  res.headers.forEach((value, name) => {
    if (!NOT_RETURNED.has(name)) returned[name] = value
  })
  const cookies = res.headers.getSetCookie()
  if (cookies.length) returned['set-cookie'] = cookies.join('\n')
  await route.fulfill({ status: res.status, headers: returned, body: Buffer.from(await res.arrayBuffer()) })
}

/**
 * The dev server's HMR socket, which the page opens on the Workers address, joined to the local app's: a dev page
 * doesn't hydrate (so no beacon runs) until that socket answers. Any other socket is answered by nobody.
 */
function socketToLocalApp(socket: WebSocketRoute, base: string) {
  const { host, pathname, search } = new URL(socket.url())
  if (host !== new URL(WORKERS_URL).host) return
  const app = new WebSocket(`${base.replace(/^http/, 'ws')}${pathname}${search}`)
  app.binaryType = 'arraybuffer'
  const early: (string | Uint8Array<ArrayBuffer>)[] = []
  app.onopen = () => early.splice(0).forEach((message) => app.send(message))
  app.onmessage = ({ data }) => socket.send(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer))
  app.onclose = () => socket.close()
  socket.onMessage((received) => {
    const message = typeof received === 'string' ? received : new Uint8Array(received)
    if (app.readyState === WebSocket.OPEN) app.send(message)
    else early.push(message)
  })
  socket.onClose(() => app.close())
}

/**
 * Makes a browser context a visitor of the Workers site, which a local app at `base` plays: pages opened on the
 * Workers address run there, with that origin, and are served by the local app. navigator.webdriver is cleared (an
 * automated browser sends no beacon), RepoHQ's signal endpoint is answered here with a 204, and any other host is
 * refused, so nothing leaves the machine. Returns the signals the pages send, as they arrive. Playwright routes only
 * the first URL of a redirect, so an old link's hop to Workers is the caller's to take (vercelAnswer).
 */
export async function visitWorkersFrom(context: BrowserContext, base: string, signalUrl: string): Promise<Signal[]> {
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
  // Routes registered later are asked first. Last asked: anything else is refused.
  await context.route('**/*', (route) => route.abort())
  await context.routeWebSocket(/.*/, (socket) => socketToLocalApp(socket, base))
  await context.route(`${WORKERS_URL}/**`, (route) => fromLocalApp(route, base))
  const signals: Signal[] = []
  await context.route(signalUrl, async (route) => {
    const request = route.request()
    signals.push({ body: JSON.parse(request.postData() ?? 'null'), pageUrl: request.frame().url(), origin: (await request.allHeaders()).origin })
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  return signals
}

/**
 * What this PR may change (criterion 3): the Vercel config (vercel.json, .vercelignore and the one static page
 * Vercel's build needs as output), tests, and what every growth PR updates: the growth log, the README's
 * screenshots, the PNGs, the script that takes them, and a `.provision` request. Plus the three app files criterion 5
 * can't be met without (GROWTH.md 2026-11-08, review follow-up): the site's default address (lib/site.ts), the poll
 * page's canonical link and the 404 page's. Nothing else the app runs or builds from: no other file under app/ or
 * lib/, nothing under mobile/ or public/, no package, Next, OpenNext, wrangler or TypeScript config, and no proxy or
 * middleware.
 */
const IN_SCOPE = [
  /^lib\/site\.ts$/,
  /^app\/p\/\[id\]\/page\.tsx$/,
  /^app\/not-found\.tsx$/,
  /^vercel\.json$/,
  /^\.vercelignore$/,
  /^vercel-redirect\/[^/]+\.html$/,
  /^tests\//,
  /^GROWTH\.md$/,
  /^README\.md$/,
  /^docs\/screenshots\/[^/]+\.png$/,
  /^scripts\/screenshots\.mjs$/,
  /^\.provision$/,
]

export const inScope = (file: string) => IN_SCOPE.some((pattern) => pattern.test(file))
