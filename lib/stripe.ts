// Stripe over its REST API (no SDK): Checkout Sessions, the Pro price and
// webhook signatures. The only module that knows Stripe's URLs and the
// STRIPE_* environment variables; nothing here touches the database, and the
// secrets never leave the server.
import { createHmac, timingSafeEqual } from 'node:crypto'

const API = 'https://api.stripe.com/v1'

/** Tags this app's Checkout Sessions: the Stripe account may sell other products too. */
export const CHECKOUT_APP = 'tiebreak'

/** Stripe's documented default: how far a webhook's signed timestamp may be from now. */
const SIGNATURE_TOLERANCE_SECONDS = 300

const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{1,250}$/

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** STRIPE_SECRET_KEY and STRIPE_PRICE_ID, or null until both are set. */
function settings(): { secretKey: string; priceId: string } | null {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.STRIPE_PRICE_ID
  return secretKey && priceId ? { secretKey, priceId } : null
}

/** One Stripe API call. Null on any failure; only the HTTP status is logged. */
async function call(secretKey: string, path: string, form?: URLSearchParams): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: form ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${secretKey}`,
        ...(form && { 'content-type': 'application/x-www-form-urlencoded' }),
      },
      body: form?.toString(),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`Stripe API answered HTTP ${res.status}`)
      return null
    }
    const body: unknown = await res.json()
    return isRecord(body) ? body : null
  } catch {
    console.error('Stripe API unreachable')
    return null
  }
}

export type CheckoutStart = { kind: 'ok'; url: string } | { kind: 'unconfigured' | 'failed' }

/**
 * Starts a hosted Checkout for one Pro upgrade, paid by `accountId`. Stripe
 * sends the buyer back to /pro?session_id=…, which fulfils right away; the
 * webhook fulfils too, in case they never come back.
 */
export async function createCheckoutSession(accountId: string, origin: string): Promise<CheckoutStart> {
  const config = settings()
  if (!config) return { kind: 'unconfigured' }
  const session = await call(
    config.secretKey,
    '/checkout/sessions',
    new URLSearchParams({
      mode: 'payment',
      'line_items[0][price]': config.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: accountId,
      'metadata[app]': CHECKOUT_APP,
      // {CHECKOUT_SESSION_ID} is a literal Stripe fills in. Built as a string:
      // the URL class would percent-encode the braces.
      success_url: `${origin}/pro?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pro`,
    }),
  )
  return typeof session?.url === 'string' ? { kind: 'ok', url: session.url } : { kind: 'failed' }
}

/** Stripe's own copy of a Checkout Session, or null (not configured, not a session id, or a failed call). */
export async function retrieveCheckoutSession(id: string): Promise<Record<string, unknown> | null> {
  const config = settings()
  if (!config || !SESSION_ID_PATTERN.test(id)) return null
  return call(config.secretKey, `/checkout/sessions/${id}`)
}

/** An amount in the currency's smallest unit as a label, e.g. 900 usd → "$9.00", 500 jpy → "¥500". */
export function formatPrice(unitAmount: number, currency: string): string {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() })
  return format.format(unitAmount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
}

/** The Pro price as a label, read from Stripe so the page and Checkout agree; null if unknown. */
export async function getProPrice(): Promise<string | null> {
  const config = settings()
  if (!config) return null
  const price = await call(config.secretKey, `/prices/${encodeURIComponent(config.priceId)}`)
  if (typeof price?.unit_amount !== 'number' || typeof price.currency !== 'string') return null
  try {
    return formatPrice(price.unit_amount, price.currency)
  } catch {
    return null // a currency code Intl doesn't know
  }
}

/**
 * Checks a Stripe-Signature header the way Stripe documents it: HMAC-SHA256
 * of "{t}.{raw body}" with the endpoint secret, compared in constant time
 * against every v1 signature (other schemes are ignored, so no downgrade to
 * v0), with the timestamp within SIGNATURE_TOLERANCE_SECONDS of now.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!header || !secret) return false
  let timestamp = ''
  const signatures: Buffer[] = []
  for (const part of header.split(',')) {
    const [key, ...rest] = part.trim().split('=')
    const value = rest.join('=')
    if (key === 't') timestamp = value
    if (key === 'v1') signatures.push(Buffer.from(value))
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return false
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false

  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex'))
  return signatures.some((signature) => signature.length === expected.length && timingSafeEqual(signature, expected))
}

export type WebhookRead =
  | { kind: 'ok'; type: string | null; object: unknown }
  | { kind: 'unconfigured' }
  | { kind: 'invalid' }

/** Verifies and parses a webhook delivery. `payload` must be the raw, unparsed request body. */
export function readWebhook(payload: string, signature: string | null, nowMs = Date.now()): WebhookRead {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return { kind: 'unconfigured' }
  if (!verifyStripeSignature(payload, signature, secret, nowMs)) return { kind: 'invalid' }
  let event: unknown
  try {
    event = JSON.parse(payload)
  } catch {
    return { kind: 'invalid' }
  }
  if (!isRecord(event)) return { kind: 'invalid' }
  return {
    kind: 'ok',
    type: typeof event.type === 'string' ? event.type : null,
    object: isRecord(event.data) ? event.data.object : undefined,
  }
}
