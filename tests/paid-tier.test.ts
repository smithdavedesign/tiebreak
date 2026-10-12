// M3 edge cases: Stripe Checkout, the webhook, private polls and CSV export.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmCheckout } from '@/lib/plans'
import {
  BOM,
  FAKE_STRIPE,
  HOUR,
  ORIGIN,
  accountIdOf,
  basicPoll,
  checkout,
  createPoll,
  csvDataRows,
  earnCredits,
  exportCsv,
  feedIds,
  getAccount,
  getPoll,
  lastSessionId,
  makePro,
  payFakeSession,
  postPublicPoll,
  signStripe,
  stripeEvent,
  stripeWebhook,
  useFakeStripe,
  useTestDb,
  vote,
  voter,
} from './helpers'

const db = useTestDb()
const stripe = useFakeStripe()

afterEach(() => {
  vi.useRealTimers()
})

const privatePoll = { ...basicPoll, visibility: 'private' }

async function payments() {
  const { rows } = await db().query<Record<string, unknown>>('SELECT * FROM payments ORDER BY paid_at')
  return rows
}

/** A Checkout Session for `cookie` that Stripe reports as paid (not yet delivered to the app). */
async function paidSession(cookie: string, overrides: Record<string, unknown> = {}) {
  expect((await checkout(cookie)).res.status).toBe(200)
  return payFakeSession(lastSessionId(), overrides)
}

describe('POST /checkout', () => {
  it('rejects a non-JSON body with 415 and never calls Stripe', async () => {
    const { res } = await checkout(voter(1), { headers: { 'content-type': 'text/plain', cookie: voter(1) } })
    expect(res.status).toBe(415)
    expect(stripe().calls).toHaveLength(0)
  })

  it('starts a Stripe Checkout Session for the caller and returns its URL', async () => {
    const me = voter(1)
    const { res, body } = await checkout(me)
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()

    const [call] = stripe().calls
    expect(stripe().calls).toHaveLength(1)
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/v1/checkout/sessions')
    expect(call.authorization).toBe(`Bearer ${FAKE_STRIPE.secretKey}`)
    expect(Object.fromEntries(call.form)).toEqual({
      mode: 'payment',
      'line_items[0][price]': FAKE_STRIPE.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: accountIdOf(me),
      'metadata[app]': 'tiebreak',
      success_url: `${ORIGIN}/pro?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ORIGIN}/pro`,
    })
    expect(body).toEqual({ url: `https://checkout.stripe.com/c/pay/${lastSessionId()}` })
  })

  it('mints the account cookie for a new visitor and pays for that account', async () => {
    const { res } = await checkout()
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^tb_voter=[0-9a-f-]{36};/)
    const minted = setCookie.split(';')[0]
    expect(stripe().calls[0].form.get('client_reference_id')).toBe(accountIdOf(minted))
  })

  it('returns 409 for an account that already has Pro, without calling Stripe', async () => {
    const me = voter(1)
    await makePro(me)
    const before = stripe().calls.length
    const { res, body } = await checkout(me)
    expect(res.status).toBe(409)
    expect(body.error).toMatch(/already/i)
    expect(stripe().calls).toHaveLength(before)
  })

  it.each([['STRIPE_SECRET_KEY'], ['STRIPE_PRICE_ID']])('returns 503 when %s is not set', async (name) => {
    vi.stubEnv(name, '')
    const { res, body } = await checkout(voter(1))
    expect(res.status).toBe(503)
    expect(body.error).toMatch(/not set up/i)
    expect(stripe().calls).toHaveLength(0)
  })

  it('returns 502 when Stripe answers with an error', async () => {
    stripe().failWith = 400
    const { res, body } = await checkout(voter(1))
    expect(res.status).toBe(502)
    expect(body.error).toMatch(/try again/i)
  })

  it('returns 502 when Stripe is unreachable', async () => {
    stripe().failWith = 'network'
    expect((await checkout(voter(1))).res.status).toBe(502)
  })
})

