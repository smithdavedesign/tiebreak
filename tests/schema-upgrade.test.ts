// The first M2 deploy runs against a database M1 created: the schema step must
// upgrade it in place (no migration tool, nobody runs one after provisioning).
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromPglite, setDb, type Db } from '@/lib/db'
import { basicPoll, createPoll, feedIds, getAccount, getPoll, report, vote, voter } from './helpers'

// The tables exactly as M1 shipped them.
const M1_SCHEMA = [
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
]

const M1_POLL = 'm1pollAAAAAA'
let pg: PGlite

beforeAll(async () => {
  pg = await PGlite.create()
  for (const statement of M1_SCHEMA) await pg.query(statement)
  await pg.query(
    `INSERT INTO polls (id, question, options, target, closes_at, created_at)
     VALUES ($1, 'Old poll', '[{"text":"a","imageUrl":null},{"text":"b","imageUrl":null}]', 5,
             now() + interval '1 day', now())`,
    [M1_POLL],
  )
  await pg.query(
    `INSERT INTO votes (poll_id, voter_id, option_index, created_at) VALUES ($1, $2, 1, now())`,
    [M1_POLL, voter(1).split('=')[1]],
  )
  await setDb(fromPglite(pg))
})

afterAll(async () => {
  await pg.close()
})

describe('upgrading an M1 database', () => {
  it('keeps M1 polls as unlisted polls with no creator', async () => {
    const { res, body } = await getPoll(M1_POLL, voter(1))
    expect(res.status).toBe(200)
    expect(body.poll).toMatchObject({ visibility: 'unlisted', mine: false, voteCount: 1, myVote: 1 })
    expect(await feedIds()).toEqual([])
  })

  it('counts M1 votes toward credits', async () => {
    expect((await getAccount(voter(1))).body.account).toMatchObject({ countedVotes: 1, votesToNextCredit: 4 })
  })

  it('runs the M2 features on the upgraded tables', async () => {
    const me = voter(1)
    for (let i = 0; i < 4; i++) {
      const { body } = await createPoll(basicPoll, voter(100 + i))
      await vote(body.id, 0, me)
    }
    const posted = await createPoll({ ...basicPoll, visibility: 'public' }, me)
    expect(posted.res.status).toBe(201)
    expect(await feedIds(voter(2))).toEqual([posted.body.id])
    expect((await report(posted.body.id, voter(2))).res.status).toBe(201)
  })

  it('is idempotent when another instance starts against the upgraded database', async () => {
    await setDb(fromPglite(pg))
    expect((await getPoll(M1_POLL)).res.status).toBe(200)
  })

  it('skips the DDL (and its table locks) once the schema is current', async () => {
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
  })
})
