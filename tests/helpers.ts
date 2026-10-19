// Shared test harness: an in-process Postgres (PGlite) behind the app's DB
// adapter, plus helpers that call the Next route handlers with Web Requests.
import { createHmac } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { fromPglite, setDb } from '@/lib/db'
import { GET as accountRoute } from '@/app/account/route'
import { POST as checkoutRoute } from '@/app/checkout/route'
import { POST as uploadRoute } from '@/app/images/route'
import { GET as imageRoute } from '@/app/images/[id]/route'
import { GET as feedRoute, POST as createPollRoute } from '@/app/polls/route'
import { GET as exportRoute } from '@/app/polls/[id]/export/route'
import { GET as getPollRoute } from '@/app/polls/[id]/route'
import { POST as reportRoute } from '@/app/polls/[id]/reports/route'
import { POST as voteRoute } from '@/app/polls/[id]/votes/route'
import { POST as stripeWebhookRoute } from '@/app/stripe/webhook/route'

export const ORIGIN = 'http://tiebreak.test'

let pg: PGlite

/** Gives the test file a fresh, empty database (schema created by the app). */
export function useTestDb() {
  beforeAll(async () => {
    pg = await PGlite.create()
    await setDb(fromPglite(pg))
  })
  beforeEach(async () => {
    await pg.query('TRUNCATE payments, reports, votes, images, polls')
  })
  afterAll(async () => {
    await pg.close()
  })
  return () => pg
}

/** A distinct anonymous voter, as the browser cookie would carry it. */
export function voter(n: number) {
  const hex = n.toString(16).padStart(12, '0')
  return `tb_voter=00000000-0000-4000-8000-${hex}`
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function jsonRequest(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return new Request(ORIGIN + path, { method: 'POST', headers, body: JSON.stringify(body) })
}

export async function createPoll(body: unknown, cookie?: string) {
  const res = await createPollRoute(jsonRequest('/polls', body, cookie))
  return { res, body: await res.json() }
}

function getRequest(path: string, cookie?: string) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  return new Request(ORIGIN + path, { headers })
}

/** GET /account: the caller's posting credits. */
export async function getAccount(cookie?: string) {
  const res = await accountRoute(getRequest('/account', cookie))
  return { res, body: await res.json() }
}

/** GET /polls: the public feed as the caller sees it. */
export async function feed(cookie?: string) {
  const res = await feedRoute(getRequest('/polls', cookie))
  return { res, body: await res.json() }
}

export async function feedIds(cookie?: string): Promise<string[]> {
  return (await feed(cookie)).body.polls.map((p: { id: string }) => p.id)
}

export async function report(id: string, cookie?: string) {
  const res = await reportRoute(jsonRequest(`/polls/${id}/reports`, {}, cookie), ctx(id))
  return { res, body: await res.json() }
}

export async function rawReport(id: string, init: RequestInit) {
  return reportRoute(new Request(`${ORIGIN}/polls/${id}/reports`, { method: 'POST', ...init }), ctx(id))
}

// Accounts the helpers below use as other people. Far from the small numbers tests use.
let stranger = 0x100000

/** A fresh account no test refers to directly. */
export function newStranger() {
  stranger += 1
  return voter(stranger)
}

/**
 * Earns `credits` posting credits for an account the honest way: 5 votes per
 * credit, each on a different unlisted poll created by someone else.
 */
export async function earnCredits(cookie: string, credits = 1) {
  for (let i = 0; i < credits * 5; i++) {
    const { body } = await createPoll(basicPoll, newStranger())
    const { res } = await vote(body.id, 0, cookie)
    if (res.status !== 201) throw new Error(`earnCredits: vote returned ${res.status}`)
  }
}

/** Earns one credit for `cookie` and spends it on a public poll. Returns the poll id. */
export async function postPublicPoll(cookie: string, overrides: Record<string, unknown> = {}) {
  await earnCredits(cookie)
  const { res, body } = await createPoll({ ...basicPoll, visibility: 'public', ...overrides }, cookie)
  if (res.status !== 201) throw new Error(`postPublicPoll: create returned ${res.status}`)
  return body.id as string
}

export async function getPoll(id: string, cookie?: string) {
  const res = await getPollRoute(getRequest(`/polls/${id}`, cookie), ctx(id))
  return { res, body: await res.json() }
}

export async function vote(id: string, option: unknown, cookie?: string) {
  const res = await voteRoute(jsonRequest(`/polls/${id}/votes`, { option }, cookie), ctx(id))
  return { res, body: await res.json() }
}

