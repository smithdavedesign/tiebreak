import { SIGNAL_URL } from '@/lib/site'

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

const REF_PATTERN = /^[a-z0-9_-]{1,32}$/

/**
 * The ?ref tag on the page's URL, lower-cased, or null. Our own links set it (the poll page's "Make your
 * own tiebreak" goes to /?ref=poll), so a visit says which link it came through even from the same site,
 * where there's no referrer to send. Anything but a short plain tag is ignored.
 */
export function refFor(search: string): string | null {
  const ref = new URLSearchParams(search).get('ref')?.toLowerCase() ?? ''
  return REF_PATTERN.test(ref) ? ref : null
}

/**
 * Fire-and-forget funnel event. visit: once per browser session (sessionStorage), plus once per ?ref tag
 * the session lands on; activate: once per browser (localStorage); checkout: every Buy click. No cookies.
 * Sent as text/plain so the browser needs no CORS preflight; the endpoint parses the JSON body. If
 * storage is unavailable, nothing is sent rather than repeating a once-only event.
 */
export function sendSignal(kind: SignalKind): void {
  try {
    const optedOut = localStorage.getItem(NOTRACK_KEY) !== null
    if (!shouldSend({ vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV, webdriver: navigator.webdriver === true, optedOut })) return
    const ref = kind === 'visit' ? refFor(location.search ?? '') : null
    if (kind === 'visit') {
      // A voter's first page already counted the session, so a tagged visit has a flag of its own.
      const key = ref === null ? VISITED_KEY : `${VISITED_KEY}:${ref}`
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
      sessionStorage.setItem(VISITED_KEY, '1')
    } else if (kind === 'activate') {
      if (localStorage.getItem(ACTIVATED_KEY)) return
      localStorage.setItem(ACTIVATED_KEY, '1')
    }
    const referrer = referrerFor(document.referrer, location.origin)
    const body = JSON.stringify({ slug: 'tiebreak', kind, referrer, ...(ref === null ? {} : { ref }) })
    fetch(SIGNAL_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(() => {})
  } catch {
    // Storage blocked or fetch unavailable: the product matters more than the count.
  }
}
