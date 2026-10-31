// On Cloudflare Workers a socket belongs to the request that opened it, so lib/db.ts gives each query and
// each transaction its own connection there, closed when it's done, instead of the pool it uses on Vercel.
// pg is faked: this checks which connections open and close, not Postgres itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const log: string[] = []
let clients = 0

vi.mock('pg', () => {
  class Client {
    id = ++clients
    async connect() {
      log.push(`connect ${this.id}`)
    }
    async query(text: string) {
      log.push(`${this.id}: ${text}`)
      if (text.startsWith('SELECT to_regclass')) return { rows: [{ ready: true }] }
      if (text === 'FAIL') throw new Error('query failed')
      return { rows: [{ ok: 1 }] }
    }
    on() {
      return this
    }
    async end() {
      log.push(`end ${this.id}`)
    }
  }
  class Pool {
    constructor() {
      throw new Error('no pool on Workers')
    }
  }
  return { default: { Client, Pool } }
})

const holder = globalThis as typeof globalThis & { __tiebreakDb?: unknown }

describe('the database on Cloudflare Workers', () => {
  beforeEach(() => {
    log.length = 0
    clients = 0
    delete holder.__tiebreakDb
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    vi.stubEnv('DATABASE_URL', 'postgres://user:pw@db.test/app')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete holder.__tiebreakDb
  })

  it('knows where it runs', async () => {
    const { onWorkers } = await import('@/lib/db')
    expect(onWorkers()).toBe(true)
    vi.stubGlobal('navigator', { userAgent: 'Node.js/26' })
    expect(onWorkers()).toBe(false)
  })

  it('opens and closes a connection for every query', async () => {
    const { getDb } = await import('@/lib/db')
    const db = await getDb()
    await db.query('SELECT 1')
    await db.query('SELECT 2')
    expect(log).toEqual([
      'connect 1',
      '1: SELECT to_regclass($1) IS NOT NULL AS ready',
      'end 1',
      'connect 2',
      '2: SELECT 1',
      'end 2',
      'connect 3',
      '3: SELECT 2',
      'end 3',
    ])
  })

  it('runs a transaction on one connection and closes it after COMMIT or ROLLBACK', async () => {
    const { getDb } = await import('@/lib/db')
    const db = await getDb()
    log.length = 0
    await db.transaction(async (tx) => {
      await tx.query('INSERT 1')
      await tx.query('INSERT 2')
    })
    expect(log).toEqual(['connect 2', '2: BEGIN', '2: INSERT 1', '2: INSERT 2', '2: COMMIT', 'end 2'])
    log.length = 0
    await expect(db.transaction((tx) => tx.query('FAIL'))).rejects.toThrow('query failed')
    expect(log).toEqual(['connect 3', '3: BEGIN', '3: FAIL', '3: ROLLBACK', 'end 3'])
  })
})
