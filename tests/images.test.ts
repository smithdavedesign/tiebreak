// The upload check (lib/images.ts): what counts as a JPEG, PNG or WebP photo, and the
// clean-up that strips location, camera and other metadata before a photo is stored,
// keeping only what draws it (pixels, size, colour profile, orientation).
import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_PIXELS, inspectImage } from '@/lib/images'
import {
  JPEG_PARTS,
  PNG_SIGNATURE,
  SECRETS,
  cleanJpeg,
  cleanWebp,
  contains,
  gpsBytes,
  jpeg,
  orientationOnlyExif,
  png,
  pngChunk,
  sof,
  webp,
} from './image-bytes'

const clean = (bytes: Uint8Array) => {
  const result = inspectImage(bytes)
  if (!result.ok) throw new Error(`expected an image, got ${result.reason}`)
  return result
}

describe('which files are photos', () => {
  it('recognises JPEG, PNG and WebP by their bytes, with their pixel size', () => {
    expect(clean(jpeg({ width: 640, height: 480 }))).toMatchObject({ type: 'image/jpeg', width: 640, height: 480 })
    expect(clean(png({ width: 3, height: 5 }))).toMatchObject({ type: 'image/png', width: 3, height: 5 })
    expect(clean(webp({ width: 4, height: 3 }))).toMatchObject({ type: 'image/webp', width: 4, height: 3 })
    expect(clean(webp({ width: 300, height: 200, metadata: false }))).toMatchObject({ width: 300, height: 200 })
    expect(clean(webp({ width: 120, height: 90, metadata: false, image: 'vp8' }))).toMatchObject({ width: 120, height: 90 })
    expect(clean(jpeg({ width: 800, height: 600, progressive: true }))).toMatchObject({ width: 800, height: 600 })
  })

  it.each([
    ['plain text', Buffer.from('hello, this is not a photo')],
    ['a PDF', Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj')],
    ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')],
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['a BMP', Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)])],
    ['empty', Buffer.alloc(0)],
    ['a PNG signature alone', PNG_SIGNATURE],
    ['a JPEG start alone', Buffer.from([0xff, 0xd8, 0xff])],
    ['a RIFF that is not WebP', Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WAVE')])],
  ])('rejects %s', (_, bytes) => {
    expect(inspectImage(bytes)).toEqual({ ok: false, reason: 'not_image' })
  })

  it('rejects broken JPEGs: no frame, no scan, or a segment longer than the file', () => {
    const p = JPEG_PARTS
    expect(inspectImage(Buffer.concat([p.soi, p.dqt, p.dht, p.sos, p.scan, p.eoi])).ok).toBe(false)
    expect(inspectImage(Buffer.concat([p.soi, p.dqt, sof(10, 10), p.eoi])).ok).toBe(false)
    expect(inspectImage(Buffer.concat([p.soi, Buffer.from([0xff, 0xe1, 0x7f, 0xff]), Buffer.alloc(10)])).ok).toBe(false)
    expect(inspectImage(Buffer.concat([p.soi, p.dqt, sof(0, 10), p.sos, p.scan, p.eoi])).ok).toBe(false)
    expect(inspectImage(Buffer.concat([p.soi, Buffer.from('junk'), p.eoi])).ok).toBe(false)
  })

  it('rejects broken PNGs: no header first, no end, or a chunk longer than the file', () => {
    const ok = png()
    expect(inspectImage(Buffer.concat([PNG_SIGNATURE, pngChunk('IDAT', Buffer.alloc(4)), pngChunk('IEND', Buffer.alloc(0))])).ok).toBe(false)
    expect(inspectImage(ok.subarray(0, ok.length - 12)).ok).toBe(false)
    expect(inspectImage(Buffer.concat([ok.subarray(0, 33), Buffer.from([0x7f, 0, 0, 0]), Buffer.from('IDAT')])).ok).toBe(false)
    expect(inspectImage(png({ width: 0, height: 4, idat: Buffer.alloc(4) })).ok).toBe(false)
  })

  it('rejects broken WebPs: no image chunk or a chunk longer than the file', () => {
    const noImage = Buffer.concat([Buffer.from('RIFF'), Buffer.from([12, 0, 0, 0]), Buffer.from('WEBPJUNK'), Buffer.from([0, 0, 0, 0])])
    expect(inspectImage(noImage).ok).toBe(false)
    const cut = webp({ metadata: false })
    expect(inspectImage(cut.subarray(0, cut.length - 4)).ok).toBe(false)
  })

  it(`refuses a canvas over ${MAX_IMAGE_PIXELS / 1e6} megapixels (a small file can hide a huge image)`, () => {
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS))
    expect(inspectImage(png({ width: side + 1, height: side + 1, idat: Buffer.alloc(8) }))).toEqual({ ok: false, reason: 'too_many_pixels' })
    expect(inspectImage(jpeg({ width: 16000, height: 16000 }))).toEqual({ ok: false, reason: 'too_many_pixels' })
    expect(inspectImage(png({ width: MAX_IMAGE_PIXELS / 1000, height: 1000, idat: Buffer.alloc(8) })).ok).toBe(true)
    // Phone cameras' default photos (12 to 50 megapixels) fit.
    expect(inspectImage(jpeg({ width: 8160, height: 6120 })).ok).toBe(true)
  })
})

