// Poll share cards: the 1200×630 PNG a shared poll link unfurls as in chats and communities (the poll
// page's og:image and twitter:image). It shows the question and every option: the photo for an image
// option, the text for a text option. Once the poll has closed it marks the winner and each option's
// votes and share, except on a private poll, whose result only its creator sees.
//
//   /p/:id (generateMetadata) → og:image /p/:id/card?v=<status>
//   GET /p/:id/card → getPoll(id, stranger) → loadThumbnail per image option → renderShareCard → PNG
//
// The ?v tag changes when the poll closes, so a chat app that cached the open card fetches the result.
// Photos are loaded here rather than by the renderer: an uploaded photo comes straight from the
// database, and an image link is fetched once, with a timeout, the upload byte cap and the upload
// check, and never from plain http, an address or localhost (redirects included).
//
// Everything is placed at fixed coordinates (cardLayout), and every piece of text is clamped to the
// lines its box holds, so no question or option can run outside its box (tests/share-card.test.ts).
import { ImageResponse } from 'next/og'
import type { ReactElement } from 'react'
import { readCapped } from './http'
import { inspectImage, readImage, uploadedImageId } from './images'
import { MAX_IMAGE_BYTES, OPTION_LETTERS } from './limits'
import type { Option, PollView } from './polls'

export const CARD_SIZE = { width: 1200, height: 630 } as const

export const CARD_COLORS = {
  background: '#F4F2EE',
  tile: '#FFFFFF',
  ink: '#1C1B19',
  muted: '#6B6862',
  track: '#E8E4DC',
  placeholder: '#ECE8E1',
  winner: '#F2B705',
  /** One per option letter; A and B as on the site's own share card. */
  options: ['#E4572E', '#2E86AB', '#3F8F5A', '#7B5EA7'],
} as const

// Browsers and the CDN keep an open poll's card for 10 minutes and a closed one's (final) for a day,
// which also bounds how long a poll that moderation deleted can still unfurl.
const OPEN_CACHE = 'public, max-age=600, s-maxage=600'
const CLOSED_CACHE = 'public, max-age=86400, s-maxage=86400'

/** The card's address for a poll page's share tags; it changes when the poll closes. */
export const cardPath = (poll: Pick<PollView, 'id' | 'status'>) => `/p/${poll.id}/card?v=${poll.status}`

const labelOf = (option: Option, i: number) => option.text ?? `photo ${OPTION_LETTERS[i]}`

/** The og:image / twitter:image entry for a poll page. */
export function cardImage(poll: PollView) {
  const options = poll.options.map((o, i) => `${OPTION_LETTERS[i]}: ${labelOf(o, i)}`).join(', ')
  const winner = poll.winner === null ? '' : ` Winner: ${OPTION_LETTERS[poll.winner]}.`
  return {
    url: cardPath(poll),
    width: CARD_SIZE.width,
    height: CARD_SIZE.height,
    alt: `${poll.question || 'Which one?'} (${options})${winner}`,
  }
}

// ── Layout ─────────────────────────────────────────────────────────────────

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextBox extends Rect {
  fontSize: number
  lineHeight: number
  /** Lines the box holds; longer text ends in an ellipsis on the last one. */
  lines: number
}

export interface TileLayout extends Rect {
  /** The photo (or its placeholder) for an image option. */
  image: Rect | null
  text: TextBox | null
  /** Votes, share and bar, once a closed poll's result can be shown. */
  footer: Rect | null
}

export interface CardLayout {
  pad: number
  tilePadding: number
  header: Rect
  question: TextBox
  tiles: TileLayout[]
}

const PAD = 48
const INNER_WIDTH = CARD_SIZE.width - 2 * PAD
const HEADER_HEIGHT = 36
const QUESTION_TOP = PAD + HEADER_HEIGHT + 20
const QUESTION_GAP = 28
const TILE_GAP = 24
const TILE_PADDING = 20
const TILE_RADIUS = 24
const TILE_BORDER = 4
const BADGE = 44
const BADGE_GAP = 14
const CAPTION_GAP = 12
const FOOTER_GAP = 14
const FOOTER_LINE = 28
const BAR_GAP = 8
const BAR_HEIGHT = 14
const FOOTER_HEIGHT = FOOTER_LINE + BAR_GAP + BAR_HEIGHT

// Font sizes to try, largest first, and how much height the text may take.
const QUESTION_SIZES = [60, 52, 46, 40, 34]
const QUESTION_MAX_HEIGHT = 176
/** With photos, the question gives the photos room; the full question is in the link's title anyway. */
const QUESTION_MAX_HEIGHT_WITH_PHOTOS = 112
const OPTION_SIZES = [44, 38, 34, 30, 28, 26, 24, 22, 20]
const CAPTION_SIZES = [24, 22, 20]
const CAPTION_MAX_HEIGHT = 60

