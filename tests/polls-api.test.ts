// Error paths, voter identity, ties, privacy of the tally and concurrency.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDb, setDb, fromPglite } from '@/lib/db'
import {
  HOUR,
  basicPoll,
  createPoll,
  getPoll,
  rawCreate,
  rawVote,
  useTestDb,
  vote,
  voter,
} from './helpers'

const db = useTestDb()

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /polls validation', () => {
  const longText = 'x'.repeat(81)
  const cases: [string, unknown][] = [
    ['body is not an object', ['a', 'b']],
    ['one option', { ...basicPoll, options: ['only'] }],
    ['five options', { ...basicPoll, options: ['a', 'b', 'c', 'd', 'e'] }],
    ['options missing', { ...basicPoll, options: undefined }],
    ['blank option text', { ...basicPoll, options: ['a', '   '] }],
    ['option text too long', { ...basicPoll, options: ['a', longText] }],
    ['option object with neither text nor image', { ...basicPoll, options: ['a', {}] }],
    ['option of the wrong type', { ...basicPoll, options: ['a', 42] }],
    ['http image URL', { ...basicPoll, options: ['a', { imageUrl: 'http://example.com/b.jpg' }] }],
    ['javascript image URL', { ...basicPoll, options: ['a', { imageUrl: 'javascript:alert(1)' }] }],
    ['malformed image URL', { ...basicPoll, options: ['a', { imageUrl: 'not a url' }] }],
    ['target 0', { ...basicPoll, target: 0 }],
    ['target 101', { ...basicPoll, target: 101 }],
    ['fractional target', { ...basicPoll, target: 2.5 }],
    ['string target', { ...basicPoll, target: '3' }],
    ['missing target', { ...basicPoll, target: undefined }],
    ['duration 0h', { ...basicPoll, durationHours: 0 }],
    ['duration over 7 days', { ...basicPoll, durationHours: 169 }],
    ['missing duration', { ...basicPoll, durationHours: undefined }],
    ['question too long', { ...basicPoll, question: 'q'.repeat(141) }],
    ['question of the wrong type', { ...basicPoll, question: 7 }],
  ]

  it.each(cases)('rejects %s with 400', async (_name, body) => {
    const { res, body: out } = await createPoll(body)
    expect(res.status).toBe(400)
    expect(typeof out.error).toBe('string')
  })

  it('rejects malformed JSON with 400', async () => {
    const res = await rawCreate({ headers: { 'content-type': 'application/json' }, body: '{"options":' })
    expect(res.status).toBe(400)
  })

  it('rejects a non-JSON content type with 415 (blocks cross-site form posts)', async () => {
    const res = await rawCreate({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'target=3',
    })
    expect(res.status).toBe(415)
  })

  it('accepts the edges: 4 options, image options, target 1 and 100, 1h and 168h', async () => {
    const imageOptions = {
      ...basicPoll,
      options: [
        'Plain text',
        { imageUrl: 'https://images.example.com/a.jpg' },
        { text: 'Captioned', imageUrl: 'https://images.example.com/b.jpg' },
        { text: '  trimmed  ' },
      ],
    }
    const { res, body } = await createPoll(imageOptions)
    expect(res.status).toBe(201)
    expect(body.poll.options).toEqual([
      { text: 'Plain text', imageUrl: null },
      { text: null, imageUrl: 'https://images.example.com/a.jpg' },
      { text: 'Captioned', imageUrl: 'https://images.example.com/b.jpg' },
      { text: 'trimmed', imageUrl: null },
    ])
    expect(body.poll.question).toBe('Which listing photo?')

    for (const edge of [
      { target: 1, durationHours: 1 },
      { target: 100, durationHours: 168 },
    ]) {
      expect((await createPoll({ ...basicPoll, ...edge })).res.status).toBe(201)
    }
  })

  it('defaults the question to an empty string', async () => {
    const { body } = await createPoll({ options: ['a', 'b'], target: 3, durationHours: 24 })
    expect(body.poll.question).toBe('')
  })

  it('gives every poll a different id', async () => {
    const a = await createPoll(basicPoll)
    const b = await createPoll(basicPoll)
    expect(a.body.id).not.toBe(b.body.id)
  })
})

describe('GET /polls/:id', () => {
  it('404s for an unknown id and for a malformed id', async () => {
    expect((await getPoll('AAAAAAAAAAAA')).res.status).toBe(404)
    expect((await getPoll('../../etc')).res.status).toBe(404)
  })

  it('hides the split while open and shows it once closed', async () => {
    const { body: created } = await createPoll({ ...basicPoll, target: 2 })
    await vote(created.id, 0, voter(1))

    const open = (await getPoll(created.id)).body.poll
    expect(open).toMatchObject({ status: 'open', voteCount: 1, tally: null, winner: null })

    await vote(created.id, 0, voter(2))
    const closed = (await getPoll(created.id)).body.poll
    expect(closed).toMatchObject({ status: 'closed', voteCount: 2, tally: [2, 0], winner: 0 })
  })

  it("reports the caller's own vote as myVote", async () => {
    const { body: created } = await createPoll(basicPoll)
    await vote(created.id, 1, voter(1))

    expect((await getPoll(created.id, voter(1))).body.poll.myVote).toBe(1)
    expect((await getPoll(created.id, voter(2))).body.poll.myVote).toBeNull()
    expect((await getPoll(created.id)).body.poll.myVote).toBeNull()
  })
})

