// Pro through a Stripe Payment Link (set up by ~/ai-stack/bin/provision stripe): the app holds no
// Stripe API key, only the link and the webhook signing secret.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as accountRoute } from '@/app/account/route'
import { POST as checkoutRoute } from '@/app/checkout/route'
import { getProPrice } from '@/lib/stripe'
import { FAKE_STRIPE, ORIGIN, accountIdOf, newStranger, stripeEvent, stripeWebhook, useTestDb } from './helpers'

useTestDb()

const LINK = 'https://buy.stripe.com/test_abc123'
const fetchSpy = vi.fn(async () => {
  throw new Error('the app must not call Stripe in payment-link mode')
})

beforeEach(() => {
  vi.stubEnv('STRIPE_PAYMENT_LINK', LINK)
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', FAKE_STRIPE.webhookSecret)
  vi.stubEnv('STRIPE_SECRET_KEY', '')
  vi.stubEnv('STRIPE_PRICE_ID', '')
  vi.stubEnv('STRIPE_PRICE_LABEL', '$9')
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fetchSpy.mockClear()
})

const post = (headers: Record<string, string>) =>
  checkoutRoute(new Request(`${ORIGIN}/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' }))

const linkSession = (accountId: string, overrides: Record<string, unknown> = {}) => ({
  id: 'cs_test_link_1',
  object: 'checkout.session',
  payment_link: 'plink_123',
  client_reference_id: accountId,
  payment_status: 'paid',
  amount_total: 900,
  currency: 'usd',
  customer_details: { email: 'buyer@example.com' },
  metadata: { repo: 'tiebreak', provisioned_by: 'provision' }, // copied from the Payment Link
  ...overrides,
})

describe('payment-link mode', () => {
  it('checkout sends the buyer to the link with their account as client_reference_id, without calling Stripe', async () => {
    const cookie = newStranger()
    const res = await post({ cookie })
    expect(res.status).toBe(200)
    const url = new URL((await res.json()).url)
    expect(`${url.origin}${url.pathname}`).toBe(LINK)
    expect(url.searchParams.get('client_reference_id')).toBe(accountIdOf(cookie))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("the native app's header account is the one that pays", async () => {
    const id = '00000000-0000-4000-8000-00000000c0de'
    const url = new URL((await (await post({ 'x-tiebreak-voter': id })).json()).url)
    expect(url.searchParams.get('client_reference_id')).toBe(id)
  })

  it("the signed webhook for the link's session grants Pro to that account", async () => {
    const cookie = newStranger()
    const { res } = await stripeWebhook(stripeEvent('checkout.session.completed', linkSession(accountIdOf(cookie))))
    expect(res.status).toBe(200)
    const me = await (await accountRoute(new Request(`${ORIGIN}/account`, { headers: { cookie } }))).json()
    expect(me.plan).toBe('pro')
  })

  it("another app's payment on the same Stripe account is ignored", async () => {
    const cookie = newStranger()
    await stripeWebhook(stripeEvent('checkout.session.completed', linkSession(accountIdOf(cookie), { metadata: { repo: 'grantgate' } })))
    const me = await (await accountRoute(new Request(`${ORIGIN}/account`, { headers: { cookie } }))).json()
    expect(me.plan).toBe('free')
  })

  it('the price shown comes from the label provision sets', async () => {
    expect(await getProPrice()).toBe('$9')
  })

  it('a link that is not https is ignored (payments stay unconfigured)', async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', 'http://buy.stripe.com/x')
    expect((await post({ cookie: newStranger() })).status).toBe(503)
  })
})