/**
 * A slightly generous average glyph width, as a share of the font size (the card's font is Geist
 * Regular, about 0.47 on mixed-case text). It only picks the font size; the line clamp is what
 * guarantees the fit, so text wider than this (all capitals) ends in an ellipsis instead.
 */
const CHAR_WIDTH = 0.5

/** How many lines `text` wraps to at `perLine` characters, breaking words longer than a line. */
function estimateLines(text: string, perLine: number): number {
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let length = word.length
    if (used > 0 && used + 1 + length <= perLine) {
      used += 1 + length
      continue
    }
    if (used > 0) lines++
    while (length > perLine) {
      lines++
      length -= perLine
    }
    used = length
  }
  return lines
}

/** The largest font size at which `text` fits `maxHeight`; else the smallest, clamped to the lines it holds. */
function fit(text: string, box: { x: number; y: number; width: number }, sizes: number[], maxHeight: number, ratio: number): TextBox {
  const sized = (fontSize: number, lines: number) => {
    const lineHeight = Math.round(fontSize * ratio)
    return { ...box, fontSize, lineHeight, lines, height: lines * lineHeight }
  }
  for (const fontSize of sizes) {
    const maxLines = Math.floor(maxHeight / Math.round(fontSize * ratio))
    const lines = estimateLines(text, Math.max(1, Math.floor(box.width / (fontSize * CHAR_WIDTH))))
    if (maxLines >= 1 && lines <= maxLines) return sized(fontSize, lines)
  }
  const smallest = sizes[sizes.length - 1]
  return sized(smallest, Math.max(1, Math.floor(maxHeight / Math.round(smallest * ratio))))
}

const showsResult = (poll: Pick<PollView, 'status' | 'tally'>) => poll.status !== 'open' && poll.tally !== null

/** Where everything on a poll's card goes, in card pixels. */
export function cardLayout(poll: Pick<PollView, 'question' | 'options' | 'status' | 'tally'>): CardLayout {
  const hasPhotos = poll.options.some((o) => o.imageUrl !== null)
  const question = fit(
    poll.question || 'Which one?',
    { x: PAD, y: QUESTION_TOP, width: INNER_WIDTH },
    QUESTION_SIZES,
    hasPhotos ? QUESTION_MAX_HEIGHT_WITH_PHOTOS : QUESTION_MAX_HEIGHT,
    1.2,
  )
  const top = question.y + question.height + QUESTION_GAP
  const height = CARD_SIZE.height - PAD - top
  const n = poll.options.length
  const width = (INNER_WIDTH - TILE_GAP * (n - 1)) / n
  const footerSpace = showsResult(poll) ? FOOTER_GAP + FOOTER_HEIGHT : 0
  const innerOf = (i: number) => {
    const x = PAD + i * (width + TILE_GAP)
    return { x: x + TILE_PADDING, y: top + TILE_PADDING, width: width - 2 * TILE_PADDING, height: height - 2 * TILE_PADDING }
  }
  // A text option's words, below its letter; and a photo's caption, below the photo.
  const textTop = top + TILE_PADDING + BADGE + BADGE_GAP
  const textHeight = top + height - TILE_PADDING - footerSpace - textTop
  const fitText = (text: string, i: number, sizes: number[]) => fit(text, { ...innerOf(i), y: textTop }, sizes, textHeight, 1.25)
  const fitCaption = (text: string, i: number, sizes: number[]) => fit(text, innerOf(i), sizes, CAPTION_MAX_HEIGHT, 1.25)
  // Every option's text is set in one size: the largest that all of them fit at.
  const shared = (sizer: (text: string, i: number, sizes: number[]) => TextBox, sizes: number[], photo: boolean) => {
    const fitted = poll.options.flatMap((o, i) => (o.text !== null && (o.imageUrl !== null) === photo ? [sizer(o.text, i, sizes).fontSize] : []))
    return sizes.filter((size) => size <= Math.min(...fitted))
  }
  const textSizes = shared(fitText, OPTION_SIZES, false)
  const captionSizes = shared(fitCaption, CAPTION_SIZES, true)

  const tiles = poll.options.map((option, i): TileLayout => {
    const inner = innerOf(i)
    const footer = footerSpace ? { x: inner.x, y: inner.y + inner.height - FOOTER_HEIGHT, width: inner.width, height: FOOTER_HEIGHT } : null
    let image: Rect | null = null
    let text: TextBox | null = null
    if (option.imageUrl !== null) {
      // The photo fills the tile, with the letter on it; the option's text (if any) is a caption below.
      const caption = option.text === null ? null : fitCaption(option.text, i, captionSizes)
      const imageHeight = inner.height - footerSpace - (caption ? CAPTION_GAP + caption.height : 0)
      image = { ...inner, height: imageHeight }
      if (caption) text = { ...caption, y: inner.y + imageHeight + CAPTION_GAP }
    } else {
      text = fitText(option.text ?? '', i, textSizes)
    }
    return { x: inner.x - TILE_PADDING, y: top, width, height, image, text, footer }
  })
  return { pad: PAD, tilePadding: TILE_PADDING, header: { x: PAD, y: PAD, width: INNER_WIDTH, height: HEADER_HEIGHT }, question, tiles }
}

