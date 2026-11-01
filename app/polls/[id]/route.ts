import { jsonError, voterOf } from '@/lib/http'
import { pollPageFor } from '@/lib/newsletter'
import { getPoll, isPollId } from '@/lib/polls'

/**
 * GET /polls/:id → 200 { poll } (closes the poll first if its deadline has passed).
 * GET /polls/:id?pick=B&src=newsletter, a newsletter block's vote link → 307 to the poll page with B preselected
 * (lib/newsletter.ts). It records nothing and reads nothing, so link scanners and prefetchers can't vote.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const query = new URL(request.url).searchParams
  if (query.has('pick') || query.has('src')) {
    if (!isPollId(id)) return jsonError(404, 'Poll not found')
    return new Response(null, { status: 307, headers: { location: pollPageFor(id, query), 'cache-control': 'no-store' } })
  }
  const poll = await getPoll(id, voterOf(request))
  if (!poll) return jsonError(404, 'Poll not found')
  return Response.json({ poll }, { headers: { 'cache-control': 'no-store' } })
}
