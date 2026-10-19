// Test images built byte by byte, so the photo-upload tests need no binary fixtures.
// png() is a real, decodable PNG. jpeg() and webp() have every structure the upload
// check walks (segments, chunks, sizes, metadata) but no real pixel data; decodable
// JPEGs and WebPs come from Chromium in the browser test.
import { crc32, deflateSync } from 'node:zlib'

const u16be = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff])
const u32be = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const u32le = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const ascii = (s: string) => Buffer.from(s, 'latin1')

// ── PNG ────────────────────────────────────────────────────────────────────

export function pngChunk(type: string, data: Buffer) {
  const head = ascii(type)
  return Buffer.concat([u32be(data.length), head, data, u32be(crc32(Buffer.concat([head, data])))])
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * A PNG of one colour. With `idat`, that raw chunk replaces the pixels (for sizes far
 * too big to build). `before`/`after` add chunks around the pixels; `trailing` goes
 * after IEND.
 */
export function png({
  width = 2,
  height = 2,
  rgb = [255, 90, 54],
  before = [],
  after = [],
  idat,
  trailing,
}: {
  width?: number
  height?: number
  rgb?: [number, number, number]
  before?: Buffer[]
  after?: Buffer[]
  idat?: Buffer
  trailing?: Buffer
} = {}) {
  const ihdr = Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0])])
  let pixels = idat
  if (!pixels) {
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())])
    pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...before,
    pngChunk('IDAT', pixels),
    ...after,
    pngChunk('IEND', Buffer.alloc(0)),
    ...(trailing ? [trailing] : []),
  ])
}

/** A valid PNG padded with a private ancillary chunk to exactly `size` bytes. */
export function pngOfSize(size: number) {
  const base = png()
  const padding = size - base.length - 12
  if (padding < 0) throw new Error(`pngOfSize: ${size} is smaller than a bare PNG`)
  return png({ before: [pngChunk('prVt', Buffer.alloc(padding, 0x61))] })
}

// ── JPEG ───────────────────────────────────────────────────────────────────

/** Strings planted in metadata that must never survive the upload clean-up. */
export const SECRETS = {
  camera: 'SECRET-CAMERA-MODEL',
  xmp: 'SECRET-XMP-GPS-51.5',
  comment: 'SECRET-COMMENT',
  iptc: 'SECRET-IPTC-CITY',
  trailing: 'SECRET-AFTER-END',
  pngText: 'SECRET-PNG-TEXT',
  webpExif: 'SECRET-WEBP-EXIF',
  webpXmp: 'SECRET-WEBP-XMP',
}

/** GPS latitude 51° 30' 26.10" as three EXIF rationals: a byte run the tests look for. */
const GPS_LATITUDE = [51, 1, 30, 1, 2610, 100]

const segment = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), u16be(payload.length + 2), payload])

/**
 * An EXIF block ("Exif\0\0" + TIFF) with IFD0 holding the orientation (if any), a
 * camera model string and a pointer to a GPS IFD with a latitude.
 */
export function exifPayload({ orientation, littleEndian = false }: { orientation?: number; littleEndian?: boolean }) {
  const w16 = (n: number) => (littleEndian ? Buffer.from([n & 0xff, (n >> 8) & 0xff]) : u16be(n))
  const w32 = (n: number) => (littleEndian ? u32le(n) : u32be(n))
  const model = ascii(SECRETS.camera + '\0')
  const entries: [number, number, number, Buffer][] = [] // tag, type, count, 4-byte value
  const ifd0Count = (orientation ? 1 : 0) + 2
  const ifd0Size = 2 + ifd0Count * 12 + 4
  const modelOffset = 8 + ifd0Size
  const gpsOffset = modelOffset + model.length
  if (orientation) entries.push([0x0112, 3, 1, Buffer.concat([w16(orientation), Buffer.alloc(2)])])
  entries.push([0x0110, 2, model.length, w32(modelOffset)])
  entries.push([0x8825, 4, 1, w32(gpsOffset)])
  const ifd0 = Buffer.concat([
    w16(entries.length),
    ...entries.map(([tag, type, count, value]) => Buffer.concat([w16(tag), w16(type), w32(count), value])),
    w32(0),
  ])
  // GPS IFD: GPSLatitudeRef "N", GPSLatitude (3 rationals stored after the IFD).
  const gpsIfdSize = 2 + 2 * 12 + 4
  const latitudeOffset = gpsOffset + gpsIfdSize
  const gpsIfd = Buffer.concat([
    w16(2),
    Buffer.concat([w16(0x0001), w16(2), w32(2), ascii('N\0\0\0')]),
    Buffer.concat([w16(0x0002), w16(5), w32(3), w32(latitudeOffset)]),
    w32(0),
  ])
  const latitude = Buffer.concat(GPS_LATITUDE.map(w32))
  const tiffHeader = Buffer.concat([ascii(littleEndian ? 'II' : 'MM'), w16(42), w32(8)])
  return Buffer.concat([ascii('Exif\0\0'), tiffHeader, ifd0, model, gpsIfd, latitude])
}

