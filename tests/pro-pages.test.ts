// Server-renders the pages M3 adds or changes (/pro, /terms, the create form
// and the poll page) against the test database, as tests/pages.test.ts does
// for M2. Only Next's request APIs are stubbed; Stripe is faked at fetch.
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  accountIdOf,
  basicPoll,
  checkout,
  createPoll,
  lastSessionId,
  makePro,
  payFakeSession,
  useFakeStripe,
  useTestDb,
  vote,
  voter,
} from './helpers'

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

const { default: ProPage } = await import('@/app/pro/page')
const { default: TermsPage } = await import('@/app/terms/page')
const { default: HomePage } = await import('@/app/page')
const { default: PollPage } = await import('@/app/p/[id]/page')

const db = useTestDb()
const stripe = useFakeStripe()

/** Renders a page as the given account (a `tb_voter=…` cookie string, or nobody). */
async function render(page: () => ReactElement | Promise<ReactElement>, as?: string) {
  cookie = as ? accountIdOf(as) : undefined
  return renderToString(await page())
}

const proPage = (query: Record<string, string> = {}) => () => ProPage({ searchParams: Promise.resolve(query) })
const pollPage = (id: string, query: Record<string, string> = {}) => () =>
  PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) })

const sessionLookups = () => stripe().calls.filter((c) => c.path.startsWith('/v1/checkout/sessions/'))

describe('/pro', () => {
  it('sells Pro to a free account with the price from Stripe', async () => {
    const html = await render(proPage(), voter(1))
    expect(html).toContain('Private polls')
    expect(html).toContain('CSV')
    expect(html).toContain('$9.00')
    expect(html).toContain('Get Pro for $9.00')
    expect(html).toContain('belongs to this browser')
    expect(html).toContain('href="/terms"')
    expect(html).not.toContain('You have Pro')
  })

  it('still offers Pro when Stripe cannot say the price', async () => {
    stripe().failWith = 500
    const html = await render(proPage())
    expect(html).toContain('price shown at checkout')
    expect(html).toContain('>Get Pro</button>')
  })

  it('tells a Pro account it has Pro', async () => {
    await makePro(voter(1))
    const html = await render(proPage(), voter(1))
    expect(html).toContain('You have Pro')
    expect(html).not.toContain('Get Pro for')
  })

  it('fulfils a paid checkout on the return page, before any webhook', async () => {
    const me = voter(1)
    await checkout(me)
    const id = lastSessionId()
    payFakeSession(id)

    const html = await render(proPage({ session_id: id }), me)
    expect(html).toContain('Payment received')
    expect(html).toContain('You have Pro')
    const { rows } = await db().query<{ account_id: string }>('SELECT account_id FROM payments')
    expect(rows).toEqual([{ account_id: accountIdOf(me) }])
  })

  it('says the payment is being confirmed when Stripe has not marked it paid yet', async () => {
    const me = voter(1)
    await checkout(me)
    const html = await render(proPage({ session_id: lastSessionId() }), me)
    expect(html).toContain('confirming your payment')
    expect(html).not.toContain('You have Pro')
  })

  it("never looks up a session id that isn't one", async () => {
    const html = await render(proPage({ session_id: '../../v1/customers' }), voter(1))
    expect(sessionLookups()).toHaveLength(0)
    expect(html).toContain('Get Pro')
  })
})

describe('/terms', () => {
  it('covers payment, refunds, privacy and contact', async () => {
    const html = await render(() => TermsPage())
    for (const heading of ['Pro', 'Refunds', 'Privacy', 'Contact']) expect(html).toContain(`>${heading}</h2>`)
    expect(html).toContain('reply to your Stripe receipt')
  })

  it('shows CONTACT_EMAIL when it is set', async () => {
    vi.stubEnv('CONTACT_EMAIL', 'help@example.com')
    const html = await render(() => TermsPage())
    expect(html).toContain('href="mailto:help@example.com"')
  })
})

describe('/ (create form)', () => {
  it('offers private polls to Pro accounts', async () => {
    await makePro(voter(1))
    const html = await render(HomePage, voter(1))
    expect(html).toContain('Keep the result private')
  })

  it('points free accounts at Pro instead', async () => {
    const html = await render(HomePage, voter(1))
    expect(html).not.toContain('Keep the result private')
    expect(html).toContain('href="/pro"')
  })
})

describe('/p/:id', () => {
  async function closedPrivatePoll(creator: string) {
    await makePro(creator)
    const { body } = await createPoll({ ...basicPoll, target: 1, visibility: 'private' }, creator)
    await vote(body.id, 1, voter(2))
    return body.id as string
  }

  it('keeps a private result from voters and shows it to the creator', async () => {
    const id = await closedPrivatePoll(voter(1))

    const voterHtml = await render(pollPage(id), voter(2))
    expect(voterHtml).toContain('keeps the result private')
    expect(voterHtml).not.toContain('Winner')
    expect(voterHtml).not.toContain("It&#x27;s a tie")
    expect(voterHtml).toContain('You voted <!-- -->B')

    const creatorHtml = await render(pollPage(id), voter(1))
    expect(creatorHtml).toContain('Winner: ')
    expect(creatorHtml).not.toContain('keeps the result private')
  })

  it('gives a Pro creator the CSV download on a closed poll', async () => {
    const id = await closedPrivatePoll(voter(1))
    const html = await render(pollPage(id), voter(1))
    expect(html).toContain(`href="/polls/${id}/export"`)
    expect(html).toContain('Download votes (CSV)')
  })

  it('points a free creator at Pro for the export, and shows others nothing', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))

    const creatorHtml = await render(pollPage(body.id), voter(1))
    expect(creatorHtml).not.toContain('/export')
    expect(creatorHtml).toMatch(/href="\/pro"[^>]*>Get Pro<\/a> to download/)

    const otherHtml = await render(pollPage(body.id), voter(2))
    expect(otherHtml).not.toContain('/export')
    expect(otherHtml).not.toContain('CSV')
  })

  it('offers no export while the poll is open', async () => {
    await makePro(voter(1))
    const { body } = await createPoll(basicPoll, voter(1))
    const html = await render(pollPage(body.id), voter(1))
    expect(html).not.toContain('/export')
  })

  it('tells the creator of a new private poll that only they will see the result', async () => {
    await makePro(voter(1))
    const { body } = await createPoll({ ...basicPoll, visibility: 'private' }, voter(1))
    const html = await render(pollPage(body.id, { new: '1' }), voter(1))
    expect(html).toContain('Only you will see the result')
  })
})
