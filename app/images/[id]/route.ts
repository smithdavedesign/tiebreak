import { readImage } from '@/lib/images'

// A photo's bytes never change (a new photo gets a new id), so browsers and the CDN
// keep it for a day. The day also bounds how long a photo that moderation deleted
// (with its poll) can still come from a cache.
const CACHE = 'public, max-age=86400, s-maxage=86400, immutable'

/** GET /images/:id → 200 the photo | 404 (unknown, or no poll uses it yet; never cached) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const image = await readImage(id)
  if (!image) return Response.json({ error: 'Photo not found' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  return new Response(new Uint8Array(image.data), {
    headers: {
      'content-type': image.type,
      'content-length': String(image.data.byteLength),
      'cache-control': CACHE,
      // Served only as the image type its bytes were checked to be.
      'x-content-type-options': 'nosniff',
    },
  })
}