// ── Drawing ────────────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The line top right: what the card asks for, or how the poll ended. */
function statusLine(poll: PollView): string {
  if (poll.status === 'open') return 'Help me choose: tap to vote'
  if (!showsResult(poll)) return 'Closed · result kept private'
  if (poll.status === 'no_result') return 'Closed · no votes came in'
  const votes = plural(poll.voteCount, 'vote')
  return poll.winner === null ? `Closed · ${votes} · it's a tie` : `Closed · ${votes} · ${OPTION_LETTERS[poll.winner]} wins`
}

const at = (r: Rect) => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height }) as const

/** Text clamped to its box's lines, ending in an ellipsis if it's longer. */
function Text({ box, color, children }: { box: TextBox; color: string; children: string }) {
  return (
    <div
      style={{
        ...at(box),
        display: 'block',
        lineClamp: box.lines,
        fontSize: box.fontSize,
        lineHeight: `${box.lineHeight}px`,
        color,
        wordBreak: 'break-word',
      }}
    >
      {children}
    </div>
  )
}

/**
 * The card as Satori draws it. `thumbnails[i]` is option i's photo as a data URI, or null (a text
 * option, or a photo that couldn't be loaded, which gets a plain "Photo" tile).
 */
export function shareCardElement(poll: PollView, thumbnails: (string | null)[]): ReactElement {
  const layout = cardLayout(poll)
  const tally = showsResult(poll) ? poll.tally : null
  const C = CARD_COLORS
  const parts: ReactElement[] = []
  for (const [i, tile] of layout.tiles.entries()) {
    const option = poll.options[i]
    const winner = tally !== null && poll.winner === i
    const src = thumbnails[i] ?? null
    // On a photo the letter and the winner mark sit over its top corners; on text, above it.
    const corner = tile.image ? 10 : 0
    parts.push(
      <div
        key={`tile-${i}`}
        style={{ ...at(tile), display: 'flex', background: C.tile, borderRadius: TILE_RADIUS, border: `${TILE_BORDER}px solid ${winner ? C.winner : C.tile}` }}
      />,
    )
    if (tile.image && src) {
      parts.push(<img key={`img-${i}`} src={src} width={tile.image.width} height={tile.image.height} style={{ ...at(tile.image), objectFit: 'cover', borderRadius: 16 }} />)
    } else if (tile.image) {
      parts.push(
        <div
          key={`img-${i}`}
          style={{ ...at(tile.image), display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16, background: C.placeholder, color: C.muted, fontSize: 26 }}
        >
          Photo
        </div>,
      )
    }
    parts.push(
      <div
        key={`badge-${i}`}
        style={{
          position: 'absolute',
          left: tile.x + TILE_PADDING + corner,
          top: tile.y + TILE_PADDING + corner,
          width: BADGE,
          height: BADGE,
          borderRadius: BADGE / 2,
          background: C.options[i],
          color: '#FFFFFF',
          fontSize: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {OPTION_LETTERS[i]}
      </div>,
    )
    if (winner) {
      parts.push(
        <div
          key={`winner-${i}`}
          style={{
            position: 'absolute',
            right: CARD_SIZE.width - (tile.x + tile.width - TILE_PADDING - corner),
            top: tile.y + TILE_PADDING + corner + 4,
            height: 36,
            padding: '0 14px',
            borderRadius: 18,
            background: C.winner,
            color: C.ink,
            fontSize: 22,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Winner
        </div>,
      )
    }
    if (tile.text && option.text !== null) {
      parts.push(
        <Text key={`text-${i}`} box={tile.text} color={C.ink}>
          {option.text}
        </Text>,
      )
    }
    if (tile.footer && tally !== null) {
      const votes = tally[i]
      const share = poll.voteCount ? Math.round((100 * votes) / poll.voteCount) : 0
      parts.push(
        <Text key={`votes-${i}`} box={{ ...tile.footer, height: FOOTER_LINE, fontSize: 22, lineHeight: FOOTER_LINE, lines: 1 }} color={C.ink}>
          {`${plural(votes, 'vote')} · ${share}%`}
        </Text>,
        <div
          key={`bar-${i}`}
          style={{ ...at({ ...tile.footer, y: tile.footer.y + FOOTER_LINE + BAR_GAP, height: BAR_HEIGHT }), display: 'flex', borderRadius: BAR_HEIGHT / 2, background: C.track }}
        >
          <div style={{ width: `${share}%`, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, background: C.options[i] }} />
        </div>,
      )
    }
  }
  return (
    <div style={{ display: 'flex', position: 'relative', width: CARD_SIZE.width, height: CARD_SIZE.height, background: C.background }}>
      <div style={{ ...at(layout.header), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 30, color: C.ink }}>tiebreak</div>
        <div style={{ fontSize: 26, color: C.muted }}>{statusLine(poll)}</div>
      </div>
      <Text box={layout.question} color={C.ink}>
        {poll.question || 'Which one?'}
      </Text>
      {parts}
    </div>
  )
}

/** The card as PNG bytes. */
export async function renderShareCard(poll: PollView, thumbnails: (string | null)[]): Promise<Uint8Array> {
  const response = new ImageResponse(shareCardElement(poll, thumbnails), { ...CARD_SIZE })
  return new Uint8Array(await response.arrayBuffer())
}

// ── Option photos ──────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 3000
const MAX_REDIRECTS = 3
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Whether the card's server may fetch a link: https on the default port, to a named host. Addresses
 * (the URL parser turns every IPv4 spelling into dotted form, and IPv6 comes in brackets), localhost
 * and names without a dot never are, so a poll can't point the server at its own network.
 */
function fetchable(url: URL): boolean {
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || IPV4.test(host) || !host.includes('.')) return false
  return !['.localhost', '.local', '.internal'].some((suffix) => host.endsWith(suffix))
}

/** An image link's bytes (at most MAX_IMAGE_BYTES), following up to MAX_REDIRECTS fetchable redirects; else null. */
async function fetchImageBytes(start: URL, timeoutMs: number): Promise<Uint8Array | null> {
  const signal = AbortSignal.timeout(timeoutMs)
  let url = start
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!fetchable(url)) return null
      const res = await fetch(url.href, { redirect: 'manual', signal, headers: { accept: 'image/jpeg,image/png,image/webp' } })
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!res.ok) await res.body?.cancel().catch(() => {})
      if (location) {
        url = new URL(location, url)
        continue
      }
      if (!res.ok) return null
      const bytes = await readCapped(res, MAX_IMAGE_BYTES)
      if (!bytes) await res.body?.cancel().catch(() => {}) // declared over the cap: never read
      return bytes
    }
  } catch {
    // Timed out, refused or unreachable: the option gets a plain tile.
  }
  return null
}

