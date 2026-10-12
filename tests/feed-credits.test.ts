// M2 edge cases: credits, visibility, the feed's rules and reports.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOUR,
  basicPoll,
  createPoll,
  earnCredits,
  feed,
  feedIds,
  getAccount,
  getPoll,
  newStranger,
  postPublicPoll,
  rawReport,
  report,
  useTestDb,
  vote,
  voter,
} from './helpers'

const db = useTestDb()

afterEach(() => {
  vi.useRealTimers()
})

const publicPoll = { ...basicPoll, visibility: 'public' }

async function voteOnOthers(cookie: string, n: number) {
  for (let i = 0; i < n; i++) {
    const { body } = await createPoll(basicPoll, newStranger())
    expect((await vote(body.id, 0, cookie)).res.status).toBe(201)
  }
}

describe('credits', () => {
  it("votes on your own polls don't earn credits", async () => {
    const me = voter(1)
    for (let i = 0; i < 5; i++) {
      const { body } = await createPoll(basicPoll, me)
      expect((await vote(body.id, 0, me)).res.status).toBe(201)
    }
    expect((await getAccount(me)).body.account).toEqual({
      credits: 0,
      countedVotes: 0,
      publicPolls: 0,
      votesToNextCredit: 5,
    })
    expect((await createPoll(publicPoll, me)).res.status).toBe(403)
  })

  it('4 votes leave 1 to go; 10 votes give 2 credits; spending one leaves 1', async () => {
    const me = voter(1)
    await voteOnOthers(me, 4)
    expect((await getAccount(me)).body.account).toMatchObject({ credits: 0, votesToNextCredit: 1 })

    await voteOnOthers(me, 6)
    expect((await getAccount(me)).body.account).toEqual({
      credits: 2,
      countedVotes: 10,
      publicPolls: 0,
      votesToNextCredit: 5,
    })

    expect((await createPoll(publicPoll, me)).res.status).toBe(201)
    expect((await getAccount(me)).body.account).toMatchObject({ credits: 1, publicPolls: 1 })
    expect((await createPoll(publicPoll, me)).res.status).toBe(201)
    expect((await getAccount(me)).body.account).toMatchObject({ credits: 0, publicPolls: 2 })
    expect((await createPoll(publicPoll, me)).res.status).toBe(403)
  })

  it('votes on public polls count as well as votes on unlisted ones', async () => {
    const me = voter(1)
    const publicId = await postPublicPoll(voter(2))
    expect((await vote(publicId, 1, me)).res.status).toBe(201)
    await voteOnOthers(me, 4)
    expect((await getAccount(me)).body.account).toMatchObject({ credits: 1, countedVotes: 5 })
  })

  it('posting unlisted polls is free and never spends a credit', async () => {
    const me = voter(1)
    await earnCredits(me)
    for (let i = 0; i < 3; i++) expect((await createPoll(basicPoll, me)).res.status).toBe(201)
    expect((await getAccount(me)).body.account).toMatchObject({ credits: 1, publicPolls: 0 })
  })

  it('spends a single credit only once under concurrent posts', async () => {
    const me = voter(1)
    await earnCredits(me)
    const results = await Promise.all([1, 2, 3].map(() => createPoll(publicPoll, me)))
    expect(results.map((r) => r.res.status).sort()).toEqual([201, 403, 403])

    const { rows } = await db().query<{ n: number }>(
      "SELECT count(*)::int AS n FROM polls WHERE visibility = 'public'",
    )
    expect(rows[0].n).toBe(1)
    expect((await getAccount(me)).body.account.credits).toBe(0)
  })

  it('the vote response carries the voter account (counts on others’ polls only)', async () => {
    const me = voter(1)
    const theirs = (await createPoll(basicPoll, voter(2))).body.id
    const mine = (await createPoll(basicPoll, me)).body.id

    const counted = await vote(theirs, 0, me)
    expect(counted.res.status).toBe(201)
    expect(counted.body.account).toEqual({ credits: 0, countedVotes: 1, publicPolls: 0, votesToNextCredit: 4 })

    const own = await vote(mine, 0, me)
    expect(own.body.account).toMatchObject({ countedVotes: 1, votesToNextCredit: 4 })
  })
})

