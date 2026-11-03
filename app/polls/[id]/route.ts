import { jsonError, voterOf } from '@/lib/http'
import { landingPage } from '@/lib/newsletter'
import { getPoll } from '@/lib/polls'

/**
 * GET /polls/:id → 200 { poll } (closes the poll first if its deadline has passed)
 * GET /polls/:id?pick=<A–D>&src=newsletter → 303 to /p/:id?pick=…&src=… (a newsletter block's link, lib/newsletter.ts).
 *   It records nothing and mints no account, so email link scanners and prefetchers can't vote; the reader's
 *   vote counts when they tap "Confirm vote" on the page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const page = landingPage(id, new URL(request.url).searchParams)
  if (page !== null) {
    return new Response(null, { status: 303, headers: { location: new URL(page, request.url).toString(), 'cache-control': 'no-store' } })
  }
  const poll = await getPoll(id, voterOf(request))
  if (!poll) return jsonError(404, 'Poll not found')
  return Response.json({ poll }, { headers: { 'cache-control': 'no-store' } })
}
