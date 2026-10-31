// Poll share cards (growth, 2026-10-23). A poll's page lists its own 1200×630 card as
// og:image and twitter:image; GET /p/:id/card draws it from the poll: the question and
// every option (the photo's thumbnail for a photo option, the text for a text option),
// and for a closed poll the winner and the vote split. Pixels are read back from the
// PNG, so these check what the card shows, not just what was asked of the renderer.
// The rendered <meta> tags and the card in a real browser: tests/share-card-browser.test.ts.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PollView } from '@/lib/polls'
import {
  CARD,
  CARD_CACHE,
  cardPath,
  loadThumbnails,
  pollCardElement,
  pollCardPng,
  resultBarBox,
  tileBoxes,
  type Thumbnail,
} from '@/lib/share-card'
import { SHARE_IMAGE } from '@/lib/site'
import { GET as cardRoute } from '@/app/p/[id]/card/route'
import {
  ORIGIN,
  basicPoll,
  createPoll,
  getPoll,
  makePro,
  uploadImage,
  useFakeStripe,
  useTestDb,
  vote,
  voter,
} from './helpers'
import { JPEG_PARTS, orientationOnlyExif, png, sof, webp } from './image-bytes'
import { decodePng, inkIn, near, rgb, shareOf, type Box, type Pixels } from './png-pixels'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
// Linked images are only fetched from public addresses; tests decide what each host resolves to.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    const table: Record<string, { address: string; family: number }[]> = {
      'images.example.com': [{ address: '93.184.215.14', family: 4 }],
      'cdn.example.com': [{ address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 }],
      'intranet.example.com': [{ address: '10.0.0.7', family: 4 }],
      'mixed.example.com': [
        { address: '93.184.215.14', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      'mapped.example.com': [{ address: '::ffff:169.254.169.254', family: 6 }],
    }
    const found = table[host]
    if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    return found
  }),
}))

const { generateMetadata } = await import('@/app/p/[id]/page')

useTestDb()
// Fake Stripe for makePro; it also makes any other fetch a test didn't stub throw instead of going out.
useFakeStripe()

afterEach(() => {
  vi.unstubAllGlobals()
})

const C = CARD.colors
const GREEN: [number, number, number] = [32, 160, 64]
const RED: [number, number, number] = [200, 30, 40]
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

/** GET /p/:id/card?v=…, as a crawler asks for it (no cookie) unless one is given. */
async function getCard(id: string, { v = 'open', cookie }: { v?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  const res = await cardRoute(new Request(`${ORIGIN}/p/${id}/card?v=${v}`, { headers }), ctx(id))
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) }
}

async function uploadPhoto(bytes: Uint8Array, type = 'image/png') {
  const { res, body } = await uploadImage(bytes, type, voter(1))
  expect(res.status).toBe(201)
  return body.url as string
}

