// Photos uploaded as poll options. A photo is checked (a JPEG, PNG or WebP by its
// bytes, not its label), cleaned (location, camera and other hidden metadata
// removed, so a seller's photo doesn't tell strangers where it was taken) and
// stored in tiebreak's own Postgres. It's served from /images/:id once a poll uses it.
//
//   POST /images: inspectImage → storeImage         (not served yet; deleted after a day unused)
//   POST /polls:  firstMissingUpload → INSERT poll → claimUploads → GET /images/:id serves it
//
// Deleting a poll deletes its photos (ON DELETE CASCADE): that's how moderation removes one.
import { randomBytes } from 'node:crypto'
import { getDb, type Sql } from './db'
import { IMAGE_TYPES } from './limits'

export type ImageType = (typeof IMAGE_TYPES)[number]

/**
 * A 5 MB file can still declare a canvas big enough to stall a phone that draws it
 * (a decompression bomb). Phone cameras' default photos are 12 to 50 megapixels.
 */
export const MAX_IMAGE_PIXELS = 64_000_000

/**
 * The most photo bytes kept at once. Neon's free tier holds 0.5 GB for everything,
 * so a full photo store pauses uploads (503) instead of filling the database that
 * polls and votes need.
 */
export const IMAGE_STORAGE_BUDGET_BYTES = 200_000_000

/** Photos no poll uses after this long are deleted (an abandoned form, a refused post). */
const UNUSED_PHOTO_TTL_MS = 24 * 60 * 60 * 1000

// Arbitrary constant (the schema lock is 7_204_311): uploads take turns, so the
// storage check and the insert can't interleave.
const IMAGE_LOCK_KEY = 7_204_312

const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/
const PATH_PATTERN = /^\/images\/([A-Za-z0-9_-]{16})$/

export const imagePath = (id: string) => `/images/${id}`

/**
 * The id of a photo uploaded to this server, when `url` is exactly its address here
 * (`<ownOrigin>/images/<id>`); null for any other URL, image links included.
 */
export function uploadedImageId(url: URL, ownOrigin: string): string | null {
  if (url.origin !== ownOrigin || url.search || url.hash || url.username || url.password) return null
  return PATH_PATTERN.exec(url.pathname)?.[1] ?? null
}

// ── Checking and cleaning ──────────────────────────────────────────────────

export type Inspected =
  /** `orientation`: a JPEG's EXIF orientation (1–8; 1 is upright, and all a PNG or WebP has). */
  | { ok: true; type: ImageType; bytes: Uint8Array; width: number; height: number; orientation: number }
  | { ok: false; reason: 'not_image' | 'too_many_pixels' }

type Cleaned = { bytes: Buffer; width: number; height: number; orientation?: number } | null

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function sniff(b: Buffer): ImageType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

const startsWith = (b: Buffer, text: string) => b.toString('latin1', 0, text.length) === text

// JPEG frame markers (SOF0–SOF15 minus DHT, JPG and DAC), which carry the pixel size.
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/**
 * Which JPEG segments survive. APP0 (JFIF) and APP14 (Adobe colour transform) can be
 * needed to draw the image, and APP2 stays only as an ICC colour profile. Every other
 * APPn (EXIF with GPS and camera, XMP, IPTC, MPF, maker data) and comments go.
 */
function keepJpegSegment(marker: number, payload: Buffer) {
  if (marker === 0xe0 || marker === 0xee) return true
  if (marker === 0xe2) return startsWith(payload, 'ICC_PROFILE\0')
  return !((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)
}

/** The orientation tag (1–8) from an EXIF block's TIFF data, or null. */
function exifOrientation(tiff: Buffer): number | null {
  try {
    const little = startsWith(tiff, 'II')
    if (!little && !startsWith(tiff, 'MM')) return null
    const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
    const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
    if (u16(2) !== 42) return null
    const ifd = u32(4)
    for (let i = 0, count = u16(ifd); i < count; i++) {
      const entry = ifd + 2 + i * 12
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8)
        return value >= 1 && value <= 8 ? value : null
      }
    }
  } catch {
    // Offsets past the end: unreadable EXIF has no orientation.
  }
  return null
}

/** An APP1 segment with an EXIF block holding only the orientation, so phone photos stay upright. */
function orientationExif(orientation: number) {
  return Buffer.from([
    0xff, 0xe1, 0x00, 0x22, // APP1, 34 bytes
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ])
}

/**
 * Walks a JPEG's segments, keeping what draws it and dropping metadata (see
 * keepJpegSegment), including between the scans of a progressive JPEG and anything
 * after the end marker. The EXIF orientation comes back as a minimal EXIF block.
 */
