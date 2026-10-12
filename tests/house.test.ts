// House polls (lib/house.ts): the starter content that keeps the feed stocked.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { HOUSE_POLLS, houseHours, stockHouse } from '@/lib/house'
import { MAX_HOURS } from '@/lib/limits'
import { castVote, listFeed, parseNewPoll } from '@/lib/polls'
import { HOUR, postPublicPoll, useTestDb, voter } from './helpers'

useTestDb()

const idOf = (cookie: string) => cookie.split('=')[1]
const t0 = new Date('2026-10-12T12:00:00Z')

beforeEach(() => {
  process.env.HOUSE_POLLS = 'on'
})
afterEach(() => {
  process.env.HOUSE_POLLS = 'off'
})

describe('house polls', () => {
  it('every one is a valid public poll with a deadline within the limit', () => {
    expect(new Set(HOUSE_POLLS.map((p) => p.question)).size).toBe(HOUSE_POLLS.length)
    for (const [i, p] of HOUSE_POLLS.entries()) {
      const parsed = parseNewPoll({ ...p, target: 25, durationHours: houseHours(i), visibility: 'public' })
      expect(parsed.ok, p.question).toBe(true)
      expect(houseHours(i)).toBeLessThanOrEqual(MAX_HOURS)
    }
  })

  it('stocks an empty feed once, and topping up again posts nothing', async () => {
    const db = await getDb()
    expect(await stockHouse(db, t0, { force: true })).toBe(HOUSE_POLLS.length)
    expect(await stockHouse(db, t0, { force: true })).toBe(0)
    const feed = await listFeed(idOf(voter(1)), t0)
    expect(feed.length).toBeGreaterThan(0)
    expect(feed.every((p) => !p.mine && p.visibility === 'public')).toBe(true)
  })

  it("puts people's polls ahead of house polls", async () => {
    const mine = await postPublicPoll(voter(2), { durationHours: 168 })
    const db = await getDb()
    await stockHouse(db, new Date(), { force: true })
    const feed = await listFeed(idOf(voter(3)))
    expect(feed[0].id).toBe(mine)
  })

  it('reposts a closed question, but not to someone who voted on the old copy', async () => {
    const db = await getDb()
    await stockHouse(db, t0, { force: true })
    const me = idOf(voter(4))
    const first = (await listFeed(me, t0))[0]
    expect((await castVote(first.id, me, 0, t0)).kind).toBe('ok')

    const later = new Date(t0.getTime() + (MAX_HOURS + 1) * HOUR)
    expect(await stockHouse(db, later, { force: true })).toBe(HOUSE_POLLS.length)
    const questions = async (who: string) => {
      const seen: string[] = []
      for (const p of await listFeed(who, later)) seen.push(p.question)
      return seen
    }
    // The feed is one page; the voted question is hidden even if it would fit.
    expect(await questions(me)).not.toContain(first.question)
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM polls WHERE question = $1 AND closes_at > $2::timestamptz`,
      [first.question, later.toISOString()],
    )
    expect(rows[0].n).toBe(1)
  })
})
