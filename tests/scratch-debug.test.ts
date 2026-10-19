// Real photos through the upload clean-up (lib/images.ts): Chromium encodes JPEG, PNG
// and WebP pictures, the clean-up checks and strips them, and Chromium then draws the
// cleaned bytes at the right size. A JPEG carrying EXIF orientation 6 (a phone held
// upright) and a GPS position comes out without the position and still drawn upright.
// (The file name is left over from debugging the browser test; it couldn't be renamed
// in the build sandbox. Rename it freely.) Needs CHROMIUM_PATH; skipped without it.
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspectImage } from '@/lib/images'
import { contains, exifPayload, gpsBytes } from './image-bytes'

const CHROMIUM = process.env.CHROMIUM_PATH

type Encoded = 'image/jpeg' | 'image/png' | 'image/webp'

/** A 160×120 picture (wider than tall) encoded by the browser. */
async function encode(page: Page, type: Encoded) {
  const base64 = await page.evaluate(async (type) => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 120
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#2a5ac8'
    ctx.fillRect(0, 0, 160, 120)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(20, 20, 40, 80)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.9))
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, type)
  return Buffer.from(base64, 'base64')
}

/** The size the browser draws an image file at, or null if it can't decode it. */
async function drawnSize(page: Page, bytes: Uint8Array, type: string) {
  return page.evaluate(
    async ({ base64, type }) => {
      const img = new Image()
      img.src = `data:${type};base64,${base64}`
      try {
        await img.decode()
        return { width: img.naturalWidth, height: img.naturalHeight }
      } catch {
        return null
      }
    },
    { base64: Buffer.from(bytes).toString('base64'), type },
  )
}

describe.skipIf(!CHROMIUM)('real photos through the clean-up', () => {
  let browser: Browser | undefined
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM })
    page = await browser.newPage()
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
  })

  it.each(['image/jpeg', 'image/png', 'image/webp'] as const)('a %s from Chromium is accepted and still draws', async (type) => {
    const result = inspectImage(await encode(page, type))
    expect(result).toMatchObject({ ok: true, type, width: 160, height: 120 })
    if (!result.ok) return
    expect(await drawnSize(page, result.bytes, type)).toEqual({ width: 160, height: 120 })
  })

  it('a JPEG with orientation 6 and GPS loses the GPS and still draws upright (rotated to 120×160)', async () => {
    const plain = await encode(page, 'image/jpeg')
    const exif = exifPayload({ orientation: 6 })
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif])
    const phonePhoto = Buffer.concat([plain.subarray(0, 2), app1, plain.subarray(2)])
    expect(await drawnSize(page, phonePhoto, 'image/jpeg')).toEqual({ width: 120, height: 160 })

    const result = inspectImage(phonePhoto)
    if (!result.ok) throw new Error(result.reason)
    expect(contains(result.bytes, gpsBytes())).toBe(false)
    expect(await drawnSize(page, result.bytes, 'image/jpeg')).toEqual({ width: 120, height: 160 })
  })
})