function cleanJpeg(b: Buffer): Cleaned {
  if (b.length < 4) return null
  const parts: Buffer[] = [b.subarray(0, 2)]
  let pos = 2
  let width = 0
  let height = 0
  let orientation: number | null = null
  let scanned = false
  for (;;) {
    if (pos >= b.length) {
      if (!scanned) return null
      break // cut off after the image data: keep what's there
    }
    if (b[pos] !== 0xff) return null
    while (b[pos + 1] === 0xff) pos++ // fill bytes before a marker
    const marker = b[pos + 1]
    if (marker === 0xd9) {
      parts.push(b.subarray(pos, pos + 2))
      break
    }
    if (marker === undefined || marker === 0x00 || marker === 0xd8) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(pos, pos + 2))
      pos += 2
      continue
    }
    if (pos + 4 > b.length) return null
    const end = pos + 2 + b.readUInt16BE(pos + 2)
    if (end < pos + 4 || end > b.length) return null
    const payload = b.subarray(pos + 4, end)
    if (JPEG_FRAMES.has(marker)) {
      height = payload.readUInt16BE(1)
      width = payload.readUInt16BE(3)
    }
    if (marker === 0xe1 && orientation === null && startsWith(payload, 'Exif\0\0')) {
      orientation = exifOrientation(payload.subarray(6))
    }
    if (keepJpegSegment(marker, payload)) parts.push(b.subarray(pos, end))
    pos = end

    if (marker === 0xda) {
      if (!width || !height) return null // a scan before any frame
      scanned = true
      // Entropy-coded data runs to the next marker: an 0xFF that isn't a stuffed
      // byte (FF 00) or a restart marker (FF D0–D7).
      const start = pos
      while (pos < b.length) {
        const next = b[pos + 1]
        if (b[pos] === 0xff && next !== undefined && next !== 0x00 && (next < 0xd0 || next > 0xd7)) break
        pos += b[pos] === 0xff && next !== undefined ? 2 : 1
      }
      parts.push(b.subarray(start, pos))
    }
  }
  if (!scanned || !width || !height) return null
  if (orientation !== null && orientation > 1) parts.splice(1, 0, orientationExif(orientation))
  return { bytes: Buffer.concat(parts), width, height, orientation: orientation ?? 1 }
}

// The PNG chunks that draw the image: header, palette, pixels and end, transparency,
// colour (gamma, chromaticities, ICC, sRGB, HDR), background, pixel size, and APNG
// animation. Everything else goes: text (comments, XMP, software), EXIF, timestamps,
// content credentials and private chunks.
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'cLLI',
  'bKGD', 'hIST', 'pHYs', 'sPLT', 'acTL', 'fcTL', 'fdAT',
])

/** Walks a PNG's chunks from IHDR to IEND, keeping only PNG_KEEP and dropping anything after IEND. */
function cleanPng(b: Buffer): Cleaned {
  const parts: Buffer[] = [b.subarray(0, 8)]
  let pos = 8
  let width = 0
  let height = 0
  while (pos + 12 <= b.length) {
    const length = b.readUInt32BE(pos)
    const type = b.toString('latin1', pos + 4, pos + 8)
    const end = pos + 12 + length
    if (end > b.length) return null
    if (pos === 8) {
      if (type !== 'IHDR' || length !== 13) return null
      width = b.readUInt32BE(pos + 8)
      height = b.readUInt32BE(pos + 12)
    }
    if (PNG_KEEP.has(type)) parts.push(b.subarray(pos, end))
    pos = end
    if (type === 'IEND') return width && height ? { bytes: Buffer.concat(parts), width, height } : null
  }
  return null
}

const WEBP_EXIF_FLAG = 0x08
const WEBP_XMP_FLAG = 0x04
// The WebP chunks that draw the image: extended header, colour profile, animation,
// alpha and the bitstreams. EXIF, XMP and anything unknown go.
const WEBP_KEEP = new Set(['VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L'])

/**
 * Walks a WebP's RIFF chunks, keeping only WEBP_KEEP and clearing the EXIF and XMP
 * flags in the extended header, then writes the RIFF size back. Data after the RIFF goes.
 */
function cleanWebp(b: Buffer): Cleaned {
  const riffEnd = Math.min(b.length, 8 + b.readUInt32LE(4))
  const chunks: Buffer[] = []
  let pos = 12
  let canvas: { width: number; height: number } | null = null
  let frame: { width: number; height: number } | null = null
  let hasImage = false
  while (pos + 8 <= riffEnd) {
    const fourcc = b.toString('latin1', pos, pos + 4)
    const dataEnd = pos + 8 + b.readUInt32LE(pos + 4)
    if (dataEnd > riffEnd) return null
    const data = b.subarray(pos + 8, dataEnd)
    if (fourcc === 'VP8X') {
      canvas = { width: 1 + data.readUIntLE(4, 3), height: 1 + data.readUIntLE(7, 3) }
    } else if (fourcc === 'VP8 ') {
      if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null
      frame ??= { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff }
      hasImage = true
    } else if (fourcc === 'VP8L') {
      if (data[0] !== 0x2f) return null
      const bits = data.readUInt32LE(1)
      frame ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      hasImage = true
    } else if (fourcc === 'ANMF') {
      hasImage = true // an animation frame
    }
    const end = Math.min(riffEnd, dataEnd + ((dataEnd - pos) % 2)) // chunks are padded to an even size
    if (WEBP_KEEP.has(fourcc)) chunks.push(Buffer.from(b.subarray(pos, end)))
    pos = end
  }
  const size = canvas ?? frame
  if (!hasImage || !size || !size.width || !size.height) return null
  if (chunks[0]?.toString('latin1', 0, 4) === 'VP8X') chunks[0][8] &= ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG)
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks])
  const header = Buffer.from('RIFF\0\0\0\0', 'latin1')
  header.writeUInt32LE(body.length, 4)
  return { bytes: Buffer.concat([header, body]), ...size }
}

