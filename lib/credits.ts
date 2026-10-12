// "Vote 5, post 1": posting credits for public polls.
// Nothing is stored: credits are derived from the votes and polls tables, so
// they can't drift from what actually happened.
import { getDb, type Sql } from './db'
import { VOTES_PER_CREDIT } from './limits'

export interface AccountView {
  /** Public polls this account can post now. */
  credits: number
  /** Votes cast on other people's polls (votes on your own polls don't count). */
  countedVotes: number
  /** Public polls posted so far, i.e. credits spent. */
  publicPolls: number
  /** Votes still needed for the next credit. */
  votesToNextCredit: number
}

// Namespace for per-account advisory locks. Two-key locks never collide with
// the one-key schema lock in db.ts.
const CREDIT_LOCK_NAMESPACE = 7_204_312

export function creditsFrom(countedVotes: number, publicPolls: number): AccountView {
  const earned = Math.floor(countedVotes / VOTES_PER_CREDIT)
  return {
    credits: Math.max(0, earned - publicPolls),
    countedVotes,
    publicPolls,
    votesToNextCredit: VOTES_PER_CREDIT - (countedVotes % VOTES_PER_CREDIT),
  }
}

export async function accountOf(sql: Sql, accountId: string | null): Promise<AccountView> {
  if (!accountId) return creditsFrom(0, 0)
  const { rows } = await sql.query<{ counted_votes: number; public_polls: number }>(
    `SELECT
       (SELECT count(*)::int FROM votes v JOIN polls p ON p.id = v.poll_id
         WHERE v.voter_id = $1 AND p.creator_id IS DISTINCT FROM $1) AS counted_votes,
       (SELECT count(*)::int FROM polls
         WHERE creator_id = $1 AND visibility = 'public') AS public_polls`,
    [accountId],
  )
  return creditsFrom(rows[0].counted_votes, rows[0].public_polls)
}

/** The credits of an account (all zero for a visitor without one). */
export async function getAccount(accountId: string | null): Promise<AccountView> {
  return accountOf(await getDb(), accountId)
}

/**
 * Serialises credit spending for one account until the transaction ends.
 * Every path that spends a credit must take this lock before counting.
 */
export async function lockAccount(tx: Sql, accountId: string) {
  await tx.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [CREDIT_LOCK_NAMESPACE, accountId])
}
