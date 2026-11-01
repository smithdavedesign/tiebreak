// Photos as poll options (growth, 2026-10-19). POST /images checks and cleans a photo
// and stores it in tiebreak's own database; a poll option can use the URL it returns;
// GET /images/:id serves it once a poll does. The start page and the poll page are
// server-rendered here; tests/photo-upload-browser.test.ts drives them in Chromium.
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { IMAGE_STORAGE_BUDGET_BYTES } from '@/lib/images'
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '@/lib/limits'
import {
  ORIGIN,
  accountIdOf,
  basicPoll,
  createPoll,
  feed,
  getImage,
  getPoll,
  postPublicPoll,
  rawUpload,
  uploadImage,
  useTestDb,
  voter,
} from './helpers'
import { SECRETS, contains, gpsBytes, jpeg, orientationOnlyExif, png, pngOfSize, webp } from './image-bytes'

let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookie && name === 'tb_voter' ? { name, value: cookie } : undefined),
  }),
  headers: async () => new Headers(), // a browser: no native-app header (the poll page reads it since 2026-11-01)
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: HomePage } = await import('@/app/page')
const { default: PollPage } = await import('@/app/p/[id]/page')

const db = useTestDb()

async function render(page: () => Promise<ReactElement>, as?: string) {
  cookie = as?.split('=')[1]
  return renderToString(await page())
}

const pollPage = (id: string) => () => PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })

