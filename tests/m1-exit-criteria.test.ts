// One test (or more) per ROADMAP.md M1 exit criterion.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOUR, ORIGIN, basicPoll, createPoll, getPoll, useTestDb, vote, voter } from './helpers'

useTestDb()

const T0 = new Date('2026-10-12T12:00:00.000Z')

function freezeClock(at: Date | number) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('EC1: POST /polls with 2 options, target 3 and a 24h limit', () => {
  it('returns an id and a share URL', async () => {
    freezeClock(T0)
    const { res, body } = await createPoll(basicPoll)

    expect(res.status).toBe(201)
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(body.shareUrl).toBe(`${ORIGIN}/p/${body.id}`)
    expect(body.poll).toMatchObject({
      id: body.id,
      status: 'open',
      target: 3,
      voteCount: 0,
      winner: null,
      options: [
        { text: 'Red mug', imageUrl: null },
        { text: 'Blue mug', imageUrl: null },
      ],
    })
    expect(body.poll.closesAt).toBe(new Date(T0.getTime() + 24 * HOUR).toISOString())

    const fetched = await getPoll(body.id)
    expect(fetched.res.status).toBe(200)
    expect(fetched.body.poll.status).toBe('open')
  })
})

describe('EC2: three different voters close the poll with the majority winner', () => {
  it('closes at the target with the majority option as winner', async () => {
    const { body: created } = await createPoll(basicPoll)
    const id = created.id

    expect((await vote(id, 1, voter(1))).res.status).toBe(201)
    expect((await vote(id, 0, voter(2))).res.status).toBe(201)
    const third = await vote(id, 1, voter(3))

    expect(third.res.status).toBe(201)
    expect(third.body.poll).toMatchObject({ status: 'closed', winner: 1, voteCount: 3, tally: [1, 2] })

    const { body } = await getPoll(id)
    expect(body.poll).toMatchObject({ status: 'closed', winner: 1, voteCount: 3, tally: [1, 2] })
    expect(body.poll.closedAt).not.toBeNull()
  })
})

describe('EC3: a second vote from the same voter', () => {
  it('returns 409 and leaves the count unchanged', async () => {
    const { body: created } = await createPoll(basicPoll)
    const id = created.id

    expect((await vote(id, 0, voter(7))).res.status).toBe(201)
    const before = (await getPoll(id)).body.poll.voteCount

    const same = await vote(id, 0, voter(7))
    expect(same.res.status).toBe(409)
    const switched = await vote(id, 1, voter(7))
    expect(switched.res.status).toBe(409)

    const after = (await getPoll(id)).body.poll
    expect(before).toBe(1)
    expect(after.voteCount).toBe(1)
    expect(after.status).toBe('open')
  })
})

describe('EC4: deadline close', () => {
  it('a poll past its deadline with 1 vote closes with that vote as winner', async () => {
    freezeClock(T0)
    const { body: created } = await createPoll(basicPoll)
    expect((await vote(created.id, 1, voter(1))).res.status).toBe(201)

    vi.setSystemTime(T0.getTime() + 24 * HOUR + 1000)
    const { res, body } = await getPoll(created.id)

    expect(res.status).toBe(200)
    expect(body.poll).toMatchObject({ status: 'closed', winner: 1, voteCount: 1, tally: [0, 1] })
  })

  it('a poll past its deadline with zero votes closes as no_result', async () => {
    freezeClock(T0)
    const { body: created } = await createPoll(basicPoll)

    vi.setSystemTime(T0.getTime() + 24 * HOUR + 1000)
    const { body } = await getPoll(created.id)

    expect(body.poll).toMatchObject({ status: 'no_result', winner: null, voteCount: 0, tally: [0, 0] })
  })

  it('stays open until the deadline itself', async () => {
    freezeClock(T0)
    const { body: created } = await createPoll(basicPoll)

    vi.setSystemTime(T0.getTime() + 24 * HOUR - 1000)
    expect((await getPoll(created.id)).body.poll.status).toBe('open')

    vi.setSystemTime(T0.getTime() + 24 * HOUR)
    expect((await getPoll(created.id)).body.poll.status).toBe('no_result')
  })
})

describe('EC5: a vote on a closed poll returns 410', () => {
  it('when the poll closed by reaching its target', async () => {
    const { body: created } = await createPoll(basicPoll)
    for (const n of [1, 2, 3]) await vote(created.id, 0, voter(n))

    const late = await vote(created.id, 1, voter(4))
    expect(late.res.status).toBe(410)
    expect((await getPoll(created.id)).body.poll).toMatchObject({ voteCount: 3, winner: 0 })
  })

  it('when the deadline passed (closed on the vote itself, nobody read it first)', async () => {
    freezeClock(T0)
    const { body: created } = await createPoll(basicPoll)
    await vote(created.id, 0, voter(1))

    vi.setSystemTime(T0.getTime() + 25 * HOUR)
    const late = await vote(created.id, 1, voter(2))
    expect(late.res.status).toBe(410)

    const { body } = await getPoll(created.id)
    expect(body.poll).toMatchObject({ status: 'closed', winner: 0, voteCount: 1 })
  })

  it('when the poll closed as no_result', async () => {
    freezeClock(T0)
    const { body: created } = await createPoll(basicPoll)
    vi.setSystemTime(T0.getTime() + 25 * HOUR)
    expect((await getPoll(created.id)).body.poll.status).toBe('no_result')

    expect((await vote(created.id, 0, voter(1))).res.status).toBe(410)
  })

  it('also for a voter who already voted (closed wins over duplicate)', async () => {
    const { body: created } = await createPoll(basicPoll)
    for (const n of [1, 2, 3]) await vote(created.id, 0, voter(n))

    expect((await vote(created.id, 0, voter(1))).res.status).toBe(410)
  })
})
