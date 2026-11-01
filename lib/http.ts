// Small HTTP helpers shared by the route handlers and the pages.
import { randomUUID } from 'node:crypto'

/**
 * The anonymous account cookie. M1 called it the voter; since M2 the same id
 * also owns posting credits, created polls and reports. The name is unchanged
 * so M1 browsers keep their votes.
 */
export const VOTER_COOKIE = 'tb_voter'
/**
 * The same anonymous id for the native app (mobile/), which keeps it in secure
 * storage instead of a cookie jar. A new id is sent back in this header too.
 * Browsers can't add a custom header to a cross-site request without a CORS
 * preflight, which this API never answers, so it can't be forged cross-site.
 */
export const VOTER_HEADER = 'x-tiebreak-voter'
const VOTER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

export function isVoterId(value: string | undefined | null): value is string {
  return typeof value === 'string' && VOTER_ID_PATTERN.test(value)
}

/** The anonymous voter id from a Cookie header, or null if missing or malformed. */
export function readVoter(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === VOTER_COOKIE) {
      const value = rest.join('=')
      return isVoterId(value) ? value : null
    }
  }
  return null
}

export function voterCookie(voterId: string, secure: boolean) {
  return [
    `${VOTER_COOKIE}=${voterId}`,
    'Path=/',
    `Max-Age=${ONE_YEAR_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

export interface Account {
  id: string
  /** True when the request had no valid cookie and this id was just minted. */
  isNew: boolean
}

/**
 * The anonymous id from the native app's header first, else the browser cookie's value; null if the one that
 * counts is missing or malformed. Pages, which read the two apart (next/headers), use this directly.
 */
export function viewerOf(header: string | null, cookie: string | null | undefined): string | null {
  if (header !== null) return isVoterId(header.trim()) ? header.trim() : null
  return isVoterId(cookie) ? cookie : null
}

/** The caller's anonymous id: the native app's header first, else the browser cookie. */
export function voterOf(request: Request): string | null {
  return viewerOf(request.headers.get(VOTER_HEADER), readVoter(request.headers.get('cookie')))
}

/** The caller's account: the id from their header or cookie, or a fresh one. */
export function identify(request: Request): Account {
  const existing = voterOf(request)
  return existing ? { id: existing, isNew: false } : { id: randomUUID(), isNew: true }
}

/** Sets the account cookie on a response when the account was just minted. */
export function remember(response: Response, account: Account, request: Request): Response {
  if (account.isNew) {
    const secure = new URL(request.url).protocol === 'https:'
    response.headers.append('set-cookie', voterCookie(account.id, secure))
    response.headers.set(VOTER_HEADER, account.id)
  }
  return response
}

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status })
}

/** A request's media type, lower-cased and without parameters (`; charset=…`), or undefined. */
export const mediaTypeOf = (request: Request) =>
  request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()

/**
 * A request body's bytes (or a fetched response's), or null once it passes `maxBytes`: a
 * declared length over the cap is refused unread, and a streamed body stops being read at the cap.
 */
export async function readCapped(request: Pick<Request, 'headers' | 'body'>, maxBytes: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return null
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * Parses a JSON request body. Only `application/json` is accepted: a
 * cross-site HTML form can't send it without a CORS preflight, which this
 * app never grants, so other sites can't make visitors' browsers cast votes,
 * file reports or post polls.
 */
export async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (mediaTypeOf(request) !== 'application/json') {
    return { ok: false, response: jsonError(415, 'Send the body as application/json') }
  }
  try {
    return { ok: true, value: await request.json() }
  } catch {
    return { ok: false, response: jsonError(400, 'The body is not valid JSON') }
  }
}
