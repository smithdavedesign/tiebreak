// Poll share cards: a poll's page names a per-poll card as its og:image and twitter:image
// (summary_large_image); /p/:id/card draws it as a 1200×630 PNG with the question and every
// option (the photo for an image option, the text for a text option); a closed poll's card
// marks the winner and the split (but never a private poll's); and the longest poll there
// is still fits (an image snapshot, with every margin and gutter checked to be empty).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PollView } from '@/lib/polls'
import { MAX_IMAGE_BYTES, MAX_OPTION_TEXT_LENGTH } from '@/lib/limits'
import { SHARE_IMAGE, SITE_URL } from '@/lib/site'
import { CARD_COLORS, CARD_SIZE, cardLayout, cardPath, loadThumbnail, renderShareCard, shareCardElement } from '@/lib/share-card'
import { basicPoll, createPoll, ORIGIN, uploadImage, useTestDb, vote, voter } from './helpers'
import { jpeg, png } from './image-bytes'
import { countNear, decodePng, diffShare, hexToRgb, strayPixels, type Decoded, type Rect } from './png-decode'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { generateMetadata: pollMetadata } = await import('@/app/p/[id]/page')
const { GET: cardRoute } = await import('@/app/p/[id]/card/route')

const db = useTestDb()

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
/** GET /p/:id/card, by default at an open poll's address. */
const getCard = (id: string, query = '?v=open') => cardRoute(new Request(`${ORIGIN}/p/${id}/card${query}`), ctx(id))
const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer())

const RED = [255, 0, 0] as const
const BLUE = [0, 0, 255] as const
const LINK = 'https://images.example.com/white-mug.png'
const BACKGROUND = hexToRgb(CARD_COLORS.background)
const TILE = hexToRgb(CARD_COLORS.tile)
const WINNER = hexToRgb(CARD_COLORS.winner)

