// The first M3 deploy runs against a database M2 created: the schema step must
// add `private` and the payments table in place (nobody runs migrations).
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromPglite, setDb, type Db } from '@/lib/db'
import { basicPoll, createPoll, feedIds, getAccount, getPoll, makePro, useFakeStripe, voter } from './helpers'

// The tables exactly as M2 left them.
const M2_SCHEMA = [
  `CREATE TABLE polls (
    id         text PRIMARY KEY,
    question   text NOT NULL DEFAULT '',
    options    jsonb NOT NULL,
    target     integer NOT NULL CHECK (target > 0),
    closes_at  timestamptz NOT NULL,
    status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'no_result')),
    winner     integer,
    created_at timestamptz NOT NULL,
    closed_at  timestamptz
  )`,
  `CREATE TABLE votes (
    poll_id      text NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
    voter_id     text NOT NULL,
    option_index integer NOT NULL CHECK (option_index >= 0),
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (poll_id, voter_id)
  )`,
  `ALTER TABLE polls ADD COLUMN visibility text NOT NULL DEFAULT 'unlisted'
     CONSTRAINT polls_visibility_check CHECK (visibility IN ('unlisted', 'public'))`,
  `ALTER TABLE polls ADD COLUMN creator_id text`,
  `CREATE TABLE reports (
    poll_id     text NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
    reporter_id text NOT NULL,
    created_at  timestamptz NOT NULL,
    PRIMARY KEY (poll_id, reporter_id)
  )`,
  `CREATE INDEX polls_feed_idx ON polls (closes_at) WHERE visibility = 'public' AND status = 'open'`,
  `CREATE INDEX polls_creator_idx ON polls (creator_id)`,
  `CREATE INDEX votes_voter_idx ON votes (voter_id)`,
]

const OPTIONS = '[{"text":"a","imageUrl":null},{"text":"b","imageUrl":null}]'
const M2_PUBLIC = 'm2publicAAAA'
const M2_UNLISTED = 'm2unlistedAA'
let pg: PGlite

useFakeStripe()

beforeAll(async () => {
  pg = await PGlite.create()
  for (const statement of M2_SCHEMA) await pg.query(statement)
  for (const [id, visibility] of [
    [M2_PUBLIC, 'public'],
    [M2_UNLISTED, 'unlisted'],
  ]) {
    await pg.query(
      `INSERT INTO polls (id, question, options, target, closes_at, created_at, visibility, creator_id)
       VALUES ($1, 'Old poll', $2::jsonb, 5, now() + interval '1 day', now(), $3, $4)`,
      [id, OPTIONS, visibility, voter(1).split('=')[1]],
    )
  }
  await setDb(fromPglite(pg))
})

afterAll(async () => {
  await pg.close()
})

describe('upgrading an M2 database', () => {
  it('keeps M2 polls as they were', async () => {
    expect((await getPoll(M2_PUBLIC, voter(1))).body.poll).toMatchObject({ visibility: 'public', mine: true })
    expect((await getPoll(M2_UNLISTED, voter(1))).body.poll).toMatchObject({ visibility: 'unlisted', mine: true })
    expect(await feedIds(voter(2))).toEqual([M2_PUBLIC])
    expect((await getAccount(voter(1))).body).toMatchObject({ account: { publicPolls: 1 }, plan: 'free' })
  })

  it('accepts private polls and payments afterwards', async () => {
    const me = voter(3)
    await makePro(me)
    const created = await createPoll({ ...basicPoll, visibility: 'private' }, me)
    expect(created.res.status).toBe(201)
    expect(created.body.poll.visibility).toBe('private')
  })

  it('still rejects unknown visibilities in the database itself', async () => {
    await expect(pg.query(`UPDATE polls SET visibility = 'secret' WHERE id = $1`, [M2_UNLISTED])).rejects.toThrow(
      /polls_visibility_check/,
    )
  })

  it('is a single catalog read for the next instance', async () => {
    const statements: string[] = []
    const inner = fromPglite(pg)
    const recording: Db = {
      query: (text, params) => {
        statements.push(text)
        return inner.query(text, params)
      },
      transaction: (fn) => {
        statements.push('BEGIN')
        return inner.transaction(fn)
      },
    }
    await setDb(recording)
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(/to_regclass/)
    await setDb(fromPglite(pg))
  })
})
