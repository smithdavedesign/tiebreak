import { jsonError, readVoter } from '@/lib/http'
import { exportVotes, type ExportResult } from '@/lib/polls'

const FAILURES: Record<Exclude<ExportResult['kind'], 'ok'>, [number, string]> = {
  not_found: [404, 'Poll not found'],
  not_creator: [403, "Only the poll's creator can export its votes"],
  needs_pro: [403, 'CSV export is part of Pro'],
  open: [409, 'The poll is still open. Export it once it closes'],
}

/** GET /polls/:id/export → 200 text/csv (one row per vote) | 403 | 404 | 409 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await exportVotes(id, readVoter(request.headers.get('cookie')))
  if (result.kind !== 'ok') return jsonError(...FAILURES[result.kind])
  return new Response(result.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // The id passed exportVotes' pattern check (letters, digits, - and _), so it is safe in a header.
      'content-disposition': `attachment; filename="tiebreak-${id}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
