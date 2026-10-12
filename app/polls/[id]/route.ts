import { jsonError, voterOf } from '@/lib/http'
import { getPoll } from '@/lib/polls'

/** GET /polls/:id → 200 { poll } (closes the poll first if its deadline has passed) */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPoll(id, voterOf(request))
  if (!poll) return jsonError(404, 'Poll not found')
  return Response.json({ poll }, { headers: { 'cache-control': 'no-store' } })
}
