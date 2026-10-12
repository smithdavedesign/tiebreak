// Server-renders the pages M2 touches (feed, create form, poll page) against
// the test database: the page functions run for real, only Next's request
// APIs are stubbed. Stands in for a browser smoke check.
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { basicPoll, createPoll, earnCredits, postPublicPoll, useTestDb, vote, voter } from './helpers'

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

const { default: FeedPage } = await import('@/app/feed/page')
const { default: HomePage } = await import('@/app/page')
const { default: PollPage } = await import('@/app/p/[id]/page')

useTestDb()

/** Renders a page as the given account (a `tb_voter=…` cookie string, or nobody). */
async function render(page: () => Promise<ReactElement>, as?: string) {
  cookie = as?.split('=')[1]
  return renderToString(await page())
}

const pollPage = (id: string, query: Record<string, string> = {}) => () =>
  PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) })

describe('/feed', () => {
  it('shows the first card with Skip and Report, and the credit meter', async () => {
    await postPublicPoll(voter(1), { question: 'Sunset or skyline?', durationHours: 1 })
    await postPublicPoll(voter(2), { question: 'Later poll', durationHours: 48 })
    const html = await render(FeedPage, voter(3))

    expect(html).toContain('Sunset or skyline?')
    expect(html).not.toContain('Later poll') // one card at a time
    expect(html).toContain('Skip')
    expect(html).toContain('Report')
    expect(html).toMatch(/0 credits<\/b> to post a public poll/)
    expect(html).toContain('5 more votes')
  })

  it('says when there is nothing left to vote on', async () => {
    const html = await render(FeedPage)
    expect(html).toContain('all caught up')
  })

  it("doesn't show the viewer's own poll", async () => {
    await postPublicPoll(voter(1), { question: 'My own poll' })
    expect(await render(FeedPage, voter(1))).not.toContain('My own poll')
  })
})

describe('/ (create form)', () => {
  it('disables the public checkbox without a credit and says how to earn one', async () => {
    const html = await render(HomePage, voter(1))
    expect(html).toMatch(/<input type="checkbox" disabled=""/)
    expect(html).toContain('vote on <!-- -->5<!-- --> more')
  })

  it('enables it with a credit', async () => {
    await earnCredits(voter(1))
    const html = await render(HomePage, voter(1))
    expect(html).toMatch(/<input type="checkbox"\/?>/)
    expect(html).not.toMatch(/type="checkbox" disabled/)
    expect(html).toContain('uses 1 of your <!-- -->1<!-- --> <!-- -->credit')
  })
})

describe('/p/:id', () => {
  it('shows Report to other people but not to the creator', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    expect(await render(pollPage(body.id), voter(2))).toContain('>Report</button>')
    expect(await render(pollPage(body.id))).toContain('>Report</button>')
    expect(await render(pollPage(body.id), voter(1))).not.toContain('>Report</button>')
  })

  it('tells the creator a public poll is in the feed', async () => {
    const id = await postPublicPoll(voter(1))
    const html = await render(pollPage(id, { new: '1' }), voter(1))
    expect(html).toContain('live in the public feed')
  })

  it('still renders the result page after voting', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 1, voter(2))
    const html = await render(pollPage(body.id), voter(2))
    expect(html).toContain('Winner: ')
    expect(html).toContain('You voted <!-- -->B')
  })
})
