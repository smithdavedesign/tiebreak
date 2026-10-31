// The only module that knows which Postgres we talk to:
// - DATABASE_URL set → node-postgres pool (Neon in production).
// - otherwise, outside production → PGlite, an in-process Postgres (local dev).
// Tests inject their own PGlite with setDb().
import type { PGlite } from '@electric-sql/pglite'

export type Row = Record<string, unknown>

export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export interface Db extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS polls (
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
  `CREATE TABLE IF NOT EXISTS votes (
    poll_id      text NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
    voter_id     text NOT NULL,
    option_index integer NOT NULL CHECK (option_index >= 0),
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (poll_id, voter_id)
  )`,
  // M2: public feed, credits and reports. ADD COLUMN IF NOT EXISTS upgrades an
  // M1 database in place; M1 polls become unlisted polls with no creator.
  `ALTER TABLE polls ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'unlisted'
     CONSTRAINT polls_visibility_check CHECK (visibility IN ('unlisted', 'public'))`,
  `ALTER TABLE polls ADD COLUMN IF NOT EXISTS creator_id text`,
  `CREATE TABLE IF NOT EXISTS reports (
    poll_id     text NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
    reporter_id text NOT NULL,
    created_at  timestamptz NOT NULL,
    PRIMARY KEY (poll_id, reporter_id)
  )`,
  `CREATE INDEX IF NOT EXISTS polls_feed_idx ON polls (closes_at)
     WHERE visibility = 'public' AND status = 'open'`,
  `CREATE INDEX IF NOT EXISTS polls_creator_idx ON polls (creator_id)`,
  `CREATE INDEX IF NOT EXISTS votes_voter_idx ON votes (voter_id)`,
  // M3: private polls and the paid tier. The check is swapped in one statement
  // (an M2 database has the two-value version), then one row per Stripe
  // Checkout Session: its primary key makes fulfilment idempotent.
  `ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_visibility_check,
     ADD CONSTRAINT polls_visibility_check CHECK (visibility IN ('unlisted', 'public', 'private'))`,
  `CREATE TABLE IF NOT EXISTS payments (
    session_id   text PRIMARY KEY,
    account_id   text NOT NULL,
    email        text,
    amount_total integer,
    currency     text,
    paid_at      timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS payments_account_idx ON payments (account_id)`,
  // Photo upload: photos uploaded as poll options, cleaned and stored here
  // (lib/images.ts). poll_id is set when a poll uses the photo, which is when it
  // starts being served; deleting the poll deletes it. Unused ones go after a day.
  // uploader_id is the uploading account, kept for abuse reports.
  `CREATE TABLE IF NOT EXISTS images (
    id           text PRIMARY KEY,
    content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    data         bytea NOT NULL,
    bytes        integer NOT NULL CHECK (bytes > 0),
    uploader_id  text NOT NULL,
    poll_id      text REFERENCES polls (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS images_poll_idx ON images (poll_id)`,
  `CREATE INDEX IF NOT EXISTS images_unused_idx ON images (created_at) WHERE poll_id IS NULL`,
]

// Created by the last SCHEMA statement. The DDL runs in one transaction, so if
// it exists the whole schema does. When you add DDL, put it last and point this
// at the object it creates (a table or index: to_regclass can't see constraints).
const SCHEMA_SENTINEL = 'images_unused_idx'

// Arbitrary constant: serialises DDL when several cold starts race.
const SCHEMA_LOCK_KEY = 7_204_311

async function ensureSchema(db: Db) {
  // A catalog read first: ALTER TABLE takes an exclusive lock on polls even
  // when every column exists, so an up-to-date database skips the DDL.
  const { rows } = await db.query<{ ready: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ready', [
    SCHEMA_SENTINEL,
  ])
  if (rows[0]?.ready) return
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_KEY])
    for (const statement of SCHEMA) await tx.query(statement)
  })
}

export function fromPglite(pg: PGlite): Db {
  return {
    query: <T>(text: string, params?: unknown[]) => pg.query<T>(text, params as unknown[]),
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({ query: <T>(text: string, params?: unknown[]) => tx.query<T>(text, params as unknown[]) }),
      ),
  }
}

/**
 * Cloudflare Workers (navigator.userAgent is set by the runtime; Node's is "Node.js/…"). There a socket
 * belongs to the request that opened it, so a pool shared across requests fails with "Cannot perform I/O
 * on behalf of a different request".
 */
export function onWorkers(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}

/** On Workers: one connection per query or transaction, closed when it's done (no pool to share). */
async function perRequestPg(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg')
  async function withClient<T>(fn: (client: InstanceType<typeof pg.Client>) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 })
    // pg-cloudflare's read loop reports "This socket has been closed" once end() closes it: expected then, so
    // it's dropped. Any other socket error is logged (a query's own failure still rejects that query).
    let ending = false
    client.on('error', (error: Error) => {
      if (!ending) console.error(`Postgres connection: ${error.message}`)
    })
    await client.connect()
    try {
      return await fn(client)
    } finally {
      ending = true
      await client.end().catch(() => {})
    }
  }
  const run =
    (client: InstanceType<typeof pg.Client>) =>
    async <T>(text: string, params?: unknown[]) =>
      (await client.query(text, params)) as unknown as { rows: T[] }
  return {
    query: <T>(text: string, params?: unknown[]) => withClient((client) => run(client)<T>(text, params)),
    transaction: (fn) =>
      withClient(async (client) => {
        await client.query('BEGIN')
        try {
          const result = await fn({ query: run(client) })
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {})
          throw error
        }
      }),
  }
}

async function fromPg(connectionString: string): Promise<Db> {
  if (onWorkers()) return perRequestPg(connectionString)
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  return {
    query: async <T>(text: string, params?: unknown[]) =>
      (await pool.query(text, params)) as unknown as { rows: T[] },
    async transaction(fn) {
      const client = await pool.connect()
      let broken: Error | undefined
      try {
        await client.query('BEGIN')
        const result = await fn({
          query: async <T>(text: string, params?: unknown[]) =>
            (await client.query(text, params)) as unknown as { rows: T[] },
        })
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: Error) => {
          broken = rollbackError
        })
        throw error
      } finally {
        // A connection whose ROLLBACK failed is discarded, not reused.
        client.release(broken)
      }
    },
  }
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL
  if (url) return fromPg(url)
  if (process.env.NODE_ENV !== 'production') {
    const { PGlite } = await import('@electric-sql/pglite')
    return fromPglite(await PGlite.create())
  }
  throw new Error('DATABASE_URL is not set: provision it with the credential broker (see BUILD.md)')
}

// Cached on globalThis: Next bundles route handlers and pages separately, and
// they must share one pool (or one in-memory dev database).
const holder = globalThis as typeof globalThis & { __tiebreakDb?: Promise<Db> }

function ready(db: Promise<Db>): Promise<Db> {
  const promise = db.then(async (d) => {
    await ensureSchema(d)
    return d
  })
  holder.__tiebreakDb = promise
  // A failed connect must not be cached forever: the next request retries.
  promise.catch(() => {
    if (holder.__tiebreakDb === promise) holder.__tiebreakDb = undefined
  })
  return promise
}

export function getDb(): Promise<Db> {
  return holder.__tiebreakDb ?? ready(open())
}

/** Use a specific database (tests). Resolves once its schema exists. */
export function setDb(db: Db): Promise<Db> {
  return ready(Promise.resolve(db))
}
