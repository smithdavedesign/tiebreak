import { identify, jsonError, readJson, readVoter, remember } from '@/lib/http'
import { createPoll, listFeed, parseNewPoll } from '@/lib/polls'

/** GET /polls → 200 { polls } — the public feed as the caller sees it. */
export async function GET(request: Request) {
  const polls = await listFeed(readVoter(request.headers.get('cookie')))
  return Response.json({ polls }, { headers: { 'cache-control': 'no-store' } })
}

/**
 * POST /polls { question?, options, target, durationHours, visibility? }
 * → 201 { id, shareUrl, poll } | 400
 *   | 403 (public poll without a posting credit, or private poll without Pro) | 415
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  if (!body.ok) return body.response

  const parsed = parseNewPoll(body.value)
  if (!parsed.ok) return jsonError(400, parsed.error)

  const account = identify(request)
  const result = await createPoll(parsed.value, account.id)
  if (result.kind === 'needs_pro') {
    const response = Response.json(
      { error: 'Private polls are part of Pro. Upgrade at /pro.', plan: 'free' },
      { status: 403 },
    )
    return remember(response, account, request)
  }
  if (result.kind === 'no_credits') {
    const response = Response.json(
      {
        error: `Public polls cost 1 posting credit. Vote on ${result.account.votesToNextCredit} more of other people's polls to earn one.`,
        account: result.account,
      },
      { status: 403 },
    )
    return remember(response, account, request)
  }

  const { poll } = result
  const shareUrl = new URL(`/p/${poll.id}`, request.url).toString()
  return remember(Response.json({ id: poll.id, shareUrl, poll }, { status: 201 }), account, request)
}
