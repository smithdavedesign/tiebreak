// The Vercel deploy's one job since 2026-11-07: send every request to the live Workers site, same path and
// same query string (vercel.json). Shared by the offline tests (tests/vercel-redirect.test.ts), the live checks
// (tests/live-site.test.ts) and `npm run screenshots`, which imports this file directly (Node strips the types),
// so it uses no path aliases and only erasable TypeScript.
import { readFileSync } from 'node:fs'

/** Where tiebreak lives now: the Cloudflare Worker (`npm run cf:build`, deployed with the credential broker). */
export const WORKERS_URL = 'https://tiebreak.1426davejobs.workers.dev'
/** The old Vercel address: LAUNCH-KIT, past posts, the native app's API URL and Stripe's notes still use it. */
export const VERCEL_URL = 'https://tiebreak-phi.vercel.app'

export type VercelRedirect = { source: string; destination: string; permanent?: boolean; statusCode?: number }
export type VercelConfig = {
  framework?: string | null
  installCommand?: string
  buildCommand?: string
  outputDirectory?: string
  redirects?: VercelRedirect[]
  [key: string]: unknown
}

export function readVercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as VercelConfig
}

/** Vercel's status for a redirect rule: `permanent` picks 308 or 307, else `statusCode`, else 308. */
function statusOf(rule: VercelRedirect): number {
  if (typeof rule.permanent === 'boolean') return rule.permanent ? 308 : 307
  return rule.statusCode ?? 308
}

/**
 * The one rule shape vercel.json uses, Vercel's documented whole-domain redirect: source `/:name(.*)`, which
 * captures the whole path after the first slash (empty for `/`), and destination `https://<host>/:name`.
 * Anything else throws, so a changed rule can't pass on a stand-in that doesn't understand it.
 */
function parseRule(rule: VercelRedirect) {
  const source = /^\/:([A-Za-z_]\w*)\(\.\*\)$/.exec(rule.source)
  const destination = /^(https:\/\/[a-z0-9.-]+)\/:([A-Za-z_]\w*)$/.exec(rule.destination)
  if (!source || !destination || source[1] !== destination[2]) {
    throw new Error(`Only "/:path(.*)" → "https://<host>/:path" rules are modelled here, not ${JSON.stringify(rule)}`)
  }
  return { origin: destination[1] }
}

/**
 * What Vercel answers for a request, given vercel.json's redirects: the first rule that matches wins; its
 * Location is the destination with the captured path, and the request's query string passed through (Vercel
 * passes it on for redirects, as Next.js does). Any method: a redirect is decided before anything is served.
 * Null when no rule matches (Vercel would then serve the output directory).
 */
export function vercelRedirect(config: VercelConfig, pathAndQuery: string): { status: number; location: string } | null {
  for (const rule of config.redirects ?? []) parseRule(rule)
  const [first] = config.redirects ?? []
  if (!first) return null
  // `/:path(.*)` matches every path, so the first rule always wins; its capture is the raw path after the first
  // slash, as the request sent it (`//other.host/x` is a path here, not a host).
  if (!pathAndQuery.startsWith('/')) throw new Error(`Not a request path: ${pathAndQuery}`)
  const q = pathAndQuery.indexOf('?')
  const path = q === -1 ? pathAndQuery : pathAndQuery.slice(0, q)
  const search = q === -1 ? '' : pathAndQuery.slice(q)
  return { status: statusOf(first), location: `${parseRule(first).origin}${path}${search}` }
}

/** The `href` of a page's <link rel="canonical">, wherever Next put it in the HTML (head, or streamed). */
export function canonicalOf(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    if (/\brel="canonical"/.test(tag)) return /\bhref="([^"]+)"/.exec(tag)?.[1]?.replace(/&amp;/g, '&') ?? null
  }
  return null
}

/**
 * The files this feature may not change: the web app's source and runtime config, its dependencies, and the
 * native app. A PR that only redirects Vercel can't break the Workers site this way.
 *
 * Except two pages' metadata, which criterion 5 (every page's canonical URL on the Workers host) can't be met
 * without: a poll page's canonical, and the 404 page's. Criteria 3 and 5 conflict as written, and 5 wins for
 * these two files only (GROWTH.md 2026-11-07).
 */
export const CANONICAL_PAGE_FILES = ['app/p/[id]/page.tsx', 'app/not-found.tsx']
const OFF_LIMITS_DIRS = /^(app|lib|mobile|public)\//
const OFF_LIMITS_FILES = new Set([
  'next.config.ts',
  'open-next.config.ts',
  'wrangler.jsonc',
  'tsconfig.json',
  'package-lock.json',
  'middleware.ts',
  'proxy.ts',
  'instrumentation.ts',
])

export function offLimitsChanges(files: string[]): string[] {
  return files.filter((f) => !CANONICAL_PAGE_FILES.includes(f) && (OFF_LIMITS_DIRS.test(f) || OFF_LIMITS_FILES.has(f)))
}

/**
 * In package.json, only the two Workers production-build scripts may change (they pin the Workers address
 * and production env, the Workers side of this redirect). Returns what else changed.
 */
export const WORKERS_BUILD_SCRIPTS = ['cf:build', 'deploy']

export function packageJsonDrift(before: string, after: string): string[] {
  const a = JSON.parse(before) as Record<string, unknown>
  const b = JSON.parse(after) as Record<string, unknown>
  const drift: string[] = []
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'scripts') continue
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) drift.push(key)
  }
  const sa = (a.scripts ?? {}) as Record<string, string>
  const sb = (b.scripts ?? {}) as Record<string, string>
  for (const name of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (sa[name] !== sb[name] && !WORKERS_BUILD_SCRIPTS.includes(name)) drift.push(`scripts.${name}`)
  }
  return drift
}

/** `NAME=value` pairs an npm script sets before its command (`cf:build`'s build-time env). */
export function scriptEnv(script: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const word of script.split(/\s+/)) {
    const pair = /^([A-Z_][A-Z0-9_]*)=(\S*)$/.exec(word)
    if (!pair) break
    env[pair[1]] = pair[2]
  }
  return env
}
