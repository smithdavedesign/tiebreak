import { ETSY_PHOTO_TEST_PATH, SIGNAL_URL } from '@/lib/site'

/** The three funnel events tiebreak sends to RepoHQ (named on the privacy page). */
export type SignalKind = 'visit' | 'activate' | 'checkout'

export const NOTRACK_KEY = 'repohq:notrack'
export const ACTIVATED_KEY = 'repohq:activated'
export const VISITED_KEY = 'repohq:visited'

/**
 * Pages whose visitors RepoHQ counts apart from the rest (the search pages included): a visit to one
 * carries its path, and counts once per session even when the session started on another page.
 */
export const PATHS_COUNTED_APART: readonly string[] = [ETSY_PHOTO_TEST_PATH]

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

/**
 * Fire-and-forget funnel event. visit: once per browser session (sessionStorage), plus once per session
 * on each page counted apart; activate: once per browser (localStorage); checkout: every Buy click. No
 * cookies. Sent as text/plain so the browser needs no CORS preflight; the endpoint parses the JSON body.
 * If storage is unavailable, nothing is sent rather than repeating a once-only event.
 *
 * `path` is the page the visit is for: the address bar's by default. A page counted apart passes its own,
 * since after a client-side link the address may not have changed yet when the page mounts.
 */
export function sendSignal(kind: SignalKind, path?: string): void {
  try {
    const optedOut = localStorage.getItem(NOTRACK_KEY) !== null
    if (!shouldSend({ vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV, webdriver: navigator.webdriver === true, optedOut })) return
    let referrer = referrerFor(document.referrer, location.origin)
    let apart: string | null = null
    if (kind === 'visit') {
      const page = path ?? location.pathname
      apart = PATHS_COUNTED_APART.includes(page) ? page : null
      const key = apart ? `${VISITED_KEY}:${apart}` : VISITED_KEY
      if (sessionStorage.getItem(key)) return
      // Reached from another page of this session: document.referrer still names where the session began.
      if (sessionStorage.getItem(VISITED_KEY)) referrer = null
      sessionStorage.setItem(key, '1')
      sessionStorage.setItem(VISITED_KEY, '1')
    } else if (kind === 'activate') {
      if (localStorage.getItem(ACTIVATED_KEY)) return
      localStorage.setItem(ACTIVATED_KEY, '1')
    }
    const body = JSON.stringify({ slug: 'tiebreak', kind, referrer, ...(apart ? { path: apart } : {}) })
    fetch(SIGNAL_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(() => {})
  } catch {
    // Storage blocked or fetch unavailable: the product matters more than the count.
  }
}