describe('GET /account', () => {
  it('never sets a cookie and is not cached', async () => {
    const anonymous = await getAccount()
    expect(anonymous.res.headers.get('set-cookie')).toBeNull()
    expect(anonymous.res.headers.get('cache-control')).toBe('no-store')
    expect((await getAccount(voter(1))).res.headers.get('set-cookie')).toBeNull()
  })

  it('treats a malformed cookie as a new account', async () => {
    const { res, body } = await getAccount("tb_voter=' OR 1=1 --")
    expect(res.status).toBe(200)
    expect(body.account.credits).toBe(0)
  })
})

describe('POST /polls visibility', () => {
  it('defaults to unlisted and is free for a brand-new account (M1 behaviour)', async () => {
    const { res, body } = await createPoll(basicPoll)
    expect(res.status).toBe(201)
    expect(body.poll).toMatchObject({ visibility: 'unlisted', mine: true })

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^tb_voter=[0-9a-f-]{36};/)
    const creator = setCookie.split(';')[0]
    expect((await getPoll(body.id, creator)).body.poll.mine).toBe(true)
    expect((await getPoll(body.id, voter(9))).body.poll.mine).toBe(false)
    expect((await getPoll(body.id)).body.poll.mine).toBe(false)
  })

  it('accepts an explicit unlisted value', async () => {
    const { res, body } = await createPoll({ ...basicPoll, visibility: 'unlisted' }, voter(1))
    expect(res.status).toBe(201)
    expect(body.poll.visibility).toBe('unlisted')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  // M3 made 'private' a real (Pro) visibility; see tests/m3-exit-criteria.test.ts.
  it.each([['Private'], ['PUBLIC'], [''], [null], [1], [true]])('rejects visibility %j with 400', async (value) => {
    const { res, body } = await createPoll({ ...basicPoll, visibility: value }, voter(1))
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/visibility/)
  })

  it('validates the poll before checking credits (400, not 403)', async () => {
    const { res } = await createPoll({ ...publicPoll, options: ['only one'] }, voter(1))
    expect(res.status).toBe(400)
  })

  it('never exposes who created a poll', async () => {
    const id = await postPublicPoll(voter(1))
    const everywhere = [
      JSON.stringify((await getPoll(id, voter(2))).body),
      JSON.stringify((await feed(voter(2))).body),
      JSON.stringify((await vote(id, 0, voter(2))).body),
    ]
    for (const json of everywhere) {
      expect(json).not.toMatch(/creator/i)
      expect(json).not.toContain('00000000-0000-4000-8000-000000000001')
    }
  })
})

