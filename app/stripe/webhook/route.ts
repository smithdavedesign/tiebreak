import { jsonError } from '@/lib/http'
import { fulfilCheckout } from '@/lib/plans'
import { readWebhook } from '@/lib/stripe'

// Checkout events that can complete a payment ('completed' may still be
// unpaid for delayed methods; fulfilCheckout checks payment_status).
const PAYMENT_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

/**
 * POST /stripe/webhook (called by Stripe) → 200 { received: true } | 400 (bad signature or body)
 *   | 503 (STRIPE_WEBHOOK_SECRET not set: Stripe keeps retrying until it is)
 * Events and sessions that aren't this app's payments are acknowledged and
 * ignored, so Stripe doesn't retry them.
 */
export async function POST(request: Request) {
  // The signature covers the exact bytes Stripe sent: read the raw body before anything parses it.
  const delivery = readWebhook(await request.text(), request.headers.get('stripe-signature'))
  if (delivery.kind === 'unconfigured') return jsonError(503, 'Stripe webhooks are not set up yet')
  if (delivery.kind === 'invalid') return jsonError(400, 'Invalid Stripe webhook')

  if (delivery.type !== null && PAYMENT_EVENTS.has(delivery.type)) await fulfilCheckout(delivery.object)
  return Response.json({ received: true })
}
