// Photo upload in a real browser: Chromium (playwright-core) at phone width (iPhone 13,
// 390 px wide) against the dev server, which runs on an in-memory database with sample
// data only. Picks photos and checks each option's thumbnail, posts the poll, and checks
// that the poll page loads both photos from tiebreak with status 200. Then the refusals:
// a photo over 5 MB and a text file each get a 4xx and an inline error, and no poll is
// posted. Image links still work next to photos.
//
// Needs CHROMIUM_PATH (a Chromium or Chrome binary; no browser is downloaded), and is
// skipped without it. The dev server is the one every browser test shares
// (tests/dev-server.ts): no real database or Stripe setting reaches it.
import { chromium, devices, type Browser, type Locator, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES } from '@/lib/limits'
import { CHROMIUM, appBase } from './browser'
import { png } from './image-bytes'

const PHONE = devices['iPhone 13']
const ACCEPT = 'image/jpeg,image/png,image/webp'

/** A real photo from the browser's own encoder: a two-colour picture as JPEG or WebP bytes. */
async function encode(page: Page, type: 'image/jpeg' | 'image/webp', colour: string) {
  const base64 = await page.evaluate(
    async ({ type, colour }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 120
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = colour
      ctx.fillRect(0, 0, 160, 120)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(50, 30, 60, 60)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.9))
      let binary = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
      return btoa(binary)
    },
    { type, colour },
  )
  return Buffer.from(base64, 'base64')
}

const loaded = (img: Locator) => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)
const isPath = (url: string, path: string) => new URL(url).pathname === path

