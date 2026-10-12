// One test (or more) per ROADMAP.md M3 exit criterion.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOUR,
  basicPoll,
  checkout,
  createPoll,
  csvDataRows,
  earnCredits,
  exportCsv,
  feedIds,
  getAccount,
  getPoll,
  lastSessionId,
  makePro,
  payFakeSession,
  stripeEvent,
  stripeWebhook,
  useFakeStripe,
  useTestDb,
  vote,
  voter,
} from './helpers'

const db = useTestDb()
useFakeStripe()

afterEach(() => {
  vi.useRealTimers()
})

const privatePoll = { ...basicPoll, visibility: 'private' }

async function privatePollCount() {
  const { rows } = await db().query<{ n: number }>("SELECT count(*)::int AS n FROM polls WHERE visibility = 'private'")
  return rows[0].n
}

describe('EC1: a free account cannot create a private poll (403); a paid account can', () => {
  it('refuses a free account with 403', async () => {
    const me = voter(1)
    expect((await getAccount(me)).body.plan).toBe('free')

    const refused = await createPoll(privatePoll, me)
    expect(refused.res.status).toBe(403)
    expect(refused.body.plan).toBe('free')
    expect(refused.body.error).toMatch(/Pro/)

    // No cookie at all, and an account that has earned posting credits, are free accounts too.
    expect((await createPoll(privatePoll)).res.status).toBe(403)
    await earnCredits(me)
    expect((await createPoll(privatePoll, me)).res.status).toBe(403)

    expect(await privatePollCount()).toBe(0)
  })

  it('lets the same account create one once it has paid through Stripe Checkout', async () => {
    const me = voter(1)

    const started = await checkout(me)
    expect(started.res.status).toBe(200)
    expect(started.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)

    // Starting checkout isn't paying.
    expect((await createPoll(privatePoll, me)).res.status).toBe(403)

    const session = payFakeSession(lastSessionId())
    const delivered = await stripeWebhook(stripeEvent('checkout.session.completed', session))
    expect(delivered.res.status).toBe(200)
    expect((await getAccount(me)).body.plan).toBe('pro')

    const created = await createPoll(privatePoll, me)
    expect(created.res.status).toBe(201)
    expect(created.body.poll).toMatchObject({ visibility: 'private', status: 'open', mine: true })
    expect((await getPoll(created.body.id, me)).body.poll.visibility).toBe('private')
    expect(await privatePollCount()).toBe(1)

    // Private polls never reach the public feed.
    expect(await feedIds(voter(2))).toEqual([])
  })
})

describe('EC2: export of a closed poll returns a CSV whose row count equals the vote count', () => {
  it('has one data row per vote for a poll closed at its target', async () => {
    const me = voter(1)
    await makePro(me)
    const { body } = await createPoll({ ...basicPoll, target: 3 }, me)
    expect((await vote(body.id, 0, voter(11))).res.status).toBe(201)
    expect((await vote(body.id, 1, voter(12))).res.status).toBe(201)
    expect((await vote(body.id, 1, voter(13))).res.status).toBe(201)

    const poll = (await getPoll(body.id, me)).body.poll
    expect(poll).toMatchObject({ status: 'closed', voteCount: 3, winner: 1 })

    const { res, text } = await exportCsv(body.id, me)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    const rows = csvDataRows(text)
    expect(rows).toHaveLength(poll.voteCount)
    expect(rows.map((row) => row[2]).sort()).toEqual(['A', 'B', 'B'])
  })

  it('has 1 row for a poll closed by its deadline with 1 vote, and 0 for a no_result poll', async () => {
    const me = voter(1)
    await makePro(me)
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-10-12T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const oneVote = (await createPoll(basicPoll, me)).body.id
    const noVotes = (await createPoll(basicPoll, me)).body.id
    expect((await vote(oneVote, 1, voter(11))).res.status).toBe(201)

    vi.setSystemTime(t0 + 24 * HOUR + 1000)
    const closed = await exportCsv(oneVote, me)
    expect(closed.res.status).toBe(200)
    expect(csvDataRows(closed.text)).toHaveLength(1)
    expect((await getPoll(oneVote, me)).body.poll).toMatchObject({ status: 'closed', voteCount: 1 })

    const empty = await exportCsv(noVotes, me)
    expect(empty.res.status).toBe(200)
    expect(csvDataRows(empty.text)).toHaveLength(0)
    expect((await getPoll(noVotes, me)).body.poll).toMatchObject({ status: 'no_result', voteCount: 0 })
  })
})
