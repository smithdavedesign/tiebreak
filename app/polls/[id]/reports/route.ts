import { identify, jsonError, readJson, remember } from '@/lib/http'
import { reportPoll, type ReportResult } from '@/lib/polls'

const FAILURES: Record<Exclude<ReportResult, 'ok'>, [number, string]> = {
  not_found: [404, 'Poll not found'],
  duplicate: [409, 'You already reported this poll'],
}

/**
 * POST /polls/:id/reports {} → 201 { reported: true } | 400 | 404 | 409 | 415
 * JSON-only like every POST here: a cross-site form carries no SameSite=Lax
 * cookie, so each forged post would count as a new reporter.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await readJson(request)
  if (!body.ok) return body.response

  const account = identify(request)
  const result = await reportPoll(id, account.id)
  const response =
    result === 'ok' ? Response.json({ reported: true }, { status: 201 }) : jsonError(...FAILURES[result])
  return remember(response, account, request)
}
