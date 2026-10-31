// The voter loop (growth, 2026-10-23): once a visitor has voted on a poll (or arrives
// after it closed), the poll page offers "Make your own tiebreak", a link to /?ref=poll.
// Following it counts a visit tagged ref=poll, even though the poll page already counted
// one this session. The click in Chromium, with the beacon captured: tests/share-card-browser.test.ts.
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PrivacyPage from '@/app/privacy/page'
import { refFor, sendSignal } from '@/lib/beacon'
import { SIGNAL_URL } from '@/lib/site'
import { basicPoll, createPoll, useTestDb, vote, voter } from './helpers'

let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookie && name === 'tb_voter' ? { name, value: cookie } : undefined),
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: PollPage } = await import('@/app/p/[id]/page')

useTestDb()

/** Renders a poll page as the given account (a `tb_voter=…` cookie string, or nobody). */
async function render(id: string, as?: string) {
  cookie = as?.split('=')[1]
  return renderToString((await PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })) as ReactElement)
}

const LINK = /<a[^>]*href="\/\?ref=poll"[^>]*>Make your own tiebreak<\/a>/

describe('"Make your own tiebreak" on the poll page', () => {
  it("isn't there before the visitor votes", async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    const html = await render(body.id, voter(2))
    expect(html).not.toContain('Make your own tiebreak')
    expect(html).toMatch(/>Pick (<!-- -->)?A</) // still voting
  })

  it('links a voter to /?ref=poll once they have voted', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    expect((await vote(body.id, 1, voter(2))).res.status).toBe(201)
    const html = await render(body.id, voter(2))
    expect(html).toContain('You picked')
    expect(html).toMatch(LINK)
    expect(html).toContain('Stuck on a choice of your own?')
  })

  it('is there on the result page for the voter whose vote closed the poll', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))
    const html = await render(body.id, voter(2))
    expect(html).toContain('Winner: ')
    expect(html).toMatch(LINK)
  })

  it('is there for someone who arrives after the poll closed and can no longer vote', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))
    expect(await render(body.id, voter(3))).toMatch(LINK)
    expect(await render(body.id)).toMatch(LINK)
  })

  it("isn't shown to the poll's creator, who already made one", async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    await vote(body.id, 0, voter(1))
    const html = await render(body.id, voter(1))
    expect(html).toContain('You picked')
    expect(html).not.toContain('Make your own tiebreak')
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('following the link: the visit beacon', () => {
  const SITE = 'https://tiebreak-phi.vercel.app'
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  let here: { origin: string; search: string }
  let doc: { referrer: string }

  beforeEach(() => {
    fetchMock.mockClear()
    here = { origin: SITE, search: '' }
    doc = { referrer: 'https://www.reddit.com/' }
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('location', here)
    vi.stubGlobal('document', doc)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const sent = () =>
    fetchMock.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit]
      expect(url).toBe(SIGNAL_URL)
      return JSON.parse(init.body as string)
    })

  /** A full page load of `search` on tiebreak, coming from `referrer`. */
  function land(search: string, referrer: string) {
    here.search = search
    doc.referrer = referrer
    sendSignal('visit')
  }

  it('records ref=poll when the link is followed, though the poll page already counted a visit this session', () => {
    land('', 'https://www.reddit.com/') // the shared poll link
    land('?ref=poll', `${SITE}/p/AAAAAAAAAAAA`) // "Make your own tiebreak"
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'visit', referrer: 'https://www.reddit.com/' },
      { slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'poll' },
    ])
  })

  it('counts a tagged visit once per session, and it stands in for the plain one', () => {
    land('?ref=poll', `${SITE}/p/AAAAAAAAAAAA`)
    land('?ref=poll', `${SITE}/p/BBBBBBBBBBBB`) // a second poll, a second click
    land('', `${SITE}/?ref=poll`) // then on around the site
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'poll' }])
  })

  it('leaves untagged visits, activate and checkout as they were', () => {
    here.search = '?ref=poll'
    sendSignal('activate')
    sendSignal('checkout')
    here.search = ''
    sendSignal('visit')
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'activate', referrer: 'https://www.reddit.com/' },
      { slug: 'tiebreak', kind: 'checkout', referrer: 'https://www.reddit.com/' },
      { slug: 'tiebreak', kind: 'visit', referrer: 'https://www.reddit.com/' },
    ])
  })

  it('sends nothing off production, from automated browsers or after the opt-out, tag or not', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    land('?ref=poll', SITE)
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('navigator', { webdriver: true })
    land('?ref=poll', SITE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('only passes on a tag that is a short word (letters, digits, dashes)', () => {
    expect(refFor('?ref=poll')).toBe('poll')
    expect(refFor('?x=1&ref=Launch-Post')).toBe('launch-post')
    expect(refFor('')).toBeNull()
    expect(refFor('?ref=')).toBeNull()
    expect(refFor('?ref=jane%40example.com')).toBeNull()
    expect(refFor('?ref=two%20words')).toBeNull()
    expect(refFor(`?ref=${'a'.repeat(33)}`)).toBeNull()
    land('?ref=jane%40example.com', SITE)
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null }])
  })
})

describe('the privacy page', () => {
  it("says a visit can carry a link's tag such as ref=poll", () => {
    const html = renderToString(PrivacyPage())
    expect(html).toContain('ref=poll')
  })

  it('says the share card fetches linked option images from tiebreak’s server', () => {
    expect(renderToString(PrivacyPage())).toContain('share card')
  })
})
