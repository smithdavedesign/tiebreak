import { getPoll } from '@/lib/polls'
import { CARD_CACHE, cardPath, pollCardPng } from '@/lib/share-card'
import { SHARE_IMAGE, SITE_URL } from '@/lib/site'

const elsewhere = (path: string, request: Request) =>
  new Response(null, { status: 307, headers: { location: new URL(path, request.url).toString(), 'cache-control': 'no-store' } })

/**
 * GET /p/:id/card?v=<status> → 200 the poll's share card (PNG, 1200×630)
 *   | 307 to the card's current address (any other query) | 404 (no such poll; not cached)
 *
 * What a shared poll link unfurls as in chats and on social sites (the poll page's og:image
 * and twitter:image). It's drawn for nobody in particular: no cookie is read, so the card is
 * the same for everyone and a private poll's result never shows on it. Only the current address
 * is drawn (and cached), so a made-up query can't make the server draw the card, and fetch its
 * image links, again and again. If drawing fails outright, it sends the site's own card instead.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poll = await getPoll(id, null)
  if (!poll) return Response.json({ error: 'Poll not found' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  const asked = new URL(request.url)
  if (asked.pathname + asked.search !== cardPath(poll)) return elsewhere(cardPath(poll), request)

  // Photos uploaded here are read from the database rather than fetched: their URLs are on this site.
  const ownOrigins = [...new Set([asked.origin, new URL(SITE_URL).origin])]
  try {
    const png = await pollCardPng(poll, ownOrigins)
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'content-length': String(png.byteLength),
        'cache-control': CARD_CACHE[poll.status],
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    console.error(`Share card for poll ${poll.id} failed; sending the site's card.`, error)
    return elsewhere(SHARE_IMAGE.url, request)
  }
}
