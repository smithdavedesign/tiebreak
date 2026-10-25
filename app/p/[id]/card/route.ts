import { getPoll } from '@/lib/polls'
import { cardPath, shareCardResponse } from '@/lib/share-card'
import { SITE_URL } from '@/lib/site'

// Lives under /p (the share link), not /polls (the API): robots.txt keeps crawlers out of /polls, and
// some link-preview bots (Twitterbot) obey it, so a card there would never unfurl.

/**
 * GET /p/:id/card?v=<status> → 200 the poll's 1200×630 share card (PNG)
 *                            | 307 to that address, for any other query (cached a minute)
 *                            | 404 (no such poll; never cached)
 * Only the poll page's own address is drawn, so the CDN's cache can't be skipped with a made-up query
 * (each drawing may fetch the options' image links), and a preview still asking for the open card of a
 * poll that has closed is sent on to its result.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Read as a stranger would: a private poll's result never reaches its card.
  const poll = await getPoll(id, null)
  if (!poll) return Response.json({ error: 'Poll not found' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  const url = new URL(request.url)
  const canonical = new URL(cardPath(poll), url)
  if (url.search !== canonical.search) {
    return new Response(null, { status: 307, headers: { location: canonical.href, 'cache-control': 'public, max-age=60, s-maxage=60' } })
  }
  // Photos uploaded here carry the address they were posted from; on the live site that's SITE_URL.
  return shareCardResponse(poll, [url.origin, new URL(SITE_URL).origin])
}