describe('POST /stripe/webhook', () => {
  it('records a completed checkout and makes the account Pro', async () => {
    const me = voter(1)
    const session = await paidSession(me)
    const { res, body } = await stripeWebhook(stripeEvent('checkout.session.completed', session))
    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
    expect((await getAccount(me)).body.plan).toBe('pro')

    const [payment] = await payments()
    expect(payment).toMatchObject({
      session_id: session.id,
      account_id: accountIdOf(me),
      email: 'buyer@example.com',
      amount_total: 900,
      currency: 'usd',
    })
  })

  it('is idempotent: a redelivered event records one payment', async () => {
    const session = await paidSession(voter(1))
    const event = stripeEvent('checkout.session.completed', session)
    expect((await stripeWebhook(event)).res.status).toBe(200)
    expect((await stripeWebhook(event)).res.status).toBe(200)
    expect(await payments()).toHaveLength(1)
  })

  it('records one payment when the webhook and the return page fulfil at the same time', async () => {
    const me = voter(1)
    const session = await paidSession(me)
    const [delivered, confirmed] = await Promise.all([
      stripeWebhook(stripeEvent('checkout.session.completed', session)),
      confirmCheckout(session.id),
    ])
    expect(delivered.res.status).toBe(200)
    expect(confirmed).toBe(true)
    expect(await payments()).toHaveLength(1)
    expect((await getAccount(me)).body.plan).toBe('pro')
  })

  describe('rejects a request Stripe did not sign (400, nothing recorded)', () => {
    it.each([
      ['no signature header', () => null],
      ['a signature made with another secret', (body: string) => signStripe(body, { secret: 'not-the-secret' })],
      ['a signature more than 5 minutes old', (body: string) => signStripe(body, { at: Date.now() - 6 * 60_000 })],
      ['a timestamp more than 5 minutes ahead', (body: string) => signStripe(body, { at: Date.now() + 6 * 60_000 })],
      ['only a v0 signature', (body: string) => signStripe(body).replace('v1=', 'v0=')],
      ['a garbage header', () => 'nonsense'],
    ])('%s', async (_name, sign) => {
      const me = voter(1)
      const session = await paidSession(me)
      const body = JSON.stringify(stripeEvent('checkout.session.completed', session))
      const { res } = await stripeWebhook(null, { body, signature: sign(body) })
      expect(res.status).toBe(400)
      expect(await payments()).toHaveLength(0)
      expect((await getAccount(me)).body.plan).toBe('free')
    })

    it('a body changed after signing', async () => {
      const me = voter(1)
      const honest = await paidSession(voter(2))
      const signed = JSON.stringify(stripeEvent('checkout.session.completed', honest))
      const forged = signed.replace(accountIdOf(voter(2)), accountIdOf(me))
      const { res } = await stripeWebhook(null, { body: forged, signature: signStripe(signed) })
      expect(res.status).toBe(400)
      expect((await getAccount(me)).body.plan).toBe('free')
    })
  })

  it('accepts any matching v1 signature (Stripe sends two while a secret is rolled)', async () => {
    const session = await paidSession(voter(1))
    const body = JSON.stringify(stripeEvent('checkout.session.completed', session))
    const at = Date.now()
    // 'v1=<hex>' for one secret, all at the same timestamp.
    const v1 = (secret: string) => signStripe(body, { secret, at }).split(',')[1]
    const signature = `t=${Math.floor(at / 1000)},${v1('the-old-secret')},${v1(FAKE_STRIPE.webhookSecret)},v0=abc`
    expect((await stripeWebhook(null, { body, signature })).res.status).toBe(200)
    expect(await payments()).toHaveLength(1)
  })

  it('returns 503 while STRIPE_WEBHOOK_SECRET is not set, so Stripe retries later', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    const session = await paidSession(voter(1))
    const { res } = await stripeWebhook(stripeEvent('checkout.session.completed', session))
    expect(res.status).toBe(503)
    expect(await payments()).toHaveLength(0)
  })

  it('returns 400 for a signed body that is not JSON', async () => {
    const body = 'not json'
    expect((await stripeWebhook(null, { body, signature: signStripe(body) })).res.status).toBe(400)
  })

  it('waits for a delayed payment: unpaid completion is ignored, async success makes Pro', async () => {
    const me = voter(1)
    const session = await paidSession(me, { payment_status: 'unpaid' })
    expect((await stripeWebhook(stripeEvent('checkout.session.completed', session))).res.status).toBe(200)
    expect((await getAccount(me)).body.plan).toBe('free')

    payFakeSession(session.id)
    const succeeded = stripeEvent('checkout.session.async_payment_succeeded', session)
    expect((await stripeWebhook(succeeded)).res.status).toBe(200)
    expect((await getAccount(me)).body.plan).toBe('pro')
  })

  it('treats no_payment_required (a 100% discount) as paid', async () => {
    const me = voter(1)
    const session = await paidSession(me, { payment_status: 'no_payment_required', amount_total: 0 })
    await stripeWebhook(stripeEvent('checkout.session.completed', session))
    expect((await getAccount(me)).body.plan).toBe('pro')
  })

  it.each([
    ['another event type', (s: Record<string, unknown>) => stripeEvent('payment_intent.succeeded', s)],
    ['an expired session', (s: Record<string, unknown>) => stripeEvent('checkout.session.expired', s)],
    [
      "another product's checkout on the same Stripe account",
      (s: Record<string, unknown>) => stripeEvent('checkout.session.completed', { ...s, metadata: { app: 'other' } }),
    ],
    [
      'a session without metadata',
      (s: Record<string, unknown>) => stripeEvent('checkout.session.completed', { ...s, metadata: null }),
    ],
    [
      'a session whose reference is not an account id',
      (s: Record<string, unknown>) =>
        stripeEvent('checkout.session.completed', { ...s, client_reference_id: "x' OR 1=1 --" }),
    ],
    ['a malformed object', () => stripeEvent('checkout.session.completed', 'nope')],
    ['an event without data', () => ({ id: 'evt_x', type: 'checkout.session.completed' })],
  ])('acknowledges and ignores %s', async (_name, build) => {
    const me = voter(1)
    const session = await paidSession(me)
    const { res, body } = await stripeWebhook(build(session))
    expect(res.status).toBe(200)
    expect(body).toEqual({ received: true })
    expect(await payments()).toHaveLength(0)
    expect((await getAccount(me)).body.plan).toBe('free')
  })
})

