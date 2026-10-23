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

/** A link's tag: a short word of lower-case letters, digits and dashes, so nothing else in an address is sent. */
const REF_PATTERN = /^[a-z0-9-]{1,32}$/

/** The `ref` tag of a page address (`?ref=poll` on a poll's "Make your own tiebreak" link), or null. */
export function refFor(search: string): string | null {
  const ref = new URLSearchParams(search).get('ref')?.toLowerCase()
  return ref !== undefined && REF_PATTERN.test(ref) ? ref : null
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
 * Fire-and-forget funnel event. visit: once per browser session (sessionStorage), and once more per
 * link tag (a page opened at `?ref=poll` sends a visit with `ref: "poll"`, even if this session already
 * counted one); activate: once per browser (localStorage); checkout: every Buy click. No cookies. Sent
 * as text/plain so the browser needs no CORS preflight; the endpoint parses the JSON body. If storage is
 * unavailable, nothing is sent rather than repeating a once-only event.
 */
export function sendSignal(kind: SignalKind): void {
  try {
    const optedOut = localStorage.getItem(NOTRACK_KEY) !== null
    if (!shouldSend({ vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV, webdriver: navigator.webdriver === true, optedOut })) return
    const ref = kind === 'visit' ? refFor(location.search) : null
    if (kind === 'visit') {
      const key = ref === null ? VISITED_KEY : `${VISITED_KEY}:${ref}`
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
      sessionStorage.setItem(VISITED_KEY, '1') // a tagged visit is this session's visit too
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