/** Image links answered from memory: never a real network request. */
function fakeImageHost(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString()
    calls.push(url)
    const route = routes[url]
    if (!route) throw new TypeError(`unexpected fetch to ${url}`)
    return route()
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const pngResponse = (body: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(body), { headers: { 'content-type': 'image/png', ...headers } })

afterEach(() => {
  vi.unstubAllGlobals()
})

async function closedPoll(options: unknown[], votes: number[], overrides: Record<string, unknown> = {}) {
  const { body } = await createPoll({ ...basicPoll, options, target: votes.length, ...overrides }, voter(1))
  for (const [i, option] of votes.entries()) {
    const { res } = await vote(body.id, option, voter(10 + i))
    expect(res.status).toBe(201)
  }
  return body.id as string
}

/** The text of a card, as its element tree spells it out (whitespace collapsed). */
const markupOf = (poll: PollView, thumbnails: (string | null)[] = poll.options.map(() => null)) =>
  renderToStaticMarkup(shareCardElement(poll, thumbnails)).replace(/&#x27;/g, "'")

describe('a poll page names its own share card (criterion 1)', () => {
  it('as og:image and as twitter:image on a summary_large_image card', async () => {
    const { body } = await createPoll({ ...basicPoll, question: 'Speckled mug or white mug?' }, voter(1))
    const meta = await pollMetadata({ params: Promise.resolve({ id: body.id }) })
    const image = {
      url: `/p/${body.id}/card?v=open`,
      width: 1200,
      height: 630,
      alt: expect.stringContaining('Speckled mug or white mug?'),
    }
    expect(meta.openGraph).toMatchObject({ images: [image] })
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: [image] })
    // The layout's metadataBase makes it absolute, on the site's own domain.
    expect(new URL(image.url, SITE_URL).href).toBe(`${SITE_URL}/p/${body.id}/card?v=open`)
  })

  it('whose route answers image/png at 1200×630', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    const meta = await pollMetadata({ params: Promise.resolve({ id: body.id }) })
    const [image] = meta.openGraph?.images as { url: string }[]
    const url = new URL(image.url, ORIGIN)
    expect(url.pathname).toBe(`/p/${body.id}/card`)

    const res = await cardRoute(new Request(url), ctx(body.id))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const bytes = await bytesOf(res)
    expect(res.headers.get('content-length')).toBe(String(bytes.byteLength))
    const img = decodePng(bytes)
    expect([img.width, img.height]).toEqual([CARD_SIZE.width, CARD_SIZE.height])
    expect([CARD_SIZE.width, CARD_SIZE.height]).toEqual([1200, 630])
  })

  it('moves to a new card URL when the poll closes, so link previews fetch the result', async () => {
    const id = await closedPoll(['Red mug', 'Blue mug'], [0, 0, 1])
    const meta = await pollMetadata({ params: Promise.resolve({ id }) })
    expect(meta.openGraph?.images).toMatchObject([{ url: `/p/${id}/card?v=closed` }])
    expect(meta.twitter?.images).toMatchObject([{ url: `/p/${id}/card?v=closed` }])
    expect(cardPath({ id, status: 'no_result' })).toBe(`/p/${id}/card?v=no_result`)
  })

  it('keeps the site card for an unknown poll, whose card route is a 404 that is never cached', async () => {
    const meta = await pollMetadata({ params: Promise.resolve({ id: 'AAAAAAAAAAAA' }) })
    expect(meta.openGraph?.images).toEqual([SHARE_IMAGE])
    for (const id of ['AAAAAAAAAAAA', 'not-a-poll', '../../images']) {
      const res = await getCard(id)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('sends any other address to the canonical one without drawing, so a made-up query cannot skip the cache', async () => {
    const calls = fakeImageHost({ [LINK]: () => pngResponse(png()) })
    const { body } = await createPoll({ ...basicPoll, options: ['Red mug', { imageUrl: LINK }] }, voter(1))
    for (const query of ['', '?v=closed', '?v=open&x=1', '?x=1', '?v=OPEN']) {
      const res = await getCard(body.id, query)
      expect(res.status, query).toBe(307)
      expect(res.headers.get('location')).toBe(`${ORIGIN}/p/${body.id}/card?v=open`)
      expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60')
    }
    expect(calls).toEqual([])
    // A preview cached while the poll was open is sent on to the result once it closes.
    const id = await closedPoll(['Red mug', 'Blue mug'], [0])
    expect((await getCard(id, '?v=open')).headers.get('location')).toBe(`${ORIGIN}/p/${id}/card?v=closed`)
  })

  it('is cached briefly while the poll is open and for a day once it has closed', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    expect((await getCard(body.id, '?v=open')).headers.get('cache-control')).toBe('public, max-age=600, s-maxage=600')
    const id = await closedPoll(['Red mug', 'Blue mug'], [1])
    expect((await getCard(id, '?v=closed')).headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=86400')
  })
})

describe('what the card shows (criterion 2)', () => {
  it('the question and every option: text, an uploaded photo and an image link', async () => {
    const red = png({ width: 64, height: 48, rgb: [...RED] })
    const upload = await uploadImage(red, 'image/png', voter(1))
    expect(upload.res.status).toBe(201)
    const calls = fakeImageHost({ [LINK]: () => pngResponse(png({ width: 64, height: 48, rgb: [...BLUE] })) })
    const options = [{ text: 'Speckled mug' }, { text: 'White mug', imageUrl: upload.body.url }, { imageUrl: LINK }]
    const { body } = await createPoll({ ...basicPoll, question: 'Which listing photo?', options }, voter(1))

    const res = await getCard(body.id)
    expect(res.status).toBe(200)
    // The uploaded photo comes from tiebreak's own database; only the outside link is fetched.
    expect(calls).toEqual([LINK])

    const poll = body.poll as PollView
    const html = markupOf(poll, [null, 'data:image/png;base64,UPLOADED', 'data:image/png;base64,LINKED'])
    expect(html).toContain('Which listing photo?')
    expect(html).toContain('Speckled mug')
    expect(html).toContain('White mug')
    expect(html).toContain('src="data:image/png;base64,UPLOADED"')
    expect(html).toContain('src="data:image/png;base64,LINKED"')
    for (const letter of ['A', 'B', 'C']) expect(html).toContain(`>${letter}</div>`)

    // And the PNG really draws each photo inside its own option's tile.
    const img = decodePng(await bytesOf(res))
    const { tiles } = cardLayout(poll)
    expect(tiles.map((t) => t.image === null)).toEqual([true, false, false])
    const area = (r: Rect) => r.width * r.height
    expect(countNear(img, tiles[1].image!, [...RED])).toBeGreaterThan(area(tiles[1].image!) * 0.9)
    expect(countNear(img, tiles[2].image!, [...BLUE])).toBeGreaterThan(area(tiles[2].image!) * 0.9)
    expect(countNear(img, tiles[0], [...RED]) + countNear(img, tiles[0], [...BLUE])).toBe(0)
    expect(countNear(img, tiles[2], [...RED]) + countNear(img, tiles[1], [...BLUE])).toBe(0)
  })

  it('a closed poll: the winner marked, and each option with its votes and share', async () => {
    const id = await closedPoll(['Red mug', 'Blue mug'], [1, 0, 1])
    const res = await getCard(id, '?v=closed')
    const poll = (await import('@/lib/polls')).getPoll
    const view = (await poll(id, null))!
    expect(view).toMatchObject({ status: 'closed', winner: 1, tally: [1, 2] })

    const html = markupOf(view)
    expect(html).toContain('Closed · 3 votes · B wins')
    expect(html.match(/>Winner</g)).toHaveLength(1)
    expect(html).toContain('1 vote · 33%')
    expect(html).toContain('2 votes · 67%')
    // The bars are as long as each option's share.
    expect(html).toMatch(/width:33%/)
    expect(html).toMatch(/width:67%/)

    const img = decodePng(await bytesOf(res))
    const { tiles } = cardLayout(view)
    expect(countNear(img, tiles[1], WINNER)).toBeGreaterThan(500)
    expect(countNear(img, tiles[0], WINNER)).toBe(0)
  })

  it('a tie and a poll nobody voted on: no winner marked', async () => {
    const tie = (await (await import('@/lib/polls')).getPoll(await closedPoll(['Red', 'Blue'], [0, 1]), null))!
    const tieHtml = markupOf(tie)
    expect(tieHtml).toContain("Closed · 2 votes · it's a tie")
    expect(tieHtml).not.toContain('>Winner<')
    expect(tieHtml.match(/1 vote · 50%/g)).toHaveLength(2)

    const { body } = await createPoll({ ...basicPoll, durationHours: 1 }, voter(1))
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const none = (await (await import('@/lib/polls')).getPoll(body.id, null, later))!
    expect(none.status).toBe('no_result')
    const noneHtml = markupOf(none)
    expect(noneHtml).toContain('Closed · no votes came in')
    expect(noneHtml).not.toContain('>Winner<')
  })

  it("never shows a private poll's result, even once it has closed", async () => {
    const id = await closedPoll(['Red mug', 'Blue mug'], [1, 1, 0])
    await db().query("UPDATE polls SET visibility = 'private' WHERE id = $1", [id])
    const res = await getCard(id, '?v=closed')
    expect(res.status).toBe(200)
    const view = (await (await import('@/lib/polls')).getPoll(id, null))!
    const html = markupOf(view)
    expect(html).toContain('Closed · result kept private')
    expect(html).toContain('Red mug')
    expect(html).not.toContain('Winner')
    expect(html).not.toMatch(/\d+ votes? ·/)
    expect(html).not.toContain('wins')
    const img = decodePng(await bytesOf(res))
    expect(countNear(img, { x: 0, y: 0, width: 1200, height: 630 }, WINNER)).toBe(0)
  })

  it('an open poll asks for a vote and shows no split yet', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    await vote(body.id, 0, voter(2))
    const html = markupOf((await (await import('@/lib/polls')).getPoll(body.id, null))!)
    expect(html).toContain('Help me choose: tap to vote')
    expect(html).not.toMatch(/\d+ votes? ·/)
  })

  it('an image option whose photo will not load gets a plain tile with its letter, and the card still renders', async () => {
    fakeImageHost({ [LINK]: () => new Response('<html>gone</html>', { status: 404, headers: { 'content-type': 'text/html' } }) })
    const { body } = await createPoll({ ...basicPoll, options: [{ text: 'Red mug' }, { imageUrl: LINK }] }, voter(1))
    const res = await getCard(body.id)
    expect(res.status).toBe(200)
    expect(decodePng(await bytesOf(res)).width).toBe(1200)
    const html = markupOf(body.poll)
    expect(html).toContain('>Photo</div>')
    expect(html).toContain('>B</div>')
  })

  it('still renders when a photo passes the upload check but its pixels cannot be decoded', async () => {
    // jpeg() has every structure the upload check reads, but no real image data.
    const upload = await uploadImage(jpeg({ width: 64, height: 48 }), 'image/jpeg', voter(1))
    expect(upload.res.status).toBe(201)
    const { body } = await createPoll({ ...basicPoll, options: [{ text: 'Red mug', imageUrl: upload.body.url }, 'Blue mug'] }, voter(1))
    const res = await getCard(body.id)
    expect(res.status).toBe(200)
    expect(decodePng(await bytesOf(res)).height).toBe(630)
  })
})

describe('loading an option photo for the card', () => {
  const OWN = ['http://tiebreak.test', 'https://tiebreak-phi.vercel.app']

  it('reads a photo uploaded here from the database, without fetching it', async () => {
    const calls = fakeImageHost({})
    const upload = await uploadImage(png({ rgb: [...RED] }), 'image/png', voter(1))
    await createPoll({ ...basicPoll, options: [{ imageUrl: upload.body.url }, 'Blue'] }, voter(1))
    const src = await loadThumbnail(upload.body.url, OWN)
    expect(src).toMatch(/^data:image\/png;base64,/)
    expect(calls).toEqual([])
  })

  it('fetches an https link once, with a timeout and without following redirects blindly', async () => {
    const blue = png({ rgb: [...BLUE] })
    fakeImageHost({ [LINK]: () => pngResponse(blue) })
    const src = await loadThumbnail(LINK, OWN)
    expect(src).toBe(`data:image/png;base64,${Buffer.from(blue).toString('base64')}`)
    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('follows a redirect to another https image host, but not to plain http or an address', async () => {
    const next = 'https://cdn.example.com/mug.png'
    const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } })
    fakeImageHost({ [LINK]: redirect(next), [next]: () => pngResponse(png()) })
    expect(await loadThumbnail(LINK, OWN)).toMatch(/^data:image\/png;base64,/)

    for (const location of ['http://cdn.example.com/mug.png', 'https://127.0.0.1/mug.png', 'https://[::1]/mug.png']) {
      fakeImageHost({ [LINK]: redirect(location), [location]: () => pngResponse(png()) })
      expect(await loadThumbnail(LINK, OWN)).toBeNull()
    }
    // A loop of redirects gives up.
    const a = 'https://a.example.com/x.png'
    const b = 'https://b.example.com/x.png'
    fakeImageHost({ [a]: redirect(b), [b]: redirect(a) })
    expect(await loadThumbnail(a, OWN)).toBeNull()
  })

  it('never fetches plain http, localhost, an IP address, a bare host name or an odd port', async () => {
    const calls = fakeImageHost({})
    for (const url of [
      'http://images.example.com/mug.png',
      'https://images.example.com:8443/mug.png',
      'https://intranet/mug.png',
      'https://localhost/mug.png',
      'https://app.localhost/mug.png',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/mug.png',
      'https://[fd00::1]/mug.png',
      'https://2130706433/mug.png',
      'not a url',
    ]) {
      expect(await loadThumbnail(url, OWN)).toBeNull()
    }
    expect(calls).toEqual([])
  })

  it('refuses what is not a JPEG, PNG or WebP, or is over 5 MB', async () => {
    const huge = 'https://images.example.com/huge.png'
    const streamed = 'https://images.example.com/streamed.png'
    const html = 'https://images.example.com/page.png'
    const gif = 'https://images.example.com/mug.gif'
    fakeImageHost({
      [huge]: () => pngResponse(png(), { 'content-length': String(MAX_IMAGE_BYTES + 1) }),
      [streamed]: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1_000_000))
              controller.close()
            },
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
      [html]: () => new Response('<html></html>', { headers: { 'content-type': 'image/png' } }),
      [gif]: () => new Response(new Uint8Array(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')), { headers: { 'content-type': 'image/gif' } }),
    })
    for (const url of [huge, streamed, html, gif]) expect(await loadThumbnail(url, OWN)).toBeNull()
  })

  it('gives up on a slow host instead of holding the card', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')))),
      ),
    )
    const started = Date.now()
    expect(await loadThumbnail(LINK, OWN, { timeoutMs: 50 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

// ── Criterion 4: the longest poll still fits ───────────────────────────────

// 200 characters, though the create form stops at MAX_QUESTION_LENGTH (140): the card mustn't rely on it.
const LONG_QUESTION =
  'Which of these four photos should be the main image for my handmade speckled stoneware mug on Etsy, ' +
  'given that most of my buyers shop on their phones and the search thumbnail is really quite tiny now?'

// Two at MAX_OPTION_TEXT_LENGTH (80), two just under.
const LONG_OPTIONS = [
  'Speckled blue glaze in soft morning light on a linen cloth, close crop on handle',
  'Matte white mug on a walnut shelf, a small plant behind it, in warm lamplight',
  'Both mugs side by side on plain grey paper, shot straight on, and with no props',
  'From above: the mug full of coffee beside a croissant and an open paper notebook',
]

function longPoll(overrides: Partial<PollView> = {}): PollView {
  return {
    id: 'AAAAAAAAAAAA',
    question: LONG_QUESTION,
    options: LONG_OPTIONS.map((text) => ({ text, imageUrl: null })),
    target: 100,
    visibility: 'unlisted',
    status: 'open',
    winner: null,
    voteCount: 0,
    tally: null,
    myVote: null,
    mine: false,
    createdAt: '2026-10-25T10:00:00.000Z',
    closesAt: '2026-10-26T10:00:00.000Z',
    closedAt: null,
    ...overrides,
  }
}

/** Every place text could spill into: the margins, the gaps around the question, the gutters, each tile's padding. */
function expectNoOverflow(img: Decoded, poll: PollView) {
  const layout = cardLayout(poll)
  const { pad, question, tiles, tilePadding } = layout
  const bands: [string, Rect, typeof BACKGROUND][] = [
    ['top margin', { x: 0, y: 0, width: 1200, height: pad }, BACKGROUND],
    ['bottom margin', { x: 0, y: 630 - pad, width: 1200, height: pad }, BACKGROUND],
    ['left margin', { x: 0, y: 0, width: pad, height: 630 }, BACKGROUND],
    ['right margin', { x: 1200 - pad, y: 0, width: pad, height: 630 }, BACKGROUND],
    ['below the question', { x: 0, y: question.y + question.height, width: 1200, height: tiles[0].y - question.y - question.height }, BACKGROUND],
  ]
  for (const [i, tile] of tiles.entries()) {
    const next = tiles[i + 1]
    if (next) bands.push([`gutter after ${i}`, { x: tile.x + tile.width, y: tile.y, width: next.x - tile.x - tile.width, height: tile.height }, BACKGROUND])
    const inner = { x: tile.x + tilePadding, width: tile.width - 2 * tilePadding }
    bands.push([`tile ${i} bottom padding`, { ...inner, y: tile.y + tile.height - tilePadding, height: tilePadding - 6 }, TILE])
  }
  for (const [name, rect, colour] of bands) expect(strayPixels(img, rect, colour), name).toEqual([])
}

const SNAPSHOT = new URL('./__snapshots__/share-card-long-question.png', import.meta.url)

describe('a 4-option poll with a 200-character question and no images (criterion 4)', () => {
  beforeEach(() => {
    fakeImageHost({}) // no photos, so nothing may be fetched
  })

  it('is a valid 1200×630 PNG', async () => {
    const poll = longPoll()
    expect(poll.question).toHaveLength(200)
    expect(poll.options).toHaveLength(4)
    expect(LONG_OPTIONS.map((o) => o.length)).toEqual([MAX_OPTION_TEXT_LENGTH, 77, 79, MAX_OPTION_TEXT_LENGTH])
    const img = decodePng(await renderShareCard(poll, [null, null, null, null]))
    expect([img.width, img.height]).toEqual([1200, 630])
  })

  it('keeps every line of text inside its box', async () => {
    const poll = longPoll()
    const img = decodePng(await renderShareCard(poll, [null, null, null, null]))
    expectNoOverflow(img, poll)
    // The text is there: the question and each tile have ink in them.
    const ink = hexToRgb(CARD_COLORS.ink)
    const { question, tiles } = cardLayout(poll)
    expect(countNear(img, question, ink, 40)).toBeGreaterThan(2000)
    for (const tile of tiles) expect(countNear(img, tile, ink, 40)).toBeGreaterThan(500)
  })

  it('sizes the text to fit (layout snapshot)', () => {
    const { question, tiles } = cardLayout(longPoll())
    expect({ question, tiles: tiles.map(({ x, y, width, height, text }) => ({ x, y, width, height, text })) }).toMatchInlineSnapshot(`
      {
        "question": {
          "fontSize": 34,
          "height": 164,
          "lineHeight": 41,
          "lines": 4,
          "width": 1104,
          "x": 48,
          "y": 104,
        },
        "tiles": [
          {
            "height": 286,
            "text": {
              "fontSize": 24,
              "height": 150,
              "lineHeight": 30,
              "lines": 5,
              "width": 218,
              "x": 68,
              "y": 374,
            },
            "width": 258,
            "x": 48,
            "y": 296,
          },
          {
            "height": 286,
            "text": {
              "fontSize": 24,
              "height": 150,
              "lineHeight": 30,
              "lines": 5,
              "width": 218,
              "x": 350,
              "y": 374,
            },
            "width": 258,
            "x": 330,
            "y": 296,
          },
          {
            "height": 286,
            "text": {
              "fontSize": 24,
              "height": 150,
              "lineHeight": 30,
              "lines": 5,
              "width": 218,
              "x": 632,
              "y": 374,
            },
            "width": 258,
            "x": 612,
            "y": 296,
          },
          {
            "height": 286,
            "text": {
              "fontSize": 24,
              "height": 150,
              "lineHeight": 30,
              "lines": 5,
              "width": 218,
              "x": 914,
              "y": 374,
            },
            "width": 258,
            "x": 894,
            "y": 296,
          },
        ],
      }
    `)
  })

  it('matches the reference image', async () => {
    const actual = decodePng(await renderShareCard(longPoll(), [null, null, null, null]))
    // Vitest's own snapshot rules: rewritten with -u ("all"), written when missing on a local run ("new"),
    // and in CI ("none") it must already be committed.
    const mode = expect.getState().snapshotState.snapshotUpdateState
    if (mode === 'all' || (mode === 'new' && !existsSync(SNAPSHOT))) {
      mkdirSync(new URL('./__snapshots__/', import.meta.url), { recursive: true })
      writeFileSync(SNAPSHOT, await renderShareCard(longPoll(), [null, null, null, null]))
    }
    expect(existsSync(SNAPSHOT), 'tests/__snapshots__/share-card-long-question.png is missing (run vitest -u)').toBe(true)
    const reference = decodePng(readFileSync(SNAPSHOT))
    expect(diffShare(actual, reference)).toBeLessThan(0.005)
  })

  it('also fits closed, with the split, and with words too long for a line', async () => {
    const closed = longPoll({ status: 'closed', winner: 2, voteCount: 100, tally: [17, 23, 41, 19], closedAt: '2026-10-26T09:00:00.000Z' })
    expectNoOverflow(decodePng(await renderShareCard(closed, [null, null, null, null])), closed)

    const unbroken = longPoll({
      question: 'W'.repeat(200),
      options: LONG_OPTIONS.map(() => ({ text: 'M'.repeat(MAX_OPTION_TEXT_LENGTH), imageUrl: null })),
    })
    expectNoOverflow(decodePng(await renderShareCard(unbroken, [null, null, null, null])), unbroken)
  })
})
