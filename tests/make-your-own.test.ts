// The "make your own" loop: once a voter has voted (or the poll has closed), the poll page
// offers "Make your own tiebreak", a link to /?ref=poll. Following it, the start page's visit
// beacon sends ref "poll", even though the voter's first page this session already sent a visit.
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refFor, sendSignal, VISITED_KEY } from '@/lib/beacon'
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

async function render(page: () => Promise<ReactElement>, as?: string) {
  cookie = as?.split('=')[1]
  return renderToString(await page())
}

const pollPage = (id: string, query: Record<string, string> = {}) => () =>
  PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) })

const MAKE_YOUR_OWN = /<a class="button" href="\/\?ref=poll">Make your own tiebreak<\/a>/

describe("the poll page's 'Make your own tiebreak' link", () => {
  it('appears once the voter has voted, and goes to /?ref=poll', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 3 }, voter(1))
    expect(await render(pollPage(body.id), voter(2))).not.toContain('Make your own tiebreak')

    await vote(body.id, 0, voter(2))
    const html = await render(pollPage(body.id), voter(2))
    expect(html).toContain('You picked <b>')
    expect(html).toMatch(MAKE_YOUR_OWN)
  })

  it('stays for the voter once the poll has closed', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 1, voter(2))
    const html = await render(pollPage(body.id), voter(2))
    expect(html).toContain('Winner: ')
    expect(html).toMatch(MAKE_YOUR_OWN)
  })

  it('is offered to a visitor who arrives after the poll closed (there is nothing left to vote on)', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))
    expect(await render(pollPage(body.id), voter(3))).toMatch(MAKE_YOUR_OWN)
    expect(await render(pollPage(body.id))).toMatch(MAKE_YOUR_OWN)
  })

  it("isn't shown before a vote, or to the poll's creator", async () => {
    const { body } = await createPoll({ ...basicPoll, target: 2 }, voter(1))
    expect(await render(pollPage(body.id))).not.toContain('Make your own tiebreak')
    expect(await render(pollPage(body.id, { new: '1' }), voter(1))).not.toContain('Make your own tiebreak')
    await vote(body.id, 0, voter(1)) // creators can vote on their own poll
    await vote(body.id, 1, voter(2))
    expect(await render(pollPage(body.id), voter(1))).not.toContain('Make your own tiebreak')
  })
})

describe('refFor', () => {
  it('reads a short ?ref tag', () => {
    expect(refFor('?ref=poll')).toBe('poll')
    expect(refFor('?x=1&ref=Poll')).toBe('poll')
    expect(refFor('?ref=launch_post-2')).toBe('launch_post-2')
  })
  it('is null without one, or for anything that is not a plain tag', () => {
    for (const search of ['', '?', '?refx=poll', '?ref=', '?ref=%3Cscript%3E', `?ref=${'a'.repeat(33)}`, '?ref=a b', '?ref=https://evil.example']) {
      expect(refFor(search), search).toBeNull()
    }
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('the visit beacon after following the link', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  const ORIGIN = 'https://tiebreak-phi.vercel.app'
  let session: ReturnType<typeof memoryStorage>

  /** The browser is on `path` (with its query), having come from `referrer`. */
  const at = (path: string, referrer: string) => {
    const url = new URL(path, ORIGIN)
    vi.stubGlobal('location', { origin: url.origin, search: url.search })
    vi.stubGlobal('document', { referrer })
  }
  const sent = () => fetchMock.mock.calls.map((c) => {
    const [url, init] = c as unknown as [string, RequestInit]
    return { url, body: JSON.parse(init.body as string) }
  })

  beforeEach(() => {
    fetchMock.mockClear()
    session = memoryStorage()
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('navigator', { webdriver: false })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('records ref=poll on the start page, after the poll page already counted the visit', () => {
    // A voter opens a shared poll link from a chat, votes, then follows "Make your own tiebreak".
    at('/p/AAAAAAAAAAAA', 'https://discord.com/')
    sendSignal('visit')
    at('/?ref=poll', `${ORIGIN}/p/AAAAAAAAAAAA`)
    sendSignal('visit')

    expect(sent().map((c) => c.url)).toEqual([SIGNAL_URL, SIGNAL_URL])
    expect(sent()[0].body).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: 'https://discord.com/' })
    expect(sent()[1].body).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'poll' })
  })

  it('counts a ref once per session, and the visit it starts as the session visit', () => {
    at('/?ref=poll', '')
    sendSignal('visit')
    sendSignal('visit') // a reload
    at('/feed', '')
    sendSignal('visit') // another page in the same session
    expect(sent().map((c) => c.body)).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, ref: 'poll' }])
    expect(session.getItem(VISITED_KEY)).toBe('1')
  })

  it('treats a bogus tag as a plain visit', () => {
    at('/?ref=%3Cscript%3E', 'https://news.ycombinator.com/')
    sendSignal('visit')
    expect(sent().map((c) => c.body)).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://news.ycombinator.com/' }])
  })

  it('leaves activate and checkout as they were', () => {
    at('/?ref=poll', '')
    sendSignal('activate')
    sendSignal('checkout')
    expect(sent().map((c) => c.body)).toEqual([
      { slug: 'tiebreak', kind: 'activate', referrer: null },
      { slug: 'tiebreak', kind: 'checkout', referrer: null },
    ])
  })

  it('still sends nothing outside production', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    at('/?ref=poll', '')
    sendSignal('visit')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the privacy page', () => {
  it('says a visit can carry the tag of the link followed, and that the card fetches image links', async () => {
    const { default: PrivacyPage } = await import('@/app/privacy/page')
    const html = renderToString(PrivacyPage())
    expect(html).toContain('“poll” from a poll&#x27;s “Make your own tiebreak” link')
    expect(html).toContain('preview card')
  })
})