describe('GET /account plan', () => {
  it('is free for visitors and new accounts and pro after paying; account is unchanged', async () => {
    expect((await getAccount()).body).toEqual({
      account: { credits: 0, countedVotes: 0, publicPolls: 0, votesToNextCredit: 5 },
      plan: 'free',
    })
    const me = voter(1)
    expect((await getAccount(me)).body.plan).toBe('free')
    await makePro(me)
    expect((await getAccount(me)).body).toEqual({
      account: { credits: 0, countedVotes: 0, publicPolls: 0, votesToNextCredit: 5 },
      plan: 'pro',
    })
    expect((await getAccount(voter(2))).body.plan).toBe('free')
  })
})

describe('private polls', () => {
  it('validates the poll before checking the plan (400, not 403)', async () => {
    const { res } = await createPoll({ ...privatePoll, options: ['only one'] }, voter(1))
    expect(res.status).toBe(400)
  })

  it('is case-sensitive about the visibility value', async () => {
    const { res, body } = await createPoll({ ...basicPoll, visibility: 'PRIVATE' }, voter(1))
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/unlisted, public, private/)
  })

  it('sets the account cookie on the 403 for a brand-new visitor', async () => {
    const { res } = await createPoll(privatePoll)
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toMatch(/^tb_voter=/)
  })

  it('costs Pro no posting credits, and Pro does not buy feed credits', async () => {
    const me = voter(1)
    await makePro(me)
    expect((await createPoll(privatePoll, me)).res.status).toBe(201)
    expect((await createPoll(privatePoll, me)).res.status).toBe(201)
    expect((await getAccount(me)).body.account).toMatchObject({ credits: 0, publicPolls: 0 })

    const publicRefused = await createPoll({ ...basicPoll, visibility: 'public' }, me)
    expect(publicRefused.res.status).toBe(403)
    expect(publicRefused.body.error).toMatch(/credit/)
    await earnCredits(me)
    expect((await createPoll({ ...basicPoll, visibility: 'public' }, me)).res.status).toBe(201)
  })

  it('shows the winner and the split to the creator only, even once closed', async () => {
    const me = voter(1)
    await makePro(me)
    const { body } = await createPoll({ ...privatePoll, target: 2 }, me)
    expect((await vote(body.id, 1, voter(2))).res.status).toBe(201)

    const closing = await vote(body.id, 1, voter(3))
    expect(closing.res.status).toBe(201)
    expect(closing.body.poll).toMatchObject({
      status: 'closed',
      visibility: 'private',
      mine: false,
      voteCount: 2,
      winner: null,
      tally: null,
      myVote: 1,
    })

    for (const viewer of [voter(2), undefined]) {
      expect((await getPoll(body.id, viewer)).body.poll).toMatchObject({ status: 'closed', winner: null, tally: null })
    }
    expect((await getPoll(body.id, me)).body.poll).toMatchObject({
      status: 'closed',
      mine: true,
      winner: 1,
      tally: [0, 2],
    })
  })

  it('never appears in the feed, but votes on it still earn credits', async () => {
    const me = voter(1)
    await makePro(me)
    const { body } = await createPoll(privatePoll, me)
    expect(await feedIds(voter(2))).toEqual([])
    expect(await feedIds()).toEqual([])
    const voted = await vote(body.id, 0, voter(2))
    expect(voted.body.account).toMatchObject({ countedVotes: 1 })
  })
})