describe.skipIf(!CHROMIUM)('photo upload in Chromium at phone width (390 px)', () => {
  let browser: Browser | undefined
  let base = ''

  beforeAll(async () => {
    base = await appBase()
    // The dev server compiles each route on its first request; do that now, not inside a test's timeout.
    await Promise.all([
      fetch(`${base}/images`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png() }),
      fetch(`${base}/images/AAAAAAAAAAAAAAAA`),
      fetch(`${base}/polls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${base}/p/AAAAAAAAAAAA`),
    ])
    browser = await chromium.launch({ executablePath: CHROMIUM })
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
  })

  /** A phone-sized page on the start page, without the Next dev-mode badge over the form. */
  async function startPage() {
    const context = await browser!.newContext({ ...PHONE })
    const page = await context.newPage()
    await page.goto(base)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
    await page.getByLabel('Option A photo').waitFor({ state: 'attached' })
    expect(page.viewportSize()?.width).toBe(390)
    return { context, page }
  }

  const noSidewaysScroll = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  it('shows a thumbnail in each option, then the poll page loads both photos from tiebreak (200)', { timeout: 180_000 }, async () => {
    const { context, page } = await startPage()
    const uploads: number[] = []
    const photoLoads: { url: string; status: number }[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && isPath(r.url(), '/images')) uploads.push(r.status())
      if (r.request().method() === 'GET' && new URL(r.url()).pathname.startsWith('/images/')) photoLoads.push({ url: r.url(), status: r.status() })
    })

    for (const letter of ['A', 'B']) {
      expect(await page.getByLabel(`Option ${letter} photo`).getAttribute('accept')).toBe(ACCEPT)
    }
    const photos = { A: await encode(page, 'image/jpeg', '#2a5ac8'), B: await encode(page, 'image/webp', '#8a5a2b') }
    await page.getByLabel('Option A photo').setInputFiles({ name: 'blue-mug.jpg', mimeType: 'image/jpeg', buffer: photos.A })
    await page.getByLabel('Option B photo').setInputFiles({ name: 'walnut-shelf.webp', mimeType: 'image/webp', buffer: photos.B })

    for (const letter of ['A', 'B']) {
      const thumb = page.getByRole('group', { name: `Option ${letter}` }).locator('img.thumb')
      await thumb.waitFor()
      expect(await thumb.getAttribute('src')).toMatch(/^blob:/)
      await expect.poll(() => loaded(thumb)).toBe(true)
      expect(await thumb.isVisible()).toBe(true)
    }
    expect(uploads).toEqual([]) // photos go up when the poll is posted
    await noSidewaysScroll(page)

    await page.getByLabel('Question').fill('Which photo for my mug listing?')
    await page.getByRole('button', { name: 'Create poll' }).click()
    await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })
    expect(uploads).toEqual([201, 201])

    const imgs = page.locator('.swipe-card img')
    await expect.poll(() => imgs.count(), { timeout: 30_000 }).toBe(2)
    const srcs = await imgs.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))
    for (const src of srcs) expect(src).toMatch(new RegExp(`^${base}/images/[A-Za-z0-9_-]{16}$`))
    for (const i of [0, 1]) await expect.poll(() => loaded(imgs.nth(i)), { timeout: 30_000 }).toBe(true)
    for (const src of srcs) expect(photoLoads).toContainEqual({ url: src, status: 200 })
    const types = await Promise.all(srcs.map(async (src) => (await context.request.get(src)).headers()['content-type']))
    expect(types).toEqual(['image/jpeg', 'image/webp'])
    await noSidewaysScroll(page)
    await context.close()
  })

  it('refuses a photo over 5 MB and a text file in the slot, with a 4xx, and posts no poll', { timeout: 180_000 }, async () => {
    const { context, page } = await startPage()
    const pollPosts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && isPath(r.url(), '/polls')) pollPosts.push(r.url())
    })
    const nextUpload = () => page.waitForResponse((r) => r.request().method() === 'POST' && isPath(r.url(), '/images'))
    await page.getByLabel('Option A text').fill('Blue mug')
    await page.getByLabel('Option B text').fill('White mug')
    const slotA = page.getByRole('group', { name: 'Option A' })

    await page.getByLabel('Option A photo').setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff),
    })
    let answer = nextUpload()
    await page.getByRole('button', { name: 'Create poll' }).click()
    expect((await answer).status()).toBe(413)
    await expect.poll(() => slotA.getByRole('alert').textContent()).toMatch(/over 5 MB/)
    await noSidewaysScroll(page)

    await page.getByLabel('Option A photo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') })
    await expect.poll(() => slotA.getByRole('alert').count()).toBe(0) // a new pick clears the old error
    answer = nextUpload()
    await page.getByRole('button', { name: 'Create poll' }).click()
    expect((await answer).status()).toBe(415)
    await expect.poll(() => slotA.getByRole('alert').textContent()).toMatch(/JPEG, PNG or WebP/)

    expect(pollPosts).toEqual([])
    expect(new URL(page.url()).pathname).toBe('/')

    // Removing the photo lets the poll go out with its text options.
    await slotA.getByRole('button', { name: 'Remove photo' }).click()
    await page.getByRole('button', { name: 'Create poll' }).click()
    await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })
    expect(pollPosts).toHaveLength(1)
    await context.close()
  })

  it('still takes an image link next to an uploaded photo', { timeout: 180_000 }, async () => {
    const { context, page } = await startPage()
    const link = 'https://images.example.com/white-mug.jpg'
    await page.getByLabel('Option A photo').setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: png({ width: 40, height: 30 }) })
    await page.getByLabel('Option B text').fill('White mug')
    await page.getByLabel('Option B image URL').fill(link)
    await page.getByRole('button', { name: 'Create poll' }).click()
    await page.waitForURL(/\/p\/[A-Za-z0-9_-]{12}/, { timeout: 60_000 })
    const imgs = page.locator('.swipe-card img')
    await expect.poll(() => imgs.count(), { timeout: 30_000 }).toBe(2)
    const srcs = await imgs.evaluateAll((els) => els.map((el) => el.getAttribute('src')))
    expect(srcs[0]).toMatch(new RegExp(`^${base}/images/[A-Za-z0-9_-]{16}$`))
    expect(srcs[1]).toBe(link)
    await context.close()
  })
})
