import { getAccount } from '@/lib/credits'
import { identify, jsonError, readJson, remember } from '@/lib/http'
import { castVote, type VoteResult } from '@/lib/polls'

const FAILURES: Record<Exclude<VoteResult['kind'], 'ok'>, [number, string]> = {
  not_found: [404, 'Poll not found'],
  bad_option: [400, 'option must be the index of one of the poll options'],
  duplicate: [409, 'You already voted on this poll'],
  closed: [410, 'This poll has closed'],
}

/** POST /polls/:id/votes { option } → 201 { poll, account } | 400 | 404 | 409 | 410 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await readJson(request)
  if (!body.ok) return body.response

  const option = (body.value as { option?: unknown } | null)?.option
  if (typeof option !== 'number' || !Number.isInteger(option) || option < 0) {
    return jsonError(...FAILURES.bad_option)
  }

  const account = identify(request)
  const result = await castVote(id, account.id, option)

  const response =
    result.kind === 'ok'
      ? Response.json({ poll: result.poll, account: await getAccount(account.id) }, { status: 201 })
      : jsonError(...FAILURES[result.kind])
  return remember(response, account, request)
}
