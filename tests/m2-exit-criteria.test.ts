// One test (or more) per ROADMAP.md M2 exit criterion.
import { describe, expect, it } from 'vitest'
import {
  basicPoll,
  createPoll,
  feedIds,
  getAccount,
  getPoll,
  newStranger,
  postPublicPoll,
  report,
  useTestDb,
  vote,
  voter,
} from './helpers'

const db = useTestDb()

const publicPoll = { ...basicPoll, visibility: 'public' }

async function pollCount() {
  const { rows } = await db().query<{ n: number }>('SELECT count(*)::int AS n FROM polls')
  return rows[0].n
}

describe('EC1: posting credits ("vote 5, post 1")', () => {
  it('a new account has 0 posting credits and cannot create a public poll', async () => {
    // A visitor with no cookie at all…
    const anonymous = await getAccount()
    expect(anonymous.res.status).toBe(200)
    expect(anonymous.body.account).toEqual({
      credits: 0,
      countedVotes: 0,
      publicPolls: 0,
      votesToNextCredit: 5,
    })

    // …and an account that has never done anything.
    const me = voter(100)
    expect((await getAccount(me)).body.account.credits).toBe(0)

    const refused = await createPoll(publicPoll, me)
    expect(refused.res.status).toBe(403)
    expect(refused.body.error).toMatch(/credit/i)
    expect(refused.body.account).toMatchObject({ credits: 0, votesToNextCredit: 5 })

    const refusedAnonymous = await createPoll(publicPoll)
    expect(refusedAnonymous.res.status).toBe(403)

    expect(await pollCount()).toBe(0)
    expect(await feedIds(voter(101))).toEqual([])
  })

  it('after 5 votes it has 1 credit, which posts exactly one public poll', async () => {
    const me = voter(100)
    const others: string[] = []
    for (let i = 0; i < 5; i++) others.push((await createPoll(basicPoll, newStranger())).body.id)

    for (const [i, id] of others.entries()) {
      expect((await vote(id, i % 2, me)).res.status).toBe(201)
      const { account } = (await getAccount(me)).body
      expect(account.credits).toBe(i < 4 ? 0 : 1)
      expect(account.countedVotes).toBe(i + 1)
    }
    expect((await getAccount(me)).body.account).toEqual({
      credits: 1,
      countedVotes: 5,
      publicPolls: 0,
      votesToNextCredit: 5,
    })

    const posted = await createPoll(publicPoll, me)
    expect(posted.res.status).toBe(201)
    expect(posted.body.poll).toMatchObject({ visibility: 'public', status: 'open', mine: true })
    expect(await feedIds(voter(300))).toEqual([posted.body.id])

    expect((await getAccount(me)).body.account).toMatchObject({ credits: 0, publicPolls: 1 })
    expect((await createPoll(publicPoll, me)).res.status).toBe(403)
    expect(await feedIds(voter(300))).toEqual([posted.body.id])
  })
})

describe('EC2: a poll with 3 reports is hidden from the feed', () => {
  it('stays listed with 2 reports and disappears at the 3rd', async () => {
    const id = await postPublicPoll(voter(1))
    const other = await postPublicPoll(voter(2))
    const viewer = voter(50)
    expect(await feedIds(viewer)).toEqual(expect.arrayContaining([id, other]))

    expect((await report(id, voter(11))).res.status).toBe(201)
    expect((await report(id, voter(12))).res.status).toBe(201)
    expect(await feedIds(viewer)).toContain(id)
    expect(await feedIds()).toContain(id)

    expect((await report(id, voter(13))).res.status).toBe(201)
    expect(await feedIds(viewer)).toEqual([other])
    expect(await feedIds()).toEqual([other])
    expect(await feedIds(voter(51))).toEqual([other])

    // Hidden from the feed only: the creator's share link still works.
    expect((await getPoll(id)).res.status).toBe(200)
    expect((await vote(id, 0, viewer)).res.status).toBe(201)
  })
})