describe('GET /polls (the public feed)', () => {
  it('lists open public polls only, with the tally hidden and no-store', async () => {
    const id = await postPublicPoll(voter(1))
    await createPoll(basicPoll, voter(2)) // unlisted: never in the feed
    await vote(id, 1, voter(3))

    const { res, body } = await feed(voter(4))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(body.polls).toHaveLength(1)
    expect(body.polls[0]).toMatchObject({
      id,
      visibility: 'public',
      status: 'open',
      voteCount: 1,
      tally: null,
      winner: null,
      myVote: null,
      mine: false,
      options: [
        { text: 'Red mug', imageUrl: null },
        { text: 'Blue mug', imageUrl: null },
      ],
    })
  })

  it("leaves out the viewer's own polls", async () => {
    const id = await postPublicPoll(voter(1))
    expect(await feedIds(voter(1))).toEqual([])
    expect(await feedIds(voter(2))).toEqual([id])
  })

  it('leaves out polls the viewer already voted on, for that viewer only', async () => {
    const id = await postPublicPoll(voter(1))
    await vote(id, 0, voter(2))
    expect(await feedIds(voter(2))).toEqual([])
    expect(await feedIds(voter(3))).toEqual([id])
  })

  it('leaves out polls the viewer reported, even below the hiding threshold', async () => {
    const id = await postPublicPoll(voter(1))
    await report(id, voter(2))
    expect(await feedIds(voter(2))).toEqual([])
    expect(await feedIds(voter(3))).toEqual([id])
  })

  it('leaves out polls that closed at their target', async () => {
    const id = await postPublicPoll(voter(1), { target: 1 })
    expect((await vote(id, 0, voter(2))).body.poll.status).toBe('closed')
    expect(await feedIds(voter(3))).toEqual([])
  })

  it('leaves out polls past their deadline even before anyone closed them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-10-12T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const id = await postPublicPoll(voter(1), { durationHours: 1 })
    expect(await feedIds(voter(2))).toEqual([id])

    vi.setSystemTime(t0 + HOUR)
    expect(await feedIds(voter(2))).toEqual([])
    const { rows } = await db().query<{ status: string }>('SELECT status FROM polls WHERE id = $1', [id])
    expect(rows[0].status).toBe('open') // the feed only filters; reads and votes close it
  })

  it('shows the soonest deadline first', async () => {
    const week = await postPublicPoll(voter(1), { durationHours: 168 })
    const hour = await postPublicPoll(voter(2), { durationHours: 1 })
    const day = await postPublicPoll(voter(3), { durationHours: 24 })
    expect(await feedIds(voter(4))).toEqual([hour, day, week])
  })

  it('returns at most 20 polls per request', async () => {
    // Seeded directly: earning 21 credits through the API would take 105 polls.
    for (let i = 0; i < 21; i++) {
      await db().query(
        `INSERT INTO polls (id, options, target, closes_at, created_at, visibility, creator_id)
         VALUES ($1, '[{"text":"a","imageUrl":null},{"text":"b","imageUrl":null}]', 3,
                 now() + make_interval(hours => $2), now(), 'public', $3)`,
        [`seedpoll${String(i).padStart(4, '0')}`, i + 1, `seed-${i}`],
      )
    }
    const ids = await feedIds(voter(1))
    expect(ids).toHaveLength(20)
    expect(ids[0]).toBe('seedpoll0000')
    expect(ids).not.toContain('seedpoll0020')
  })

  it('works for a visitor with no account', async () => {
    const id = await postPublicPoll(voter(1))
    const { res, body } = await feed()
    expect(res.status).toBe(200)
    expect(body.polls.map((p: { id: string }) => p.id)).toEqual([id])
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('POST /polls/:id/reports', () => {
  it('records a report, minting the account cookie when missing', async () => {
    const id = await postPublicPoll(voter(1))
    const first = await report(id)
    expect(first.res.status).toBe(201)
    expect(first.body).toEqual({ reported: true })

    const setCookie = first.res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^tb_voter=[0-9a-f-]{36};/)
    expect(setCookie).toMatch(/HttpOnly/i)
    const reporter = setCookie.split(';')[0]
    expect((await report(id, reporter)).res.status).toBe(409)
  })

  it('returns 409 for a repeat report and does not count it twice', async () => {
    const id = await postPublicPoll(voter(1))
    expect((await report(id, voter(2))).res.status).toBe(201)
    const again = await report(id, voter(2))
    expect(again.res.status).toBe(409)
    expect(typeof again.body.error).toBe('string')
    expect(again.res.headers.get('set-cookie')).toBeNull()

    // Two more distinct reporters are still needed to hide it.
    await report(id, voter(3))
    expect(await feedIds(voter(9))).toEqual([id])
    await report(id, voter(4))
    expect(await feedIds(voter(9))).toEqual([])
  })

  it('404s for an unknown or malformed poll id', async () => {
    expect((await report('AAAAAAAAAAAA', voter(1))).res.status).toBe(404)
    expect((await report('../../etc', voter(1))).res.status).toBe(404)
  })

  it('rejects a non-JSON body with 415 and malformed JSON with 400', async () => {
    const id = await postPublicPoll(voter(1))
    const form = await rawReport(id, { headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: voter(2) }, body: '' })
    expect(form.status).toBe(415)
    const broken = await rawReport(id, { headers: { 'content-type': 'application/json', cookie: voter(2) }, body: '{' })
    expect(broken.status).toBe(400)
    const { rows } = await db().query<{ n: number }>('SELECT count(*)::int AS n FROM reports')
    expect(rows[0].n).toBe(0)
  })

  it('accepts reports on unlisted and closed polls', async () => {
    const unlisted = (await createPoll(basicPoll, voter(1))).body.id
    expect((await report(unlisted, voter(2))).res.status).toBe(201)

    const closed = (await createPoll({ ...basicPoll, target: 1 }, voter(1))).body.id
    await vote(closed, 0, voter(3))
    expect((await report(closed, voter(2))).res.status).toBe(201)
  })

  it('keeps a hidden poll working at its link: readable, votable, closable', async () => {
    const id = await postPublicPoll(voter(1), { target: 2 })
    for (const n of [11, 12, 13]) await report(id, voter(n))
    expect(await feedIds(voter(2))).toEqual([])

    expect((await vote(id, 0, voter(2))).res.status).toBe(201)
    const last = await vote(id, 0, voter(3))
    expect(last.body.poll).toMatchObject({ status: 'closed', winner: 0 })
  })
})