/** A linked image host: each URL answers with what `routes` says (bytes, a status, or a redirect). */
function stubImageHost(routes: Record<string, Uint8Array | number | { redirect: string }>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    const route = routes[url]
    if (route === undefined) throw new TypeError(`fetch failed: ${url}`)
    expect(init?.redirect).toBe('manual')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    if (typeof route === 'number') return new Response('nope', { status: route })
    if ('redirect' in route) return new Response(null, { status: 302, headers: { location: route.redirect } })
    return new Response(new Uint8Array(route), { headers: { 'content-type': 'image/png' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const markup = (poll: PollView, thumbs: (Thumbnail | null)[] = poll.options.map(() => null)) =>
  renderToStaticMarkup(pollCardElement(poll, thumbs))

/** The tile's inside: its box minus border and padding. */
const inner = (tile: Box): Box => {
  const inset = CARD.tileBorder + CARD.tilePad
  return { x: tile.x + inset, y: tile.y + inset, width: tile.width - 2 * inset, height: tile.height - 2 * inset }
}

/** How much of a result bar's track is filled with a colour, read along its middle row. */
function filled(pixels: Pixels, bar: Box, colour: [number, number, number]) {
  const y = Math.round(bar.y + bar.height / 2)
  let hits = 0
  for (let x = Math.round(bar.x); x < Math.round(bar.x + bar.width); x++) if (near(pixels.at(x, y), colour, 24)) hits += 1
  return hits / bar.width
}

/** The colour in the middle of a tile's left border. */
const borderColour = (pixels: Pixels, tile: Box) =>
  pixels.at(Math.round(tile.x + CARD.tileBorder / 2), Math.round(tile.y + tile.height / 2))

describe("a poll page's share tags", () => {
  it("point og:image and twitter:image (summary_large_image) at the poll's own 1200×630 card", async () => {
    const { body } = await createPoll({ ...basicPoll, question: 'Speckled mug or white mug?' }, voter(1))
    const meta = await generateMetadata({ params: Promise.resolve({ id: body.id }) })
    const card = { url: `/p/${body.id}/card?v=open`, width: 1200, height: 630, alt: expect.stringContaining('Speckled mug or white mug?') }
    expect(meta.openGraph).toMatchObject({ images: [card] })
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: [card] })
    expect(cardPath({ id: body.id, status: 'open' })).toBe(`/p/${body.id}/card?v=open`)
  })

  it("names the result in the card's address once the poll closes, so a cached open card isn't reused", async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))
    const meta = await generateMetadata({ params: Promise.resolve({ id: body.id }) })
    expect(meta.openGraph).toMatchObject({ images: [{ url: `/p/${body.id}/card?v=closed` }] })
    expect(meta.twitter).toMatchObject({ images: [{ url: `/p/${body.id}/card?v=closed` }] })
  })

  it("keeps the site's card for a poll that doesn't exist", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'AAAAAAAAAAAA' }) })
    expect(meta.openGraph).toMatchObject({ images: [SHARE_IMAGE] })
  })
})