const dataUri = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

/**
 * An option's photo as a data URI for the card, or null if it can't be had. A photo uploaded here (its
 * URL on one of `ownOrigins`) is read from the database; an image link is fetched and must pass the same
 * check as an upload (a JPEG, PNG or WebP by its bytes, within the pixel cap).
 */
export async function loadThumbnail(imageUrl: string, ownOrigins: string[], { timeoutMs = FETCH_TIMEOUT_MS } = {}): Promise<string | null> {
  let url: URL
  try {
    url = new URL(imageUrl)
  } catch {
    return null
  }
  for (const origin of ownOrigins) {
    const id = uploadedImageId(url, origin)
    if (id !== null) {
      const photo = await readImage(id)
      return photo ? dataUri(photo.type, photo.data) : null
    }
  }
  const bytes = await fetchImageBytes(url, timeoutMs)
  if (!bytes) return null
  const image = inspectImage(bytes)
  return image.ok ? dataUri(image.type, image.bytes) : null
}

/** GET /p/:id/card's answer: the poll's card as a PNG, with its photos where they load. */
export async function shareCardResponse(poll: PollView, ownOrigins: string[]): Promise<Response> {
  const thumbnails = await Promise.all(poll.options.map((o) => (o.imageUrl ? loadThumbnail(o.imageUrl, ownOrigins) : null)))
  let png: Uint8Array
  try {
    png = await renderShareCard(poll, thumbnails)
  } catch {
    // A photo whose header checks out but whose pixels the renderer can't decode: plain tiles instead.
    png = await renderShareCard(poll, poll.options.map(() => null))
  }
  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.byteLength),
      'cache-control': poll.status === 'open' ? OPEN_CACHE : CLOSED_CACHE,
      'x-content-type-options': 'nosniff',
    },
  })
}