/** The GPS latitude's bytes as the big- or little-endian EXIF above stores them. */
export function gpsBytes(littleEndian = false) {
  return Buffer.concat(GPS_LATITUDE.map(littleEndian ? u32le : u32be))
}

/** The APP1 segment the clean-up writes back to keep a photo's orientation, and nothing else. */
export function orientationOnlyExif(orientation: number) {
  return segment(
    0xe1,
    Buffer.concat([
      ascii('Exif\0\0'),
      ascii('MM'),
      u16be(42),
      u32be(8),
      u16be(1),
      Buffer.concat([u16be(0x0112), u16be(3), u32be(1), u16be(orientation), Buffer.alloc(2)]),
      u32be(0),
    ]),
  )
}

export const JPEG_PARTS = {
  soi: Buffer.from([0xff, 0xd8]),
  eoi: Buffer.from([0xff, 0xd9]),
  jfif: segment(0xe0, Buffer.concat([ascii('JFIF\0'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
  icc: segment(0xe2, Buffer.concat([ascii('ICC_PROFILE\0'), Buffer.from([1, 1]), ascii('fake-colour-profile')])),
  mpf: segment(0xe2, Buffer.concat([ascii('MPF\0'), ascii('MM'), Buffer.alloc(8)])),
  adobe: segment(0xee, Buffer.concat([ascii('Adobe'), Buffer.from([0, 100, 0, 0, 0, 0, 1])])),
  xmp: segment(0xe1, Buffer.concat([ascii('http://ns.adobe.com/xap/1.0/\0'), ascii(`<x:xmpmeta>${SECRETS.xmp}</x:xmpmeta>`)])),
  iptc: segment(0xed, Buffer.concat([ascii('Photoshop 3.0\0'), ascii(SECRETS.iptc)])),
  comment: segment(0xfe, ascii(SECRETS.comment)),
  dqt: segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
  dht: segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.alloc(0)])),
  sos: segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
  // Entropy-coded bytes, with a stuffed 0xFF (FF 00) and a restart marker (FF D0) in them.
  scan: Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]),
}

export const sof = (width: number, height: number, marker = 0xc0) =>
  segment(marker, Buffer.concat([Buffer.from([8]), u16be(height), u16be(width), Buffer.from([1, 1, 0x11, 0])]))

/**
 * A JPEG with each kind of metadata a phone or editor adds (EXIF with GPS and camera,
 * XMP, IPTC, a comment, MPF, bytes after the end) next to what must be kept (JFIF,
 * ICC colour profile, Adobe colour transform, tables, frame, scan).
 */
export function jpeg({
  width = 640,
  height = 480,
  orientation,
  littleEndian = false,
  metadata = true,
  progressive = false,
}: {
  width?: number
  height?: number
  orientation?: number
  littleEndian?: boolean
  metadata?: boolean
  progressive?: boolean
} = {}) {
  const p = JPEG_PARTS
  return Buffer.concat([
    p.soi,
    p.jfif,
    ...(metadata ? [segment(0xe1, exifPayload({ orientation, littleEndian })), p.xmp, p.icc, p.mpf, p.iptc, p.comment, p.adobe] : [p.icc, p.adobe]),
    p.dqt,
    sof(width, height, progressive ? 0xc2 : 0xc0),
    p.dht,
    p.sos,
    p.scan,
    // A progressive JPEG has more tables and scans after the first; an editor can even
    // put a comment between them.
    ...(progressive ? [p.dht, ...(metadata ? [p.comment] : []), p.sos, p.scan] : []),
    p.eoi,
    ...(metadata ? [ascii(SECRETS.trailing)] : []),
  ])
}

