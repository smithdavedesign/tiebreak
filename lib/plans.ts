// The paid tier. An account is Pro once a Stripe payment is recorded for it.
// Nothing else is stored: the plan is derived from the payments table, and it
// only ever goes from free to pro (a refund is undone by deleting the row).
import { getDb, type Sql } from './db'
import { isVoterId } from './http'
import { CHECKOUT_APP, isRecord, retrieveCheckoutSession } from './stripe'

export type Plan = 'free' | 'pro'

// payment_status values that need no more money ('unpaid' means a delayed
// payment method hasn't settled yet; async_payment_succeeded follows).
const SETTLED = new Set(['paid', 'no_payment_required'])
const MAX_SESSION_ID_LENGTH = 255

export async function planOf(sql: Sql, accountId: string | null): Promise<Plan> {
  if (!accountId) return 'free'
  const { rows } = await sql.query<{ pro: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM payments WHERE account_id = $1) AS pro',
    [accountId],
  )
  return rows[0].pro ? 'pro' : 'free'
}

/** The plan of an account ('free' for a visitor without one). */
export async function getPlan(accountId: string | null): Promise<Plan> {
  return planOf(await getDb(), accountId)
}

/**
 * Records a Checkout Session's payment when it is this app's, for a valid
 * account, and settled. Called by the webhook and by the return page, so it
 * must be safe to run repeatedly and concurrently: the session id is the
 * primary key. Returns true when the session pays for Pro.
 */
export async function fulfilCheckout(session: unknown, now = new Date()): Promise<boolean> {
  if (!isRecord(session)) return false
  const { id, client_reference_id: accountId, payment_status: status, metadata } = session
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_SESSION_ID_LENGTH) return false
  if (!isRecord(metadata) || metadata.app !== CHECKOUT_APP) return false
  if (typeof accountId !== 'string' || !isVoterId(accountId)) return false
  if (typeof status !== 'string' || !SETTLED.has(status)) return false

  const details = isRecord(session.customer_details) ? session.customer_details : {}
  const db = await getDb()
  await db.query(
    `INSERT INTO payments (session_id, account_id, email, amount_total, currency, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     ON CONFLICT (session_id) DO NOTHING`,
    [
      id,
      accountId,
      typeof details.email === 'string' ? details.email : null,
      Number.isInteger(session.amount_total) ? session.amount_total : null,
      typeof session.currency === 'string' ? session.currency : null,
      now.toISOString(),
    ],
  )
  return true
}

/**
 * The Checkout return page (/pro?session_id=…): fulfils from Stripe's own copy
 * of the session, never from anything in the URL, so a made-up id grants nothing.
 */
export async function confirmCheckout(sessionId: string): Promise<boolean> {
  const session = await retrieveCheckoutSession(sessionId)
  return session ? fulfilCheckout(session) : false
}