describe('GET /p/:id/card', () => {
  it('answers with a 1200×630 PNG', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    const { res, bytes } = await getCard(body.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe(CARD_CACHE.open)
    const pixels = decodePng(bytes)
    expect([pixels.width, pixels.height]).toEqual([1200, 630])
  })

  it('lets caches keep a closed poll’s card for a day, and an open one for minutes', async () => {
    expect(CARD_CACHE.open).toMatch(/max-age=300\b/)
    expect(CARD_CACHE.closed).toMatch(/max-age=86400\b/)
    expect(CARD_CACHE.no_result).toBe(CARD_CACHE.closed)
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 1, voter(2))
    expect((await getCard(body.id, { v: 'closed' })).res.headers.get('cache-control')).toBe(CARD_CACHE.closed)
  })

  it("sends any other address to the card's current one, so made-up queries can't skip the cache", async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    for (const v of ['open', 'closed', 'closed&x=1', 'whatever']) {
      const { res } = await getCard(body.id, { v })
      if (v === 'open') expect(res.status).toBe(200)
      else {
        expect(res.status).toBe(307)
        expect(res.headers.get('location')).toBe(`${ORIGIN}/p/${body.id}/card?v=open`)
        expect(res.headers.get('cache-control')).toBe('no-store')
      }
    }
    await vote(body.id, 0, voter(2)) // closes it: the open card's address now leads to the result
    const { res } = await getCard(body.id, { v: 'open' })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/p/${body.id}/card?v=closed`)
    expect((await getCard(body.id, { v: 'closed' })).res.status).toBe(200)
  })

  it('is 404 (not cached) for a poll that does not exist', async () => {
    for (const id of ['AAAAAAAAAAAA', 'not-an-id']) {
      const { res } = await getCard(id)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it("is the same for everyone: a private poll's result stays hidden even from its creator's cookie", async () => {
    await makePro(voter(1))
    const { res: created, body } = await createPoll({ ...basicPoll, visibility: 'private', target: 2 }, voter(1))
    expect(created.status).toBe(201)
    await vote(body.id, 0, voter(2))
    await vote(body.id, 0, voter(3))
    expect((await getPoll(body.id, voter(1))).body.poll.tally).toEqual([2, 0]) // the creator can see it on the page
    const anonymous = await getCard(body.id, { v: 'closed' })
    const asCreator = await getCard(body.id, { v: 'closed', cookie: voter(1) })
    expect(anonymous.res.status).toBe(200)
    expect(Buffer.from(asCreator.bytes).equals(Buffer.from(anonymous.bytes))).toBe(true)
    const pixels = decodePng(anonymous.bytes)
    for (const tile of tileBoxes(2)) expect(near(borderColour(pixels, tile), rgb(C.win), 24)).toBe(false)
  })
})

describe('what the card shows', () => {
  it('the question and every option: the photo for a photo option, the text for a text option', async () => {
    const green = await uploadPhoto(png({ width: 60, height: 40, rgb: GREEN }))
    const link = 'https://images.example.com/red-mug.png'
    stubImageHost({ [link]: png({ width: 50, height: 50, rgb: RED }) })
    const question = 'Which mug photo should lead my listing?'
    const { res, body } = await createPoll(
      {
        ...basicPoll,
        question,
        options: [{ text: 'Speckled blue', imageUrl: green }, 'Matte white text only', { imageUrl: link }],
      },
      voter(1),
    )
    expect(res.status).toBe(201)

    const { bytes } = await getCard(body.id)
    const pixels = decodePng(bytes)
    const [a, b, c] = tileBoxes(3)
    expect(shareOf(pixels, inner(a), GREEN)).toBeGreaterThan(0.25) // A's photo
    expect(shareOf(pixels, inner(b), GREEN) + shareOf(pixels, inner(b), RED)).toBe(0) // B is text
    expect(inkIn(pixels, inner(b), rgb(C.tile)).length).toBeGreaterThan(200) // …which is drawn
    expect(shareOf(pixels, inner(c), RED)).toBeGreaterThan(0.25) // C's linked image

    const poll: PollView = body.poll
    const thumbs = await loadThumbnails(poll.options, [ORIGIN])
    expect(thumbs.map((t) => t?.type ?? null)).toEqual(['image/png', null, 'image/png'])
    const html = markup(poll, thumbs)
    expect(html).toContain(question)
    for (const text of ['Speckled blue', 'Matte white text only']) expect(html).toContain(text)
    for (const letter of ['A', 'B', 'C']) expect(html).toContain(`>${letter}</div>`)
    expect(html.match(/<img /g)).toHaveLength(2)
    expect(html).not.toContain('Winner')
  })

  it('a closed poll marks the winner and shows the vote split', async () => {
    const { body } = await createPoll({ ...basicPoll, options: ['Red mug', 'Blue mug'], target: 3 }, voter(1))
    await vote(body.id, 0, voter(2))
    await vote(body.id, 1, voter(3))
    await vote(body.id, 0, voter(4))
    const closed: PollView = (await getPoll(body.id)).body.poll
    expect(closed).toMatchObject({ status: 'closed', winner: 0, tally: [2, 1] })

    const html = markup(closed)
    expect(html.match(/Winner/g)).toHaveLength(1)
    expect(html).toContain('67%')
    expect(html).toContain('2 votes')
    expect(html).toContain('33%')
    expect(html).toContain('1 vote<')
    expect(html).toContain('Closed · 3 votes')

    const pixels = decodePng((await getCard(body.id, { v: 'closed' })).bytes)
    const [a, b] = tileBoxes(2)
    expect(near(borderColour(pixels, a), rgb(C.win), 24)).toBe(true) // the winner's frame
    expect(near(borderColour(pixels, b), rgb(C.line), 24)).toBe(true)
    expect(filled(pixels, resultBarBox(a), rgb(C.win))).toBeCloseTo(2 / 3, 1)
    expect(filled(pixels, resultBarBox(b), rgb(C.muted))).toBeCloseTo(1 / 3, 1)
    expect(filled(pixels, resultBarBox(b), rgb(C.win))).toBe(0)
  })

  it('a tie shows the split with no winner, and a poll nobody voted on says so', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 2 }, voter(1))
    await vote(body.id, 0, voter(2))
    await vote(body.id, 1, voter(3))
    const tie: PollView = (await getPoll(body.id)).body.poll
    expect(tie).toMatchObject({ status: 'closed', winner: null })
    const tieHtml = markup(tie)
    expect(tieHtml).not.toContain('Winner')
    expect(tieHtml.match(/>50%</g)).toHaveLength(2)
    expect(tieHtml).toContain('a tie')

    const empty: PollView = { ...tie, status: 'no_result', voteCount: 0, tally: [0, 0], winner: null }
    const emptyHtml = markup(empty)
    expect(emptyHtml).toContain('No votes came in')
    expect(emptyHtml).not.toContain('%')
  })

  it("a private poll's closed card says the result is private and shows no split", async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    const poll: PollView = { ...body.poll, visibility: 'private', status: 'closed', voteCount: 3, tally: null, winner: null }
    const html = markup(poll)
    expect(html).toContain('result is private')
    expect(html).not.toContain('%')
    expect(html).not.toContain('Winner')
  })

  it("draws a WebP photo's option as its letter and text (the renderer can't draw WebP)", async () => {
    const photo = await uploadPhoto(webp({ metadata: false }), 'image/webp')
    const { body } = await createPoll({ ...basicPoll, options: [{ text: 'Walnut shelf', imageUrl: photo }, 'White wall'] }, voter(1))
    const thumbs = await loadThumbnails(body.poll.options, [ORIGIN])
    expect(thumbs).toEqual([null, null])
    const html = markup(body.poll, thumbs)
    expect(html).not.toContain('<img')
    expect(html).toContain('Walnut shelf')
    expect(decodePng((await getCard(body.id)).bytes).width).toBe(1200)
  })

  it("still draws the card, without thumbnails, when a photo can't be decoded", async () => {
    // A lossless (SOF3) JPEG: a real JPEG frame the upload check accepts, but one the card renderer can't read.
    const p = JPEG_PARTS
    const lossless = Buffer.concat([p.soi, p.jfif, p.dqt, sof(64, 48, 0xc3), p.dht, p.sos, p.scan, p.eoi])
    const photo = await uploadPhoto(lossless, 'image/jpeg')
    const { body } = await createPoll({ ...basicPoll, options: [{ text: 'Lossless', imageUrl: photo }, 'Plain'] }, voter(1))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { res, bytes } = await getCard(body.id)
    errors.mockRestore()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(CARD_CACHE.open)
    const pixels = decodePng(bytes)
    expect(inkIn(pixels, inner(tileBoxes(2)[0]), rgb(C.tile)).length).toBeGreaterThan(200) // its text instead
  })
})

describe('linked images on the card', () => {
  const poll = (...imageUrls: string[]) => imageUrls.map((imageUrl, i) => ({ text: `Option ${i}`, imageUrl }))
  const red = png({ width: 8, height: 8, rgb: RED })

  it('fetches public https images (IPv4 or IPv6 hosts), and follows a redirect to another public one', async () => {
    const fetchMock = stubImageHost({
      'https://images.example.com/a.png': red,
      'https://cdn.example.com/b.png': red,
      'https://images.example.com/old.png': { redirect: 'https://cdn.example.com/b.png' },
    })
    const thumbs = await loadThumbnails(
      poll('https://images.example.com/a.png', 'https://cdn.example.com/b.png', 'https://images.example.com/old.png'),
      [ORIGIN],
    )
    expect(thumbs.map((t) => t?.type)).toEqual(['image/png', 'image/png', 'image/png'])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('never asks private, loopback or link-local addresses, by name or by number', async () => {
    const fetchMock = stubImageHost({
      'https://images.example.com/to-intranet.png': { redirect: 'https://intranet.example.com/x.png' },
    })
    const urls = [
      'https://intranet.example.com/x.png',
      'https://mixed.example.com/x.png',
      'https://mapped.example.com/x.png',
      'https://localhost/x.png',
      'https://127.0.0.1/x.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x.png',
      'https://[::ffff:10.0.0.1]/x.png',
      'https://unknown-host.example.com/x.png',
      'http://images.example.com/plain-http.png',
    ]
    expect(await loadThumbnails(poll(...urls), [ORIGIN])).toEqual(urls.map(() => null))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await loadThumbnails(poll('https://images.example.com/to-intranet.png'), [ORIGIN])).toEqual([null])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://images.example.com/to-intranet.png'])
  })

  it('skips what is not a JPEG or PNG, over 5 MB, an error, or a redirect loop', async () => {
    const big = Buffer.concat([png(), Buffer.alloc(5_000_001)])
    stubImageHost({
      'https://images.example.com/page.html': new TextEncoder().encode('<html>not an image</html>'),
      'https://images.example.com/big.png': big,
      'https://images.example.com/gone.png': 404,
      'https://images.example.com/loop.png': { redirect: 'https://images.example.com/loop.png' },
      'https://images.example.com/photo.webp': webp({ metadata: false }),
    })
    const urls = ['page.html', 'big.png', 'gone.png', 'loop.png', 'photo.webp', 'offline.png'].map((f) => `https://images.example.com/${f}`)
    expect(await loadThumbnails(poll(...urls), [ORIGIN])).toEqual(urls.map(() => null))
  })

  it("reads tiebreak's own photos from the database, not over the network", async () => {
    const fetchMock = stubImageHost({})
    const green = await uploadPhoto(png({ rgb: GREEN }))
    await createPoll({ ...basicPoll, options: [{ imageUrl: green }, 'Plain'] }, voter(1)) // a photo is served once a poll uses it
    const [thumb] = await loadThumbnails(poll(green), [ORIGIN])
    expect(thumb).toMatchObject({ type: 'image/png', orientation: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("turns a phone photo upright by its EXIF orientation, as the poll page's browser does", async () => {
    const p = JPEG_PARTS
    const sideways = Buffer.concat([p.soi, orientationOnlyExif(6), p.jfif, p.dqt, sof(64, 48), p.dht, p.sos, p.scan, p.eoi])
    const photo = await uploadPhoto(sideways, 'image/jpeg')
    const { body } = await createPoll({ ...basicPoll, options: [{ text: 'Portrait', imageUrl: photo }, 'Plain'] }, voter(1))
    const [thumb] = await loadThumbnails(body.poll.options, [ORIGIN])
    expect(thumb).toMatchObject({ type: 'image/jpeg', orientation: 6 })
    const html = markup(body.poll, [thumb, null])
    expect(html).toContain('rotate(90deg)')
    expect(markup(body.poll, [{ ...thumb!, orientation: 1 }, null])).not.toContain('rotate(')
  })
})

describe('text that would overflow (4 options, a 200-character question, no images)', () => {
  const question = (
    'Which of these four photos should lead my handmade ceramic mug listing for the spring sale, given that my shop ' +
    'banner is blue, my other listings use natural light, and most buyers find me by searching on their phones? Help!'
  ).slice(0, 200)
  const options = [
    'Speckled blue glaze on a walnut shelf in soft morning light with a linen napkin and a sprig of eucalyptus',
    'Matte-white-mug-on-a-concrete-countertop-photographed-from-directly-above-with-coffee-beans-scattered',
    'Two mugs side by side on a sunny windowsill, one blue and one white, handles turned out',
    'The same speckled mug held in two hands by a window, steam rising, slightly out of focus background blur',
  ].map((text) => ({ text: text.slice(0, 80), imageUrl: null }))
  const open: PollView = {
    id: 'AAAAAAAAAAAA',
    question,
    options,
    target: 10,
    visibility: 'unlisted',
    status: 'open',
    winner: null,
    voteCount: 4,
    tally: null,
    myVote: null,
    mine: false,
    createdAt: '2026-10-23T09:00:00.000Z',
    closesAt: '2026-10-24T09:00:00.000Z',
    closedAt: null,
  }
  const closed: PollView = { ...open, status: 'closed', winner: 3, voteCount: 10, tally: [3, 1, 2, 4], closedAt: '2026-10-23T18:00:00.000Z' }
  // The widest letters need more lines than the box holds, so this one has to be cut short.
  const wide: PollView = { ...open, question: 'WMW MWM '.repeat(25).slice(0, 199) + '?', options: options.map((o) => ({ ...o, text: 'WM'.repeat(40) })) }

  it('uses a question of 200 characters and options of 80 (the longest the form allows is 140 and 80)', () => {
    for (const poll of [open, wide]) {
      expect(poll.question).toHaveLength(200)
      for (const o of poll.options) expect(o.text).toHaveLength(80)
    }
  })

  it.each([
    ['open', open],
    ['closed', closed],
    ['widest-letter', wide],
    // Two options get the biggest type, so an unbroken word's last letter is widest here.
    ['two-option widest-letter', { ...wide, options: wide.options.slice(0, 2) }],
    ['closed two-option widest-letter', { ...wide, options: wide.options.slice(0, 2), status: 'closed', winner: 0, voteCount: 1, tally: [1, 0] } as PollView],
  ])('the %s card is a valid PNG whose text stays inside its boxes', async (_label, poll) => {
    const bytes = await pollCardPng(poll, [ORIGIN])
    const pixels = decodePng(bytes) // checks every chunk's CRC, the zlib stream and each row's filter
    expect([pixels.width, pixels.height]).toEqual([1200, 630])
    const bg = rgb(C.background)
    const { width, height, pad } = CARD
    const margin = pad - 8

    // Nothing reaches the card's outer margin: no text runs off an edge.
    for (const band of [
      { x: 0, y: 0, width, height: margin },
      { x: 0, y: height - margin, width, height: margin },
      { x: 0, y: 0, width: margin, height },
      { x: width - margin, y: 0, width: margin, height },
    ]) {
      expect(inkIn(pixels, band, bg)).toEqual([])
    }

    // The question is drawn, and stops above the options with clear space between.
    const questionBox = { x: pad, y: CARD.question.top, width: width - 2 * pad, height: CARD.question.height }
    expect(inkIn(pixels, questionBox, bg).length).toBeGreaterThan(1000)
    const gap = { x: 0, y: CARD.question.top + CARD.question.height, width, height: CARD.options.top - CARD.question.top - CARD.question.height }
    expect(gap.height).toBeGreaterThanOrEqual(24)
    expect(inkIn(pixels, gap, bg)).toEqual([])

    // Each option's text is drawn inside its tile, clear of the tile's padding.
    for (const tile of tileBoxes(poll.options.length)) {
      expect(inkIn(pixels, inner(tile), rgb(C.tile)).length).toBeGreaterThan(300)
      const edge = CARD.tileBorder + 2
      const padding = CARD.tilePad - 4
      const corner = 22 // the rounded corners' anti-aliasing
      for (const strip of [
        { x: tile.x + corner, y: tile.y + edge, width: tile.width - 2 * corner, height: padding },
        { x: tile.x + corner, y: tile.y + tile.height - edge - padding, width: tile.width - 2 * corner, height: padding },
        { x: tile.x + edge, y: tile.y + corner, width: padding, height: tile.height - 2 * corner },
        { x: tile.x + tile.width - edge - padding, y: tile.y + corner, width: padding, height: tile.height - 2 * corner },
      ]) {
        expect(inkIn(pixels, strip, rgb(C.tile))).toEqual([])
      }
    }
  })

  it('looks the same as the snapshot (a map of where anything is drawn)', async () => {
    const { inkMap } = await import('./png-pixels')
    const bg = rgb(C.background)
    expect(inkMap(decodePng(await pollCardPng(open, [ORIGIN])), bg)).toMatchSnapshot('open, 4 options, 200-character question')
    expect(inkMap(decodePng(await pollCardPng(closed, [ORIGIN])), bg)).toMatchSnapshot('closed, 4 options, winner D')
    expect(inkMap(decodePng(await pollCardPng(wide, [ORIGIN])), bg)).toMatchSnapshot('open, widest letters, cut short')
  })

  it('cuts text that does not fit short (an ellipsis), instead of letting it run on', () => {
    const html = markup(wide)
    expect(html.match(/line-clamp:\d+/g)).toHaveLength(5) // the question and each option
    expect(html).toContain(wide.question)
  })
})
