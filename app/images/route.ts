import { identify, jsonError, mediaTypeOf, readCapped, remember } from '@/lib/http'
import { MAX_IMAGE_PIXELS, imagePath, inspectImage, storeImage } from '@/lib/images'
import { MAX_IMAGE_BYTES } from '@/lib/limits'

const MAX_MB = MAX_IMAGE_BYTES / 1_000_000

/**
 * POST /images, body: a photo's bytes, sent with its image/* type (as a browser labels a picked file)
 * → 201 { id, url } | 400 (empty) | 413 (over 5 MB) | 415 (not a JPEG, PNG or WebP)
 *   | 422 (too many pixels) | 503 (photo storage is full)
 *
 * What the photo is comes from its bytes, not the label (so image/jpg works and a
 * text file called .png doesn't). It's stored cleaned of metadata, and `url` (on
 * this site) can be an option's imageUrl in POST /polls; it's served once a poll
 * uses it. Like the JSON routes, this only takes a type a cross-site form can't
 * send without a CORS preflight, which this app never grants, so other sites can't
 * upload through visitors.
 */
export async function POST(request: Request) {
  if (!mediaTypeOf(request)?.startsWith('image/')) return jsonError(415, 'Photos must be JPEG, PNG or WebP.')
  const bytes = await readCapped(request, MAX_IMAGE_BYTES)
  if (bytes === null) return jsonError(413, `That photo is over ${MAX_MB} MB. Pick a smaller one.`)
  if (bytes.length === 0) return jsonError(400, 'The photo is empty. Pick it again.')

  const image = inspectImage(bytes)
  if (!image.ok) {
    return image.reason === 'too_many_pixels'
      ? jsonError(422, `That image is over ${MAX_IMAGE_PIXELS / 1_000_000} megapixels. Pick a smaller one.`)
      : jsonError(415, "That file isn't a JPEG, PNG or WebP photo we can read.")
  }

  const account = identify(request)
  const stored = await storeImage(image, account.id)
  if (stored.kind === 'full') {
    return jsonError(503, 'Photo uploads are paused because storage is full. Use an image link for now.')
  }
  const url = new URL(imagePath(stored.id), request.url).toString()
  return remember(Response.json({ id: stored.id, url }, { status: 201 }), account, request)
}