describe('POST /polls/:id/votes', () => {
  it('404s for an unknown poll', async () => {
    expect((await vote('AAAAAAAAAAAA', 0, voter(1))).res.status).toBe(404)
    expect((await vote('bad id!', 0, voter(1))).res.status).toBe(404)
  })

  it.each([[-1], [2], [0.5], ['0'], [null]])('rejects option %j with 400', async (option) => {
    const { body: created } = await createPoll(basicPoll)
    const { res } = await vote(created.id, option, voter(1))
    expect(res.status).toBe(400)
    expect((await getPoll(created.id)).body.poll.voteCount).toBe(0)
  })

  it('rejects a non-JSON content type with 415 and malformed JSON with 400', async () => {
    const { body: created } = await createPoll(basicPoll)
    const form = await rawVote(created.id, {
      headers: { 'content-type': 'text/plain', cookie: voter(1) },
      body: '{"option":0}',
    })
    expect(form.status).toBe(415)
    const broken = await rawVote(created.id, {
      headers: { 'content-type': 'application/json', cookie: voter(1) },
      body: '{"option":',
    })
    expect(broken.status).toBe(400)
    expect((await getPoll(created.id)).body.poll.voteCount).toBe(0)
  })

  it('mints an httpOnly voter cookie when the voter has none, then honours it', async () => {
    const { body: created } = await createPoll(basicPoll)
    const first = await vote(created.id, 0)
    expect(first.res.status).toBe(201)

    const setCookie = first.res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^tb_voter=[0-9a-f-]{36};/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(first.body.poll.myVote).toBe(0)

    const cookie = setCookie.split(';')[0]
    expect((await vote(created.id, 1, cookie)).res.status).toBe(409)
  })

  it('does not set a cookie when the voter already has a valid one', async () => {
    const { body: created } = await createPoll(basicPoll)
    const { res } = await vote(created.id, 0, voter(1))
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('replaces a malformed voter cookie instead of trusting it', async () => {
    const { body: created } = await createPoll(basicPoll)
    const { res } = await vote(created.id, 0, "tb_voter=' OR 1=1 --")
    expect(res.status).toBe(201)
    expect(res.headers.get('set-cookie')).toMatch(/^tb_voter=[0-9a-f-]{36};/)
  })

  it('marks the cookie Secure on https', async () => {
    const { body: created } = await createPoll(basicPoll)
    const { POST } = await import('@/app/polls/[id]/votes/route')
    const res = await POST(
      new Request(`https://tiebreak.example/polls/${created.id}/votes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ option: 0 }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('set-cookie')).toMatch(/Secure/)
  })
})

describe('ties', () => {
  it('a tie at the target closes with no winner', async () => {
    const { body: created } = await createPoll({ ...basicPoll, target: 2 })
    await vote(created.id, 0, voter(1))
    const last = await vote(created.id, 1, voter(2))
    expect(last.body.poll).toMatchObject({ status: 'closed', winner: null, tally: [1, 1] })
  })

  it('a tie at the deadline closes with no winner', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-10-12T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const { body: created } = await createPoll({ ...basicPoll, options: ['a', 'b', 'c'], target: 10 })
    await vote(created.id, 2, voter(1))
    await vote(created.id, 0, voter(2))
    await vote(created.id, 2, voter(3))
    await vote(created.id, 0, voter(4))
    await vote(created.id, 1, voter(5))

    vi.setSystemTime(t0 + 25 * HOUR)
    const { body } = await getPoll(created.id)
    expect(body.poll).toMatchObject({ status: 'closed', winner: null, tally: [2, 1, 2], voteCount: 5 })
  })
})

describe('concurrency', () => {
  it('never accepts more votes than the target', async () => {
    const { body: created } = await createPoll(basicPoll)
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => vote(created.id, n % 2, voter(n))),
    )
    const statuses = results.map((r) => r.res.status).sort()
    expect(statuses).toEqual([201, 201, 201, 410, 410, 410])

    const { body } = await getPoll(created.id)
    expect(body.poll.voteCount).toBe(3)
    expect(body.poll.status).toBe('closed')
    const { rows } = await db().query<{ n: number }>('SELECT count(*)::int AS n FROM votes')
    expect(rows[0].n).toBe(3)
  })

  it('accepts one vote when the same voter double-submits', async () => {
    const { body: created } = await createPoll(basicPoll)
    const results = await Promise.all([vote(created.id, 0, voter(1)), vote(created.id, 1, voter(1))])
    expect(results.map((r) => r.res.status).sort()).toEqual([201, 409])
    expect((await getPoll(created.id)).body.poll.voteCount).toBe(1)
  })
})

describe('schema setup', () => {
  it('is idempotent when a second instance starts against the same database', async () => {
    const { body: created } = await createPoll(basicPoll)
    await vote(created.id, 0, voter(1))

    await setDb(fromPglite(db()))
    await getDb()

    expect((await getPoll(created.id)).body.poll.voteCount).toBe(1)
  })
})