const count = async (table: 'polls' | 'images') =>
  (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n

const IMAGE_URL = new RegExp(`^${ORIGIN.replace(/[.]/g, '\\.')}/images/[A-Za-z0-9_-]{16}$`)
const ACCEPT = 'image/jpeg,image/png,image/webp'

/** Uploads a photo as `who` and returns its URL. */
async function upload(who: string, bytes: Uint8Array = png(), type = 'image/png') {
  const { res, body } = await uploadImage(bytes, type, who)
  if (res.status !== 201) throw new Error(`upload returned ${res.status}: ${body.error}`)
  return body.url as string
}

const photoPoll = (a: string, b: string) => ({
  ...basicPoll,
  options: [
    { text: 'Speckled blue glaze', imageUrl: a },
    { text: 'Matte white', imageUrl: b },
  ],
})

describe('the start page', () => {
  it('gives each option a photo picker that takes JPEG, PNG and WebP, next to the image link', async () => {
    expect(IMAGE_TYPES.join(',')).toBe(ACCEPT)
    const html = await render(HomePage)
    const pickers = html.match(/<input[^>]*type="file"[^>]*>/g) ?? []
    expect(pickers).toHaveLength(2)
    for (const [i, letter] of ['A', 'B'].entries()) {
      expect(pickers[i]).toContain(`accept="${ACCEPT}"`)
      expect(pickers[i]).toContain(`aria-label="Option ${letter} photo"`)
      expect(html).toContain(`aria-label="Option ${letter} image URL"`)
    }
    expect(html).toContain('JPEG, PNG or WebP, up to 5 MB')
  })
})

describe('POST /images', () => {
  it.each([
    ['a JPEG', jpeg(), 'image/jpeg'],
    ['a PNG', png(), 'image/png'],
    ['a WebP', webp(), 'image/webp'],
  ])('stores %s and answers 201 with its URL on tiebreak itself', async (_, bytes, type) => {
    const { res, body } = await uploadImage(bytes, type, voter(1))
    expect(res.status).toBe(201)
    expect(body.url).toMatch(IMAGE_URL)
    expect(body.url).toBe(`${ORIGIN}/images/${body.id}`)
    expect(await count('images')).toBe(1)
  })

  it('gives a first-time visitor their account cookie, like posting a poll does', async () => {
    const { res } = await uploadImage(png(), 'image/png')
    expect(res.status).toBe(201)
    expect(res.headers.get('set-cookie')).toMatch(/^tb_voter=[0-9a-f-]{36};/)
  })

  it('takes a photo of exactly 5 MB and refuses one byte more with 413, storing nothing', async () => {
    expect(MAX_IMAGE_BYTES).toBe(5_000_000)
    expect((await uploadImage(pngOfSize(MAX_IMAGE_BYTES), 'image/png', voter(1))).res.status).toBe(201)
    await db().query('TRUNCATE images')

    const { res, body } = await uploadImage(pngOfSize(MAX_IMAGE_BYTES + 1), 'image/png', voter(1))
    expect(res.status).toBe(413)
    expect(body.error).toMatch(/over 5 MB/)
    expect(await count('images')).toBe(0)
  })

  it('refuses an oversized body that comes without a content-length, without reading it all', async () => {
    let sent = 0
    const chunk = new Uint8Array(1_000_000)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length
        controller.enqueue(chunk)
        if (sent > 20 * MAX_IMAGE_BYTES) controller.close()
      },
    })
    const res = await rawUpload({ headers: { 'content-type': 'image/jpeg' }, body: stream, duplex: 'half' } as RequestInit)
    expect(res.status).toBe(413)
    expect(sent).toBeLessThan(2 * MAX_IMAGE_BYTES)
    expect(await count('images')).toBe(0)
  })

  it.each([
    ['text/plain', Buffer.from('hello')],
    ['application/pdf', Buffer.from('%PDF-1.7')],
    ['image/gif', Buffer.from('GIF89a', 'latin1')],
    ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/heic', Buffer.from('....ftypheic')],
    ['application/octet-stream', png()],
    ['multipart/form-data; boundary=x', png()],
    [null, png()],
  ])('refuses the type %s with 415, storing nothing', async (type, bytes) => {
    const { res, body } = await uploadImage(bytes, type, voter(1))
    expect(res.status).toBe(415)
    expect(body.error).toMatch(/JPEG, PNG or WebP/)
    expect(await count('images')).toBe(0)
  })

  it('refuses a file over 5 MB with a non-image type as the wrong type (415)', async () => {
    const { res } = await uploadImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'text/plain', voter(1))
    expect(res.status).toBe(415)
  })

  it.each([
    ['text labelled as a PNG', 'image/png', Buffer.from('hello, not a photo')],
    ['a PDF labelled as a JPEG', 'image/jpeg', Buffer.from('%PDF-1.7\n1 0 obj')],
    ['HTML labelled as a WebP', 'image/webp', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['a cut-off PNG', 'image/png', png().subarray(0, 40)],
  ])('refuses %s with 415, storing nothing', async (_, type, bytes) => {
    const { res, body } = await uploadImage(bytes, type, voter(1))
    expect(res.status).toBe(415)
    expect(body.error).toMatch(/JPEG, PNG or WebP/)
    expect(await count('images')).toBe(0)
  })

  it('goes by the bytes, not the label: a PNG labelled image/jpeg or image/jpg is stored as a PNG', async () => {
    const urls = [await upload(voter(1), png(), 'image/jpeg'), await upload(voter(1), png(), 'image/jpg')]
    await createPoll(photoPoll(urls[0], urls[1]), voter(1))
    for (const url of urls) expect((await getImage(url)).res.headers.get('content-type')).toBe('image/png')
  })

  it('refuses an empty body with 400', async () => {
    expect((await uploadImage(new Uint8Array(0), 'image/png', voter(1))).res.status).toBe(400)
  })

  it('refuses a huge canvas in a small file with 422', async () => {
    const { res, body } = await uploadImage(png({ width: 20_000, height: 20_000, idat: Buffer.alloc(16) }), 'image/png', voter(1))
    expect(res.status).toBe(422)
    expect(body.error).toMatch(/megapixels/)
    expect(await count('images')).toBe(0)
  })

  it('pauses uploads with 503 once photo storage is full, and polls keep working', async () => {
    await db().query(
      `INSERT INTO images (id, content_type, data, bytes, uploader_id, created_at)
       VALUES ('fullfullfull0000', 'image/png', '\\x00', $1, $2, now())`,
      [IMAGE_STORAGE_BUDGET_BYTES - 10, accountIdOf(voter(9))],
    )
    const { res, body } = await uploadImage(png(), 'image/png', voter(1))
    expect(res.status).toBe(503)
    expect(body.error).toMatch(/image link/)
    expect(await count('images')).toBe(1)
    expect((await createPoll(basicPoll, voter(1))).res.status).toBe(201)
  })

  it('deletes photos no poll used within a day', async () => {
    const stale = await upload(voter(1))
    const used = await upload(voter(1))
    await createPoll(photoPoll(used, await upload(voter(1))), voter(1))
    await db().query(`UPDATE images SET created_at = now() - interval '25 hours'`)
    await upload(voter(2))
    const ids = (await db().query<{ id: string }>('SELECT id FROM images')).rows.map((r) => r.id)
    expect(ids).not.toContain(stale.split('/').pop())
    expect(ids).toContain(used.split('/').pop())
    expect(ids).toHaveLength(3)
  })
})

