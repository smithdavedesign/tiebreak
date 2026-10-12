// Small HTTP helpers shared by the route handlers and the pages.
import { randomUUID } from 'node:crypto'

/**
 * The anonymous account cookie. M1 called it the voter; since M2 the same id
 * also owns posting credits, created polls and reports. The name is unchanged
 * so M1 browsers keep their votes.
 */
export const VOTER_COOKIE = 'tb_voter'
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

/** The caller's account: the id from their cookie, or a fresh one. */
export function identify(request: Request): Account {
  const existing = readVoter(request.headers.get('cookie'))
  return existing ? { id: existing, isNew: false } : { id: randomUUID(), isNew: true }
}

/** Sets the account cookie on a response when the account was just minted. */
export function remember(response: Response, account: Account, request: Request): Response {
  if (account.isNew) {
    const secure = new URL(request.url).protocol === 'https:'
    response.headers.append('set-cookie', voterCookie(account.id, secure))
  }
  return response
}

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status })
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
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') {
    return { ok: false, response: jsonError(415, 'Send the body as application/json') }
  }
  try {
    return { ok: true, value: await request.json() }
  } catch {
    return { ok: false, response: jsonError(400, 'The body is not valid JSON') }
  }
}