export async function rawVote(id: string, init: RequestInit) {
  return voteRoute(new Request(`${ORIGIN}/polls/${id}/votes`, { method: 'POST', ...init }), ctx(id))
}

export async function rawCreate(init: RequestInit) {
  return createPollRoute(new Request(`${ORIGIN}/polls`, { method: 'POST', ...init }))
}

// ── Photo upload ───────────────────────────────────────────────────────────

/** POST /images: uploads a photo's bytes as the browser sends a picked file. */
export async function uploadImage(bytes: Uint8Array | null, type: string | null, cookie?: string) {
  const headers: Record<string, string> = {}
  if (type !== null) headers['content-type'] = type
  if (cookie) headers.cookie = cookie
  const body = bytes === null ? null : new Uint8Array(bytes)
  const res = await uploadRoute(new Request(`${ORIGIN}/images`, { method: 'POST', headers, body }))
  return { res, body: await res.json() }
}

export async function rawUpload(init: RequestInit) {
  return uploadRoute(new Request(`${ORIGIN}/images`, { method: 'POST', ...init }))
}

/** GET /images/:id (or the path of a full image URL). */
export async function getImage(idOrUrl: string) {
  const id = idOrUrl.split('/').pop() ?? ''
  const res = await imageRoute(getRequest(`/images/${id}`), ctx(id))
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) }
}

/** The M1 exit-criteria poll: 2 options, target 3, 24h. */
export const basicPoll = {
  question: 'Which listing photo?',
  options: ['Red mug', 'Blue mug'],
  target: 3,
  durationHours: 24,
}

export const HOUR = 60 * 60 * 1000

// ── M3: the paid tier ──────────────────────────────────────────────────────

/** The account id inside a `tb_voter=…` cookie string. */
export const accountIdOf = (cookie: string) => cookie.split('=')[1]

/**
 * Fake Stripe settings. Built at runtime from a prefix and a filler so nothing
 * in the repo looks like a real key; tests never need real ones.
 */
const FILLER = 'A1b2C3d4'.repeat(4)
export const FAKE_STRIPE = {
  secretKey: ['sk', 'test', FILLER].join('_'),
  webhookSecret: ['whsec', FILLER].join('_'),
  priceId: ['price', 'Pro9x'].join('_'),
}

export type FakeSession = Record<string, unknown> & { id: string }

export interface FakeStripe {
  /** Every request the app sent to Stripe, in order. */
  calls: { method: string; path: string; form: URLSearchParams; authorization: string | null }[]
  /** Checkout Sessions as Stripe stores them, by id. */
  sessions: Map<string, FakeSession>
  /** When set, every Stripe call fails with this HTTP status, or with a network error. */
  failWith: number | 'network' | null
  price: { unit_amount: number; currency: string }
}

let fake: FakeStripe | null = null
let fakeCounter = 0

async function fakeStripeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const stripe = fake
  if (!stripe) throw new Error('useFakeStripe() is not active')
  const url = new URL(input instanceof Request ? input.url : input.toString())
  if (url.origin !== 'https://api.stripe.com') throw new Error(`unexpected fetch to ${url.origin}`)
  const method = init.method ?? 'GET'
  const form = new URLSearchParams(typeof init.body === 'string' ? init.body : '')
  stripe.calls.push({ method, path: url.pathname, form, authorization: new Headers(init.headers).get('authorization') })

  if (stripe.failWith === 'network') throw new TypeError('fetch failed')
  if (stripe.failWith) return Response.json({ error: { message: 'Stripe is unhappy' } }, { status: stripe.failWith })

  if (method === 'POST' && url.pathname === '/v1/checkout/sessions') {
    fakeCounter += 1
    const id = `cs_test_${fakeCounter}`
    const session: FakeSession = {
      id,
      object: 'checkout.session',
      url: `https://checkout.stripe.com/c/pay/${id}`,
      mode: form.get('mode'),
      client_reference_id: form.get('client_reference_id'),
      metadata: { app: form.get('metadata[app]') },
      status: 'open',
      payment_status: 'unpaid',
      amount_total: stripe.price.unit_amount,
      currency: stripe.price.currency,
      customer_details: null,
    }
    stripe.sessions.set(id, session)
    return Response.json(session)
  }
  const sessionPath = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/)
  if (method === 'GET' && sessionPath) {
    const session = stripe.sessions.get(decodeURIComponent(sessionPath[1]))
    return session
      ? Response.json(session)
      : Response.json({ error: { message: 'No such checkout.session' } }, { status: 404 })
  }
  if (method === 'GET' && url.pathname === `/v1/prices/${FAKE_STRIPE.priceId}`) {
    return Response.json({ id: FAKE_STRIPE.priceId, object: 'price', type: 'one_time', ...stripe.price })
  }
  return Response.json({ error: { message: 'Not faked' } }, { status: 404 })
}

