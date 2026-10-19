import { identify, jsonError, readJson, remember, voterOf } from '@/lib/http'
import { OPTION_LETTERS } from '@/lib/limits'
import { createPoll, listFeed, parseNewPoll } from '@/lib/polls'

/** GET /polls → 200 { polls } — the public feed as the caller sees it. */
export async function GET(request: Request) {
  const polls = await listFeed(voterOf(request))
  return Response.json({ polls }, { headers: { 'cache-control': 'no-store' } })
}

/**
 * POST /polls { question?, options, target, durationHours, visibility? }
 * → 201 { id, shareUrl, poll } | 400
 *   | 400 { error, option } (that option's uploaded photo can't be used: pick it again)
 *   | 403 (public poll without a posting credit, or private poll without Pro) | 415
 * An option's imageUrl is an https link, or a URL POST /images returned.
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  if (!body.ok) return body.response

  const parsed = parseNewPoll(body.value, new URL(request.url).origin)
  if (!parsed.ok) return jsonError(400, parsed.error)

  const account = identify(request)
  const result = await createPoll(parsed.value, account.id)
  if (result.kind === 'missing_upload') {
    return Response.json(
      {
        error: `Option ${OPTION_LETTERS[result.option]}'s photo is no longer available. Pick it again.`,
        option: result.option,
      },
      { status: 400 },
    )
  }
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