const CLEANERS: Record<ImageType, (b: Buffer) => Cleaned> = {
  'image/jpeg': cleanJpeg,
  'image/png': cleanPng,
  'image/webp': cleanWebp,
}

/**
 * What an uploaded file is: a JPEG, PNG or WebP (by its bytes) with its pixel size,
 * cleaned of metadata; or why it can't be a photo option. A file whose structure
 * doesn't hold together is not an image.
 */
export function inspectImage(input: Uint8Array): Inspected {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const type = sniff(b)
  if (!type) return { ok: false, reason: 'not_image' }
  let cleaned: Cleaned
  try {
    cleaned = CLEANERS[type](b)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    cleaned = null // a read past the end: a cut-off or malformed file
  }
  if (!cleaned) return { ok: false, reason: 'not_image' }
  if (cleaned.width * cleaned.height > MAX_IMAGE_PIXELS) return { ok: false, reason: 'too_many_pixels' }
  return { ok: true, type, orientation: 1, ...cleaned }
}

// ── Storing and serving ────────────────────────────────────────────────────

export type StoreResult = { kind: 'ok'; id: string } | { kind: 'full' }

/**
 * Stores a cleaned photo for `uploaderId`, first deleting photos no poll used within
 * a day. Refuses (full) once the store would pass IMAGE_STORAGE_BUDGET_BYTES. Uploads
 * take turns under an advisory lock, so two can't both fit in the last free space.
 */
export async function storeImage(
  image: { type: ImageType; bytes: Uint8Array },
  uploaderId: string,
  now = new Date(),
): Promise<StoreResult> {
  const db = await getDb()
  const id = randomBytes(12).toString('base64url')
  return db.transaction(async (tx): Promise<StoreResult> => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [IMAGE_LOCK_KEY])
    await tx.query('DELETE FROM images WHERE poll_id IS NULL AND created_at < $1::timestamptz', [
      new Date(now.getTime() - UNUSED_PHOTO_TTL_MS).toISOString(),
    ])
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO images (id, content_type, data, bytes, uploader_id, created_at)
       SELECT $1, $2, $3::bytea, $4::int, $5, $6::timestamptz
        WHERE (SELECT coalesce(sum(bytes), 0) FROM images) + $4::int <= $7::bigint
       RETURNING id`,
      [id, image.type, image.bytes, image.bytes.length, uploaderId, now.toISOString(), IMAGE_STORAGE_BUDGET_BYTES],
    )
    return rows.length > 0 ? { kind: 'ok', id } : { kind: 'full' }
  })
}

/** A photo some poll uses, or null. A photo no poll uses yet isn't served to anyone. */
export async function readImage(id: string): Promise<{ type: ImageType; data: Uint8Array } | null> {
  if (!ID_PATTERN.test(id)) return null
  const db = await getDb()
  const { rows } = await db.query<{ content_type: ImageType; data: Uint8Array }>(
    'SELECT content_type, data FROM images WHERE id = $1 AND poll_id IS NOT NULL',
    [id],
  )
  return rows[0] ? { type: rows[0].content_type, data: rows[0].data } : null
}

/** A new poll's option whose image is a photo uploaded here. */
export interface Upload {
  option: number
  id: string
}

/**
 * Locks the photos a new poll's options use and returns the first option whose photo
 * is gone (deleted after a day unused, or never uploaded), or null. Having a photo's
 * URL is enough to use it: a photo no poll uses yet has an unguessable id that only
 * the browser that uploaded it knows (a first-time visitor's parallel uploads even
 * come from two freshly minted accounts), and one a poll already shows can be reused
 * like an image link. Run inside the poll's transaction.
 */
export async function firstMissingUpload(tx: Sql, uploads: Upload[]): Promise<number | null> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM images WHERE id = ANY($1::text[]) FOR UPDATE', [
    uploads.map((u) => u.id),
  ])
  const found = new Set(rows.map((r) => r.id))
  return uploads.find((u) => !found.has(u.id))?.option ?? null
}

/** Ties photos no poll uses yet to the new poll: served from now on, and deleted with it. */
export async function claimUploads(tx: Sql, pollId: string, uploads: Upload[]) {
  await tx.query('UPDATE images SET poll_id = $1 WHERE id = ANY($2::text[]) AND poll_id IS NULL', [
    pollId,
    uploads.map((u) => u.id),
  ])
}
