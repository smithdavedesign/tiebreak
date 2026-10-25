// A small PNG reader for the share-card tests: checks every chunk's CRC, inflates the
// pixels and undoes the row filters, so a test can look at what the card actually draws.
// Handles what resvg writes (8-bit RGB or RGBA, not interlaced) and nothing more.
import { crc32, inflateSync } from 'node:zlib'

export interface Decoded {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row by row. */
  rgba: Buffer
}

export type RGB = [number, number, number]

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Decodes a PNG, throwing on anything malformed: bad signature, CRC, missing IEND, short data. */
export function decodePng(input: Uint8Array): Decoded {
  const b = Buffer.from(input)
  if (!b.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG signature')
  let pos = 8
  let header: { width: number; height: number; depth: number; colour: number; interlace: number } | null = null
  const idat: Buffer[] = []
  let ended = false
  while (pos < b.length) {
    if (pos + 12 > b.length) throw new Error('truncated chunk')
    const length = b.readUInt32BE(pos)
    const type = b.toString('latin1', pos + 4, pos + 8)
    const data = b.subarray(pos + 8, pos + 8 + length)
    if (data.length !== length) throw new Error(`truncated ${type}`)
    if (b.readUInt32BE(pos + 8 + length) !== crc32(b.subarray(pos + 4, pos + 8 + length))) throw new Error(`bad CRC in ${type}`)
    if (pos === 8 && type !== 'IHDR') throw new Error('IHDR is not first')
    if (type === 'IHDR') {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] }
    }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + length
    if (type === 'IEND') {
      ended = true
      break
    }
  }
  if (!header || !ended) throw new Error('missing IHDR or IEND')
  if (pos !== b.length) throw new Error('bytes after IEND')
  const { width, height, depth, colour, interlace } = header
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`)
  }
  const channels = colour === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length !== height * (stride + 1)) throw new Error(`pixel data is ${raw.length} bytes, expected ${height * (stride + 1)}`)

  const rows = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = rows.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= channels ? prev[x - channels] : 0
      let value: number
      switch (filter) {
        case 0: value = line[x]; break
        case 1: value = line[x] + left; break
        case 2: value = line[x] + up; break
        case 3: value = line[x] + ((left + up) >> 1); break
        case 4: {
          const p = left + up - upLeft
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft)
          value = line[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
          break
        }
        default: throw new Error(`bad filter ${filter} on row ${y}`)
      }
      out[x] = value & 0xff
    }
  }
  if (channels === 4) return { width, height, rgba: rows }
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rows.copy(rgba, i * 4, i * 3, i * 3 + 3)
    rgba[i * 4 + 3] = 255
  }
  return { width, height, rgba }
}

export function pixel(img: Decoded, x: number, y: number): RGB {
  const i = (y * img.width + x) * 4
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]
}

export const hexToRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB

const near = (a: RGB, b: RGB, tolerance: number) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance)

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Pixels in `rect` within `tolerance` of `colour` (per channel). */
export function countNear(img: Decoded, rect: Rect, colour: RGB, tolerance = 8): number {
  let n = 0
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) if (near(pixel(img, x, y), colour, tolerance)) n++
  }
  return n
}

/** The pixels in `rect` that are not `colour`, as "x,y" strings (empty when the region is clean). */
export function strayPixels(img: Decoded, rect: Rect, colour: RGB, tolerance = 2): string[] {
  const stray: string[] = []
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) if (!near(pixel(img, x, y), colour, tolerance)) stray.push(`${x},${y}`)
  }
  return stray
}

/** The share of pixels that differ by more than `tolerance` in any channel (two images of one size). */
export function diffShare(a: Decoded, b: Decoded, tolerance = 24): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let differ = 0
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (Math.abs(a.rgba[i] - b.rgba[i]) > tolerance || Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) > tolerance || Math.abs(a.rgba[i + 2] - b.rgba[i + 2]) > tolerance) differ++
  }
  return differ / (a.width * a.height)
}
