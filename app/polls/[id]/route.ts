import { jsonError, voterOf } from '@/lib/http'
import { getPoll, isPollId } from '@/lib/polls'

/**
 * GET /polls/:id → 200 { poll } (closes the poll first if its deadline has passed)
 * GET /polls/:id?pick=B&src=newsletter (an option's link in a newsletter, lib/newsletter.ts) → 307 to the poll page,
 * /p/:id?pick=B&src=newsletter, which opens with B picked. It reads and writes nothing: inbox link scanners and
 * prefetchers open these links too, and only the page's "Confirm vote" votes.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  if (isPollId(id) && (url.searchParams.has('pick') || url.searchParams.has('src'))) {
    return new Response(null, { status: 307, headers: { location: `/p/${id}${url.search}`, 'cache-control': 'no-store' } })
  }
  const poll = await getPoll(id, voterOf(request))
  if (!poll) return jsonError(404, 'Poll not found')
  return Response.json({ poll }, { headers: { 'cache-control': 'no-store' } })
}
