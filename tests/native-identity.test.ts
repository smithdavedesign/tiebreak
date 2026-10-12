// The native app (mobile/) identifies the same anonymous account with the
// x-tiebreak-voter header instead of a cookie.
import { describe, expect, it } from 'vitest'
import { GET as accountRoute } from '@/app/account/route'
import { POST as createPollRoute } from '@/app/polls/route'
import { GET as getPollRoute } from '@/app/polls/[id]/route'
import { POST as voteRoute } from '@/app/polls/[id]/votes/route'
import { VOTER_HEADER } from '@/lib/http'
import { ORIGIN, basicPoll, useTestDb } from './helpers'

useTestDb()

const ID_A = '00000000-0000-4000-8000-0000000000a1'
const ID_B = '00000000-0000-4000-8000-0000000000b2'
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => new Request(ORIGIN + path, { headers })

describe('native app identity header', () => {
  it('a new account is returned in the header (and the cookie, for browsers)', async () => {
    const res = await createPollRoute(post('/polls', basicPoll))
    expect(res.status).toBe(201)
    const id = res.headers.get(VOTER_HEADER)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers.get('set-cookie')).toContain(`tb_voter=${id}`)
  })

  it('the header identifies the voter: a second vote from the same header is a duplicate', async () => {
    const { id } = await (await createPollRoute(post('/polls', basicPoll))).json()
    const first = await voteRoute(post(`/polls/${id}/votes`, { option: 0 }, { [VOTER_HEADER]: ID_A }), ctx(id))
    expect(first.status).toBe(201)
    expect(first.headers.get(VOTER_HEADER)).toBeNull() // not new, so nothing to hand back
    const again = await voteRoute(post(`/polls/${id}/votes`, { option: 1 }, { [VOTER_HEADER]: ID_A }), ctx(id))
    expect(again.status).toBe(409)
    const other = await voteRoute(post(`/polls/${id}/votes`, { option: 1 }, { [VOTER_HEADER]: ID_B }), ctx(id))
    expect(other.status).toBe(201)
  })

  it('header and cookie name the same account: a vote by header shows as myVote to the cookie', async () => {
    const { id } = await (await createPollRoute(post('/polls', basicPoll))).json()
    await voteRoute(post(`/polls/${id}/votes`, { option: 1 }, { [VOTER_HEADER]: ID_A }), ctx(id))
    const viaCookie = await (await getPollRoute(get(`/polls/${id}`, { cookie: `tb_voter=${ID_A}` }), ctx(id))).json()
    const viaHeader = await (await getPollRoute(get(`/polls/${id}`, { [VOTER_HEADER]: ID_A }), ctx(id))).json()
    expect(viaCookie.poll.myVote).toBe(1)
    expect(viaHeader.poll.myVote).toBe(1)
  })

  it('the header wins over a cookie, and a malformed header is no identity (never falls back to the cookie)', async () => {
    const account = await (await accountRoute(get('/account', { [VOTER_HEADER]: ID_A, cookie: `tb_voter=${ID_B}` }))).json()
    expect(account.account).toBeDefined()
    const { id } = await (await createPollRoute(post('/polls', basicPoll))).json()
    const bad = await voteRoute(post(`/polls/${id}/votes`, { option: 0 }, { [VOTER_HEADER]: 'not-a-uuid', cookie: `tb_voter=${ID_B}` }), ctx(id))
    expect(bad.status).toBe(201)
    expect(bad.headers.get(VOTER_HEADER)).toMatch(/^[0-9a-f-]{36}$/) // treated as a new account
    const byCookie = await voteRoute(post(`/polls/${id}/votes`, { option: 0 }, { cookie: `tb_voter=${ID_B}` }), ctx(id))
    expect(byCookie.status).toBe(201) // ID_B never voted: the malformed header didn't borrow its cookie
  })
})
