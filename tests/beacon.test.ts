// The funnel beacon: the pure send-or-not decision, the referrer rule, and the browser sender
// (visit once per session, activate once per browser, checkout on every Buy click).
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PrivacyPage from '@/app/privacy/page'
import { NOTRACK_KEY, referrerFor, sendSignal, shouldSend } from '@/lib/beacon'
import { SIGNAL_URL } from '@/lib/site'

describe('shouldSend', () => {
  const ok = { vercelEnv: 'production', webdriver: false, optedOut: false }
  it('sends on production for a normal browser', () => {
    expect(shouldSend(ok)).toBe(true)
  })
  it('sends nothing on previews, in local dev or when the env is unknown', () => {
    expect(shouldSend({ ...ok, vercelEnv: 'preview' })).toBe(false)
    expect(shouldSend({ ...ok, vercelEnv: 'development' })).toBe(false)
    expect(shouldSend({ ...ok, vercelEnv: undefined })).toBe(false)
  })
  it('sends nothing from automated browsers or after the notrack opt-out', () => {
    expect(shouldSend({ ...ok, webdriver: true })).toBe(false)
    expect(shouldSend({ ...ok, optedOut: true })).toBe(false)
  })
})

describe('referrerFor', () => {
  it('keeps a referrer from another origin', () => {
    expect(referrerFor('https://www.google.com/search?q=x', 'https://tiebreak-phi.vercel.app')).toBe('https://www.google.com/search?q=x')
  })
  it('is null for the same origin, an empty referrer or garbage', () => {
    expect(referrerFor('https://tiebreak-phi.vercel.app/feed', 'https://tiebreak-phi.vercel.app')).toBeNull()
    expect(referrerFor('', 'https://tiebreak-phi.vercel.app')).toBeNull()
    expect(referrerFor('not a url', 'https://tiebreak-phi.vercel.app')).toBeNull()
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('sendSignal', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  let local: ReturnType<typeof memoryStorage>
  let nav: { webdriver: boolean }

  beforeEach(() => {
    fetchMock.mockClear()
    local = memoryStorage()
    nav = { webdriver: false }
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', nav)
    vi.stubGlobal('location', { origin: 'https://tiebreak-phi.vercel.app' })
    vi.stubGlobal('document', { referrer: 'https://news.ycombinator.com/' })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const sent = () =>
    fetchMock.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit]
      return { url, init, body: JSON.parse(init.body as string) }
    })

  it('posts {slug, kind, referrer} to the RepoHQ signal endpoint with keepalive and no credentials', () => {
    sendSignal('visit')
    const [call] = sent()
    expect(call.url).toBe(SIGNAL_URL)
    expect(call.init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' })
    expect(call.body).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: 'https://news.ycombinator.com/' })
  })
  it('sends a null referrer when the visitor came from the same site', () => {
    vi.stubGlobal('document', { referrer: 'https://tiebreak-phi.vercel.app/pro' })
    sendSignal('visit')
    expect(sent()[0].body.referrer).toBeNull()
  })
  it('counts a visit once per session, and activate once per browser', () => {
    sendSignal('visit')
    sendSignal('visit')
    sendSignal('activate')
    sendSignal('activate')
    expect(sent().map((c) => c.body.kind)).toEqual(['visit', 'activate'])
  })
  it('sends checkout on every Buy click', () => {
    sendSignal('checkout')
    sendSignal('checkout')
    expect(sent().map((c) => c.body.kind)).toEqual(['checkout', 'checkout'])
  })
  it('sends nothing on a preview deployment', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    sendSignal('visit')
    sendSignal('checkout')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sends nothing from an automated browser', () => {
    nav.webdriver = true
    sendSignal('visit')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sends nothing once repohq:notrack is set', () => {
    local.setItem(NOTRACK_KEY, '1')
    sendSignal('visit')
    sendSignal('activate')
    sendSignal('checkout')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('never throws when storage or fetch is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => sendSignal('visit')).not.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(() => sendSignal('checkout')).not.toThrow()
  })
})

describe('privacy page', () => {
  it('names the three events and the opt-out', () => {
    const html = renderToString(PrivacyPage())
    for (const name of ['visit', 'activate', 'checkout']) expect(html).toContain(`“${name}”`)
    expect(html).toContain('repohq:notrack')
  })
})
