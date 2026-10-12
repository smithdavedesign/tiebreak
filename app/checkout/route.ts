import { identify, jsonError, readJson, remember } from '@/lib/http'
import { getPlan } from '@/lib/plans'
import { createCheckoutSession } from '@/lib/stripe'

/**
 * POST /checkout {} → 200 { url } (Stripe Checkout; the page sends the browser there)
 *   | 409 (already Pro) | 415 | 502 (Stripe failed) | 503 (payments not set up)
 * The account comes from the cookie only (minted if missing, since the payment
 * attaches to it), and the body is JSON-only like every POST here.
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  if (!body.ok) return body.response

  const account = identify(request)
  if (!account.isNew && (await getPlan(account.id)) === 'pro') {
    return jsonError(409, 'This account already has Pro')
  }

  const started = await createCheckoutSession(account.id, new URL(request.url).origin)
  const response =
    started.kind === 'ok'
      ? Response.json({ url: started.url })
      : started.kind === 'unconfigured'
        ? jsonError(503, 'Payments are not set up yet. Try again later.')
        : jsonError(502, "Stripe didn't respond. Try again in a moment.")
  return remember(response, account, request)
}
