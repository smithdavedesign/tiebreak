import { ETSY_PHOTO_TEST_PATH, SIGNAL_URL } from '@/lib/site'

/** The three funnel events tiebreak sends to RepoHQ (named on the privacy page). */
export type SignalKind = 'visit' | 'activate' | 'checkout'

export const NOTRACK_KEY = 'repohq:notrack'
export const ACTIVATED_KEY = 'repohq:activated'
export const VISITED_KEY = 'repohq:visited'

type Context = {
  /** NEXT_PUBLIC_VERCEL_ENV: only 'production' counts; previews and local runs send nothing. */
  vercelEnv: string | undefined
  /** navigator.webdriver: automated browsers aren't visitors. */
  webdriver: boolean
  /** localStorage "repohq:notrack" is set: the owner opted out on this browser. */
  optedOut: boolean
}

/** The send-or-not decision, before any once-per-session/browser check. */
export function shouldSend({ vercelEnv, webdriver, optedOut }: Context): boolean {
  return vercelEnv === 'production' && !webdriver && !optedOut
}

/** document.referrer only when it comes from another origin; else null. */
export function referrerFor(documentReferrer: string, origin: string): string | null {
  if (!documentReferrer) return null
  try {
    return new URL(documentReferrer).origin === origin ? null : documentReferrer
  } catch {
    return null
  }
}

/** Pages whose visits carry their path. Every other page's visit (the search pages' too) has none, so these count apart. */
const COUNTED_APART: readonly string[] = [ETSY_PHOTO_TEST_PATH]

/** The `path` a visit landing on this page carries: the page itself if it's counted apart, else none. */
export function visitPath(pathname: string): string | undefined {
  return COUNTED_APART.includes(pathname) ? pathname : undefined
}

/**
 * Fire-and-forget funnel event. visit: once per browser session (sessionStorage); activate: once per
 * browser (localStorage); checkout: every Buy click. No cookies. Sent as text/plain so the browser needs
 * no CORS preflight; the endpoint parses the JSON body. If storage is unavailable, nothing is sent
 * rather than repeating a once-only event. `path` (visits only, from visitPath) names the page the
 * session landed on; without it the body is as before.
 */
export function sendSignal(kind: SignalKind, path?: string): void {
  try {
    const optedOut = localStorage.getItem(NOTRACK_KEY) !== null
    if (!shouldSend({ vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV, webdriver: navigator.webdriver === true, optedOut })) return
    if (kind === 'visit') {
      if (sessionStorage.getItem(VISITED_KEY)) return
      sessionStorage.setItem(VISITED_KEY, '1')
    } else if (kind === 'activate') {
      if (localStorage.getItem(ACTIVATED_KEY)) return
      localStorage.setItem(ACTIVATED_KEY, '1')
    }
    const referrer = referrerFor(document.referrer, location.origin)
    const body = JSON.stringify(path ? { slug: 'tiebreak', kind, referrer, path } : { slug: 'tiebreak', kind, referrer })
    fetch(SIGNAL_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(() => {})
  } catch {
    // Storage blocked or fetch unavailable: the product matters more than the count.
  }
}