/**
 * Stripe faked at the fetch boundary, with fake keys in the env, for every
 * test in the file. Returns the fake so tests can inspect calls or break it.
 */
export function useFakeStripe(): () => FakeStripe {
  beforeEach(() => {
    fake = {
      calls: [],
      sessions: new Map(),
      failWith: null,
      price: { unit_amount: 900, currency: 'usd' },
    }
    vi.stubEnv('STRIPE_SECRET_KEY', FAKE_STRIPE.secretKey)
    vi.stubEnv('STRIPE_PRICE_ID', FAKE_STRIPE.priceId)
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', FAKE_STRIPE.webhookSecret)
    vi.stubGlobal('fetch', vi.fn(fakeStripeFetch))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fake = null
  })
  return () => {
    if (!fake) throw new Error('useFakeStripe() is not active')
    return fake
  }
}

/** Marks a Checkout Session paid at the fake Stripe, as if the buyer just paid. */
export function payFakeSession(id: string, overrides: Record<string, unknown> = {}): FakeSession {
  const session = fake?.sessions.get(id)
  if (!session) throw new Error(`no fake session ${id}`)
  Object.assign(session, {
    status: 'complete',
    payment_status: 'paid',
    customer_details: { email: 'buyer@example.com' },
    ...overrides,
  })
  return session
}

/** The id of the newest Checkout Session the app created. */
export function lastSessionId(): string {
  const ids = [...(fake?.sessions.keys() ?? [])]
  if (ids.length === 0) throw new Error('no checkout session was created')
  return ids[ids.length - 1]
}

/** POST /checkout as the given account. */
export async function checkout(cookie?: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  const res = await checkoutRoute(new Request(`${ORIGIN}/checkout`, { method: 'POST', headers, body: '{}', ...init }))
  return { res, body: await res.json() }
}

/** A Stripe-Signature header for a payload, signed the way Stripe documents. */
export function signStripe(
  payload: string,
  { secret = FAKE_STRIPE.webhookSecret, at = Date.now() }: { secret?: string; at?: number } = {},
) {
  const t = Math.floor(at / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  return `t=${t},v1=${v1}`
}

let eventCounter = 0

/** A Stripe event wrapping an object (a Checkout Session for the events this app handles). */
export function stripeEvent(type: string, object: unknown) {
  eventCounter += 1
  return { id: `evt_test_${eventCounter}`, object: 'event', type, data: { object } }
}

/** POST /stripe/webhook. Signed correctly unless `signature` is given (null sends none). */
export async function stripeWebhook(event: unknown, { signature, body }: { signature?: string | null; body?: string } = {}) {
  const payload = body ?? JSON.stringify(event)
  const sig = signature === undefined ? signStripe(payload) : signature
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
  if (sig !== null) headers['stripe-signature'] = sig
  const res = await stripeWebhookRoute(new Request(`${ORIGIN}/stripe/webhook`, { method: 'POST', headers, body: payload }))
  return { res, body: await res.json() }
}

/** Upgrades an account the way a buyer does: Checkout, pay, then Stripe's webhook. */
export async function makePro(cookie: string) {
  const started = await checkout(cookie)
  if (started.res.status !== 200) throw new Error(`makePro: checkout returned ${started.res.status}`)
  const session = payFakeSession(lastSessionId())
  const { res } = await stripeWebhook(stripeEvent('checkout.session.completed', session))
  if (res.status !== 200) throw new Error(`makePro: webhook returned ${res.status}`)
}

/** GET /polls/:id/export as the given account. */
export async function exportCsv(id: string, cookie?: string) {
  const res = await exportRoute(getRequest(`/polls/${id}/export`, cookie), ctx(id))
  // Response.text() drops a leading BOM; decode the bytes as a spreadsheet would receive them.
  return { res, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()) }
}

/** The byte-order mark exports start with (so Excel reads them as UTF-8). */
export const BOM = String.fromCharCode(0xfeff)

/** The data rows of an exported CSV (BOM and header row removed), each split into cells. */
export function csvDataRows(text: string): string[][] {
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split('\r\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.slice(1).map((line) => line.split(','))
}