describe('GET /polls/:id/export', () => {
  async function closedPoll(creator: string, poll: Record<string, unknown> = basicPoll) {
    const { body } = await createPoll({ ...poll, target: 1 }, creator)
    expect((await vote(body.id, 0, voter(99))).res.status).toBe(201)
    return body.id as string
  }

  it('returns 404 for unknown and malformed ids', async () => {
    const me = voter(1)
    await makePro(me)
    expect((await exportCsv('AAAAAAAAAAAA', me)).res.status).toBe(404)
    expect((await exportCsv('../../etc', me)).res.status).toBe(404)
  })

  it("returns 403 to anyone but the poll's creator, even with Pro", async () => {
    const id = await closedPoll(voter(1))
    const other = voter(2)
    await makePro(other)
    const { res, text } = await exportCsv(id, other)
    expect(res.status).toBe(403)
    expect(JSON.parse(text).error).toMatch(/creator/)
    expect((await exportCsv(id)).res.status).toBe(403)
  })

  it('returns 403 to a creator without Pro, pointing at Pro', async () => {
    const me = voter(1)
    const id = await closedPoll(me)
    const { res, text } = await exportCsv(id, me)
    expect(res.status).toBe(403)
    expect(JSON.parse(text).error).toMatch(/Pro/)
  })

  it('returns 409 while the poll is open, and exports once its deadline closes it', async () => {
    const me = voter(1)
    await makePro(me)
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-10-12T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const { body } = await createPoll({ ...basicPoll, durationHours: 1 }, me)
    await vote(body.id, 0, voter(2))

    const early = await exportCsv(body.id, me)
    expect(early.res.status).toBe(409)
    expect(JSON.parse(early.text).error).toMatch(/open/)

    vi.setSystemTime(t0 + HOUR)
    const late = await exportCsv(body.id, me)
    expect(late.res.status).toBe(200)
    expect(csvDataRows(late.text)).toHaveLength(1)
  })

  it('sends a downloadable, uncached CSV', async () => {
    const me = voter(1)
    await makePro(me)
    const id = await closedPoll(me)
    const { res } = await exportCsv(id, me)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="tiebreak-${id}.csv"`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('lists every vote in order with its time and option, and never the voter', async () => {
    const me = voter(1)
    await makePro(me)
    vi.useFakeTimers({ toFake: ['Date'] })
    const t0 = new Date('2026-10-12T12:00:00.000Z').getTime()
    vi.setSystemTime(t0)
    const { body } = await createPoll(
      {
        question: 'Cover?',
        options: [
          { text: 'Red, "matte"', imageUrl: 'https://img.example/red.jpg' },
          { text: '=HYPERLINK("https://evil.example")' },
          'Plain',
        ],
        target: 3,
        durationHours: 24,
      },
      me,
    )
    for (const [i, option] of [2, 0, 1].entries()) {
      vi.setSystemTime(t0 + (i + 1) * 60_000)
      expect((await vote(body.id, option, voter(20 + i))).res.status).toBe(201)
    }

    const { text } = await exportCsv(body.id, me)
    expect(text.split('\r\n')).toEqual([
      `${BOM}vote,voted_at,option,option_text,option_image_url`,
      '1,2026-10-12T12:01:00.000Z,C,Plain,',
      '2,2026-10-12T12:02:00.000Z,A,"Red, ""matte""",https://img.example/red.jpg',
      `3,2026-10-12T12:03:00.000Z,B,"'=HYPERLINK(""https://evil.example"")",`,
      '',
    ])
    for (const n of [20, 21, 22]) expect(text).not.toContain(accountIdOf(voter(n)))
  })

  it("exports any of a Pro creator's polls: unlisted, public, private, and ones made before paying", async () => {
    const me = voter(1)
    const before = await closedPoll(me)
    await makePro(me)
    const unlisted = await closedPoll(me)
    const privateId = await closedPoll(me, privatePoll)
    const publicId = await postPublicPoll(me, { target: 1 })
    expect((await vote(publicId, 1, voter(98))).res.status).toBe(201)

    for (const id of [before, unlisted, privateId, publicId]) {
      const { res, text } = await exportCsv(id, me)
      expect(res.status).toBe(200)
      expect(csvDataRows(text)).toHaveLength(1)
    }
  })
})