describe('cleaning a JPEG', () => {
  it('removes GPS, camera details, XMP, IPTC, comments, extra pictures and bytes after the end', () => {
    const { bytes } = clean(jpeg())
    for (const secret of [SECRETS.camera, SECRETS.xmp, SECRETS.iptc, SECRETS.comment, SECRETS.trailing, 'MPF\0']) {
      expect(contains(bytes, secret), secret).toBe(false)
    }
    expect(contains(bytes, gpsBytes())).toBe(false)
    expect(Buffer.from(bytes)).toEqual(cleanJpeg())
  })

  it('keeps the orientation, so phone photos still show the right way up', () => {
    for (const littleEndian of [false, true]) {
      const { bytes } = clean(jpeg({ orientation: 6, littleEndian }))
      expect(contains(bytes, gpsBytes(littleEndian))).toBe(false)
      expect(contains(bytes, SECRETS.camera)).toBe(false)
      expect(Buffer.from(bytes)).toEqual(cleanJpeg({ orientation: 6 }))
      expect(contains(bytes, orientationOnlyExif(6))).toBe(true)
    }
    // Upright (1) needs no EXIF at all.
    expect(Buffer.from(clean(jpeg({ orientation: 1 })).bytes)).toEqual(cleanJpeg())
  })

  it('cleans between the scans of a progressive JPEG too', () => {
    const { bytes } = clean(jpeg({ progressive: true }))
    expect(contains(bytes, SECRETS.comment)).toBe(false)
    expect(Buffer.from(bytes)).toEqual(cleanJpeg({ progressive: true }))
  })

  it('leaves a JPEG without metadata exactly as it was', () => {
    const plain = jpeg({ metadata: false })
    expect(Buffer.from(clean(plain).bytes)).toEqual(plain)
  })
})

describe('cleaning a PNG', () => {
  it('keeps only the chunks that draw it: no text, EXIF, timestamp, credentials, private chunks or trailing bytes', () => {
    const keep = [pngChunk('iCCP', Buffer.from('srgb\0\0fake')), pngChunk('pHYs', Buffer.alloc(9, 1))]
    const metadata = [
      pngChunk('tEXt', Buffer.from(`Comment\0${SECRETS.pngText}`)),
      pngChunk('iTXt', Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${SECRETS.pngText}`)),
      pngChunk('zTXt', Buffer.from(`Author\0\0${SECRETS.pngText}`)),
      pngChunk('eXIf', Buffer.from(`MM\0*${SECRETS.pngText}`)),
      pngChunk('tIME', Buffer.alloc(7, 1)),
      pngChunk('caBX', Buffer.from(`c2pa ${SECRETS.pngText}`)),
      pngChunk('prVt', Buffer.from(`private ${SECRETS.pngText}`)),
    ]
    const dirty = png({ before: [...keep, ...metadata], after: [metadata[0]], trailing: Buffer.from(SECRETS.trailing) })
    const { bytes } = clean(dirty)
    expect(contains(bytes, SECRETS.pngText)).toBe(false)
    expect(contains(bytes, SECRETS.trailing)).toBe(false)
    expect(Buffer.from(bytes)).toEqual(png({ before: keep }))
  })

  it('leaves a PNG without metadata exactly as it was', () => {
    const plain = png({ width: 7, height: 3 })
    expect(Buffer.from(clean(plain).bytes)).toEqual(plain)
  })
})

describe('cleaning a WebP', () => {
  it('removes the EXIF and XMP chunks, clears their flags and fixes the file size', () => {
    const { bytes } = clean(webp())
    expect(contains(bytes, SECRETS.webpExif)).toBe(false)
    expect(contains(bytes, SECRETS.webpXmp)).toBe(false)
    expect(Buffer.from(bytes)).toEqual(cleanWebp())
    expect(Buffer.from(bytes).readUInt32LE(4)).toBe(bytes.length - 8)
  })

  it('drops chunks it does not know, and anything after the RIFF', () => {
    const plain = webp({ metadata: false })
    const unknown = Buffer.concat([Buffer.from('ZZZZ'), Buffer.from([4, 0, 0, 0]), Buffer.from('ZZZZ')])
    const body = Buffer.concat([plain.subarray(8), unknown])
    const size = Buffer.alloc(4)
    size.writeUInt32LE(body.length)
    const dirty = Buffer.concat([plain.subarray(0, 4), size, body, Buffer.from(SECRETS.trailing)])
    expect(Buffer.from(clean(dirty).bytes)).toEqual(plain)
  })

  it('leaves a WebP without metadata exactly as it was', () => {
    const plain = webp({ metadata: false, image: 'vp8', width: 50, height: 40 })
    expect(Buffer.from(clean(plain).bytes)).toEqual(plain)
    expect(Buffer.from(clean(webp({ metadata: false })).bytes)).toEqual(webp({ metadata: false }))
  })
})
