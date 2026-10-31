// Reads the PNGs the share card route draws, so tests can check pixels: a strict
// decoder (signature, every chunk's CRC, IHDR, the whole zlib stream, each row's
// filter, IEND) for 8-bit RGB/RGBA without interlacing, which is what resvg writes.
import { crc32, inflateSync } from 'node:zlib'

export type RGBA = [number, number, number, number]

export interface Pixels {
  width: number
  height: number
  at(x: number, y: number): RGBA
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS: Record<number, number> = { 2: 3, 6: 4 }

/** Decodes a PNG, throwing on anything that makes it invalid. */
export function decodePng(input: Uint8Array): Pixels {
  const png = Buffer.from(input)
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG signature')
  let offset = 8
  let header: { width: number; height: number; channels: number } | null = null
  const idat: Buffer[] = []
  let ended = false
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (data.length !== length) throw new Error(`${type} chunk is cut off`)
    if (crc32(png.subarray(offset + 4, offset + 8 + length)) !== png.readUInt32BE(offset + 8 + length)) {
      throw new Error(`${type} chunk has a bad CRC`)
    }
    if (type === 'IHDR') {
      const [depth, colour, , , interlace] = data.subarray(8)
      if (depth !== 8 || !CHANNELS[colour] || interlace !== 0) throw new Error('unsupported PNG format')
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), channels: CHANNELS[colour] }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      ended = true
      break
    }
    offset += 12 + length
  }
  if (!header || !ended) throw new Error('missing IHDR or IEND')
  const { width, height, channels } = header
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  if (raw.length !== height * (stride + 1)) throw new Error('pixel data has the wrong size')

  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[y * stride + i - channels] : 0
      const up = y > 0 ? out[(y - 1) * stride + i] : 0
      const upLeft = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0
      let predicted: number
      if (filter === 0) predicted = 0
      else if (filter === 1) predicted = left
      else if (filter === 2) predicted = up
      else if (filter === 3) predicted = (left + up) >> 1
      else if (filter === 4) predicted = paeth(left, up, upLeft)
      else throw new Error(`bad filter type ${filter}`)
      out[y * stride + i] = (row[i] + predicted) & 0xff
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const i = y * stride + x * channels
      return [out[i], out[i + 1], out[i + 2], channels === 4 ? out[i + 3] : 255]
    },
  }
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** '#rrggbb' as [r, g, b]. */
export const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** True when a pixel is within `tolerance` of a colour on every channel. */
export const near = (pixel: RGBA, colour: [number, number, number], tolerance = 12) =>
  colour.every((c, i) => Math.abs(pixel[i] - c) <= tolerance)

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The pixels in a box that aren't the given colour (exactly): where something was drawn. */
export function inkIn(pixels: Pixels, box: Box, background: [number, number, number]) {
  const found: { x: number; y: number }[] = []
  for (let y = Math.round(box.y); y < Math.round(box.y + box.height); y++) {
    for (let x = Math.round(box.x); x < Math.round(box.x + box.width); x++) {
      if (!near(pixels.at(x, y), background, 0)) found.push({ x, y })
    }
  }
  return found
}

/** The share of a box's pixels close to a colour. */
export function shareOf(pixels: Pixels, box: Box, colour: [number, number, number], tolerance = 12) {
  let hits = 0
  let total = 0
  for (let y = Math.round(box.y); y < Math.round(box.y + box.height); y++) {
    for (let x = Math.round(box.x); x < Math.round(box.x + box.width); x++) {
      total += 1
      if (near(pixels.at(x, y), colour, tolerance)) hits += 1
    }
  }
  return total === 0 ? 0 : hits / total
}

const luminance = ([r, g, b]: RGBA) => 0.299 * r + 0.587 * g + 0.114 * b

/**
 * A coarse text picture of the image, one character per cell: '#' where there's dark
 * ink (text), '+' where something lighter is drawn (tiles, borders, badges), '.' where
 * there's only the background. Readable in a snapshot diff.
 */
export function inkMap(pixels: Pixels, background: [number, number, number], cell = { width: 20, height: 21 }) {
  const lines: string[] = []
  for (let top = 0; top < pixels.height; top += cell.height) {
    let line = ''
    for (let left = 0; left < pixels.width; left += cell.width) {
      let mark = '.'
      for (let y = top; y < Math.min(top + cell.height, pixels.height) && mark !== '#'; y++) {
        for (let x = left; x < Math.min(left + cell.width, pixels.width); x++) {
          const pixel = pixels.at(x, y)
          if (luminance(pixel) < 128) {
            mark = '#'
            break
          }
          if (!near(pixel, background, 0)) mark = '+'
        }
      }
      line += mark
    }
    lines.push(line)
  }
  return lines.join('\n')
}