/** The JPEG above as the clean-up should leave it: same pixels and colour data, no metadata. */
export function cleanJpeg({
  width = 640,
  height = 480,
  orientation,
  progressive = false,
}: { width?: number; height?: number; orientation?: number; progressive?: boolean } = {}) {
  const p = JPEG_PARTS
  return Buffer.concat([
    p.soi,
    ...(orientation && orientation > 1 ? [orientationOnlyExif(orientation)] : []),
    p.jfif,
    p.icc,
    p.adobe,
    p.dqt,
    sof(width, height, progressive ? 0xc2 : 0xc0),
    p.dht,
    p.sos,
    p.scan,
    ...(progressive ? [p.dht, p.sos, p.scan] : []),
    p.eoi,
  ])
}

// ── WebP ───────────────────────────────────────────────────────────────────

const riffChunk = (fourcc: string, data: Buffer) =>
  Buffer.concat([ascii(fourcc), u32le(data.length), data, ...(data.length % 2 ? [Buffer.from([0])] : [])])

const u24le = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff])

export const WEBP_FLAGS = { icc: 0x20, alpha: 0x10, exif: 0x08, xmp: 0x04 }

/** A lossless (VP8L) bitstream header for the given size, then filler. */
export const vp8l = (width: number, height: number) => {
  const bits = (width - 1) | ((height - 1) << 14)
  return riffChunk('VP8L', Buffer.concat([Buffer.from([0x2f]), u32le(bits >>> 0), Buffer.alloc(6, 0x11)]))
}

/** A lossy (VP8) key frame header for the given size, then filler. */
export const vp8 = (width: number, height: number) =>
  riffChunk(
    'VP8 ',
    Buffer.concat([Buffer.from([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a]), Buffer.from([width & 0xff, width >> 8, height & 0xff, height >> 8]), Buffer.alloc(8, 0x22)]),
  )

/**
 * A WebP. With metadata it's an extended (VP8X) file with an odd-sized EXIF chunk and
 * an XMP chunk, flagged in the VP8X header as the format requires.
 */
export function webp({
  width = 4,
  height = 3,
  metadata = true,
  image = 'vp8l',
}: { width?: number; height?: number; metadata?: boolean; image?: 'vp8l' | 'vp8' } = {}) {
  const body = image === 'vp8l' ? vp8l(width, height) : vp8(width, height)
  const vp8x = (flags: number) => riffChunk('VP8X', Buffer.concat([Buffer.from([flags, 0, 0, 0]), u24le(width - 1), u24le(height - 1)]))
  const chunks = metadata
    ? [vp8x(WEBP_FLAGS.alpha | WEBP_FLAGS.exif | WEBP_FLAGS.xmp), body, riffChunk('EXIF', ascii(SECRETS.webpExif)), riffChunk('XMP ', ascii(SECRETS.webpXmp))]
    : [body]
  const payload = Buffer.concat([ascii('WEBP'), ...chunks])
  return Buffer.concat([ascii('RIFF'), u32le(payload.length), payload])
}

/** The metadata WebP above after clean-up: VP8X with only the alpha flag, then the image. */
export function cleanWebp({ width = 4, height = 3 }: { width?: number; height?: number } = {}) {
  const vp8x = riffChunk('VP8X', Buffer.concat([Buffer.from([WEBP_FLAGS.alpha, 0, 0, 0]), u24le(width - 1), u24le(height - 1)]))
  const payload = Buffer.concat([ascii('WEBP'), vp8x, vp8l(width, height)])
  return Buffer.concat([ascii('RIFF'), u32le(payload.length), payload])
}

/** True when `needle` appears anywhere in `haystack`. */
export const contains = (haystack: Uint8Array, needle: Buffer | string) =>
  Buffer.from(haystack).includes(typeof needle === 'string' ? ascii(needle) : needle)