describe('creating a poll with two uploaded photos', () => {
  it('returns options that both carry a tiebreak image URL; the poll page shows both, and both load (200)', async () => {
    const me = voter(1)
    const a = await upload(me, png({ rgb: [40, 90, 200] }))
    const b = await upload(me, jpeg(), 'image/jpeg')

    const { res, body } = await createPoll(photoPoll(a, b), me)
    expect(res.status).toBe(201)
    expect(body.poll.options).toEqual([
      { text: 'Speckled blue glaze', imageUrl: a },
      { text: 'Matte white', imageUrl: b },
    ])
    for (const option of body.poll.options) {
      expect(option.imageUrl).toMatch(IMAGE_URL)
      expect(new URL(option.imageUrl).origin).toBe(ORIGIN)
    }
    // The JSON API (and so the native app) gets the same absolute URLs.
    expect((await getPoll(body.id, voter(2))).body.poll.options.map((o: { imageUrl: string }) => o.imageUrl)).toEqual([a, b])

    const html = await render(pollPage(body.id), voter(2))
    const imgs = html.match(/<img [^>]*>/g) ?? []
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toContain(`src="${a}"`)
    expect(imgs[1]).toContain(`src="${b}"`)

    const [first, second] = [await getImage(a), await getImage(b)]
    expect(first.res.status).toBe(200)
    expect(first.res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(first.bytes)).toEqual(png({ rgb: [40, 90, 200] }))
    expect(second.res.status).toBe(200)
    expect(second.res.headers.get('content-type')).toBe('image/jpeg')
  })

  it('serves photos as images only, cached a day, without location or camera details', async () => {
    const me = voter(1)
    const a = await upload(me, jpeg({ orientation: 6 }), 'image/jpeg')
    await createPoll(photoPoll(a, await upload(me)), me)
    const { res, bytes } = await getImage(a)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=86400, immutable')
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(contains(bytes, gpsBytes())).toBe(false)
    expect(contains(bytes, SECRETS.camera)).toBe(false)
    expect(contains(bytes, orientationOnlyExif(6))).toBe(true)
  })

  it('a photo shows in the public feed too', async () => {
    const me = voter(1)
    const a = await upload(me)
    const b = await upload(me)
    await postPublicPoll(me, { options: [{ imageUrl: a }, { imageUrl: b }] })
    expect((await feed(voter(2))).body.polls[0].options).toEqual([
      { text: null, imageUrl: a },
      { text: null, imageUrl: b },
    ])
  })

  it('mixes a photo with an image link, and image links work as before', async () => {
    const me = voter(1)
    const a = await upload(me)
    const { res, body } = await createPoll(
      { ...basicPoll, options: [{ imageUrl: a }, { text: 'Linked', imageUrl: 'https://images.example.com/b.jpg' }] },
      me,
    )
    expect(res.status).toBe(201)
    expect(body.poll.options).toEqual([
      { text: null, imageUrl: a },
      { text: 'Linked', imageUrl: 'https://images.example.com/b.jpg' },
    ])
  })

  it("keeps a photo hidden (404, not cached) until a poll uses it, so tiebreak isn't a free image host", async () => {
    const a = await upload(voter(1))
    const before = await getImage(a)
    expect(before.res.status).toBe(404)
    expect(before.res.headers.get('cache-control')).toBe('no-store')
    await createPoll(photoPoll(a, await upload(voter(1))), voter(1))
    expect((await getImage(a)).res.status).toBe(200)
  })

  it('404s for an unknown or malformed image id', async () => {
    expect((await getImage('AAAAAAAAAAAAAAAA')).res.status).toBe(404)
    expect((await getImage('not-an-id')).res.status).toBe(404)
  })

  it("refuses (400, naming the option) a photo that's gone or was never uploaded, and creates no poll", async () => {
    const me = voter(1)
    const a = await upload(me)
    const { res, body } = await createPoll(photoPoll(a, `${ORIGIN}/images/AAAAAAAAAAAAAAAA`), me)
    expect(res.status).toBe(400)
    expect(body.option).toBe(1)
    expect(body.error).toMatch(/Option B.*photo/)
    expect(await count('polls')).toBe(0)
  })

  it("takes a first-time visitor's photos, uploaded at once before they had an account cookie", async () => {
    // The form uploads both photos in parallel; with no cookie yet, each upload mints its own account.
    const [first, second] = await Promise.all([uploadImage(png(), 'image/png'), uploadImage(png(), 'image/png')])
    expect(first.res.headers.get('set-cookie')).not.toBe(second.res.headers.get('set-cookie'))
    const visitor = second.res.headers.get('set-cookie')!.split(';')[0]
    const { res } = await createPoll(photoPoll(first.body.url, second.body.url), visitor)
    expect(res.status).toBe(201)
    expect((await getImage(first.body.url)).res.status).toBe(200)
    expect((await getImage(second.body.url)).res.status).toBe(200)
  })

  it("reuses a photo another poll already shows; deleting that first poll (moderation) removes the photo", async () => {
    const a = await upload(voter(1))
    const first = await createPoll(photoPoll(a, await upload(voter(1))), voter(1))
    const second = await createPoll(photoPoll(a, 'https://images.example.com/b.jpg'), voter(2))
    expect(second.res.status).toBe(201)
    expect((await getImage(a)).res.status).toBe(200)

    await db().query('DELETE FROM polls WHERE id = $1', [first.body.id])
    expect((await getImage(a)).res.status).toBe(404)
  })

  it("accepts plain http only for tiebreak's own photo URLs (local dev runs on http)", async () => {
    const a = await upload(voter(1))
    for (const imageUrl of [
      `${ORIGIN}/other/AAAAAAAAAAAAAAAA`,
      `http://example.com/images/${a.split('/').pop()}`,
      `${a}?size=big`,
      `${ORIGIN}/images/${'A'.repeat(17)}`,
    ]) {
      const { res } = await createPoll({ ...basicPoll, options: ['a', { imageUrl }] }, voter(1))
      expect(res.status, imageUrl).toBe(400)
    }
    expect(await count('polls')).toBe(0)
  })
})

describe('a rejected upload', () => {
  it('creates no poll: the form posts the poll only after every photo is stored', async () => {
    expect((await uploadImage(pngOfSize(MAX_IMAGE_BYTES + 1), 'image/png', voter(1))).res.status).toBe(413)
    expect((await uploadImage(Buffer.from('notes'), 'text/plain', voter(1))).res.status).toBe(415)
    expect(await count('polls')).toBe(0)
    expect(await count('images')).toBe(0)
  })
})
