// Poll share cards: the 1200×630 picture chat apps and social sites show when someone
// shares a poll's link (og:image and twitter:image on /p/:id, drawn by GET /p/:id/card).
// It shows the question and every option (a photo option's thumbnail, a text option's
// text) and, once the poll has closed, the winner and the vote split.
//
//   GET /p/:id/card → getPoll(id, nobody) → loadThumbnails → pollCardElement → PNG
//
// Drawn with next/og (satori lays out the flexbox, resvg paints it) in the bundled Geist
// font. Every box has a fixed size and every text a line clamp, so a long question or
// option ends in an ellipsis instead of running off the card. Each text also clips to its
// box: satori always puts at least one more letter before the ellipsis, which can stick
// out when a single unbroken word (a pasted link) fills the line. Photos come from tiebreak's
// own database; image links are fetched once per drawing, from public https addresses only.
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { ImageResponse } from 'next/og'
import type { ReactElement } from 'react'
import { readCapped } from './http'
import { inspectImage, readImage, uploadedImageId, type ImageType } from './images'
import { MAX_IMAGE_BYTES, OPTION_LETTERS } from './limits'
import type { Option, PollView, Status } from './polls'

const WIDTH = 1200
const HEIGHT = 630
const PAD = 48
const OPTIONS_HEIGHT = 270

/** Where everything sits on the card (tests read the pixels in these boxes). Colours are app/globals.css's. */
export const CARD = {
  width: WIDTH,
  height: HEIGHT,
  pad: PAD,
  header: { top: PAD, height: 40 },
  question: { top: 104, height: 168 },
  options: { top: HEIGHT - PAD - OPTIONS_HEIGHT, height: OPTIONS_HEIGHT },
  gap: 20,
  tileBorder: 4,
  tilePad: 16,
  colors: {
    background: '#f5f5f7',
    tile: '#ffffff',
    ink: '#1d1d1f',
    muted: '#6e6e73',
    line: '#d2d2d7',
    accent: '#ff5a36',
    win: '#1f9d55',
  },
} as const

const C = CARD.colors
const CONTENT_WIDTH = WIDTH - 2 * PAD
const TILE_INSET = CARD.tileBorder + CARD.tilePad
const TILE_INNER_HEIGHT = OPTIONS_HEIGHT - 2 * TILE_INSET
const BADGE = 34
const ROW_GAP = 10
const WINNER_PILL = 96
const RESULT_HEIGHT = 46 // the percentage line (30), a gap (6), the bar (10)
const BAR_HEIGHT = 10

/** The question's type size for its length: big when short, smaller with more lines when long. */
const QUESTION_TYPE = [
  { upTo: 40, size: 60 },
  { upTo: 80, size: 48 },
  { upTo: 140, size: 40 },
  { upTo: Infinity, size: 34 },
]

/** A text option's type size, by how many options share the row. */
const OPTION_TYPE: Record<number, { size: number; line: number }> = {
  2: { size: 34, line: 42 },
  3: { size: 28, line: 35 },
  4: { size: 24, line: 30 },
}

/**
 * Browsers and the CDN may keep a card this long. An open poll's card changes when it
 * closes; a closed one never does (until moderation deletes the poll, which the day bounds).
 */
export const CARD_CACHE: Record<Status, string> = {
  open: 'public, max-age=300, s-maxage=300',
  closed: 'public, max-age=86400, s-maxage=86400',
  no_result: 'public, max-age=86400, s-maxage=86400',
}

/** A poll's card. `v` changes when the poll closes, so a crawler's cached open card isn't shown as the result. */
export const cardPath = (poll: Pick<PollView, 'id' | 'status'>) => `/p/${poll.id}/card?v=${poll.status}`

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The options' tiles, left to right: equal whole-pixel widths, spread across the card. */
export function tileBoxes(count: number): Box[] {
  const width = Math.floor((CONTENT_WIDTH - CARD.gap * (count - 1)) / count)
  const gap = count > 1 ? (CONTENT_WIDTH - count * width) / (count - 1) : 0
  return Array.from({ length: count }, (_, i) => ({ x: PAD + i * (width + gap), y: CARD.options.top, width, height: OPTIONS_HEIGHT }))
}

/** The track of a tile's result bar (at the bottom of a closed poll's tile). */
export function resultBarBox(tile: Box): Box {
  return { x: tile.x + TILE_INSET, y: tile.y + tile.height - TILE_INSET - BAR_HEIGHT, width: tile.width - 2 * TILE_INSET, height: BAR_HEIGHT }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const questionOf = (poll: Pick<PollView, 'question'>) => poll.question || 'Which one?'

type Shown =
  | { kind: 'open' }
  | { kind: 'no_votes' }
  /** Closed, but only the creator may see the result (a private poll), and the card is for everyone. */
  | { kind: 'private' }
  | { kind: 'split'; tally: number[]; winner: number | null; total: number }

function shownResult(poll: PollView): Shown {
  if (poll.status === 'open') return { kind: 'open' }
  if (poll.status === 'no_result' || poll.voteCount === 0) return { kind: 'no_votes' }
  if (poll.tally === null) return { kind: 'private' }
  return { kind: 'split', tally: poll.tally, winner: poll.winner, total: poll.voteCount }
}

function statusLine(poll: PollView, shown: Shown) {
  switch (shown.kind) {
    case 'open':
      return 'Tap to vote'
    case 'no_votes':
      return 'Closed · No votes came in'
    case 'private':
      return 'Closed · The result is private'
    case 'split':
      return `Closed · ${plural(poll.voteCount, 'vote')}${shown.winner === null ? " · It's a tie" : ''}`
  }
}

/** The card's alt text: the question, the options, and the winner once there is one. */
export function cardAlt(poll: PollView) {
  const options = poll.options.map((o, i) => `${OPTION_LETTERS[i]}: ${o.text ?? 'a photo'}`).join(', ')
  const shown = shownResult(poll)
  const winner = shown.kind === 'split' && shown.winner !== null ? `. Winner: ${OPTION_LETTERS[shown.winner]}` : ''
  return `${questionOf(poll)} (${options})${winner}`
}

/** A photo to draw in an option's tile. */
export interface Thumbnail {
  type: ImageType
  /** The bytes, as satori takes them: a data: URL would sit in its 500-entry image cache. */
  data: ArrayBuffer
  orientation: number
}

/** The card as satori's flexbox tree. `thumbs[i]` is option i's photo, or null to draw its text. */
export function pollCardElement(poll: PollView, thumbs: (Thumbnail | null)[]): ReactElement {
  const shown = shownResult(poll)
  const question = questionOf(poll)
  const type = QUESTION_TYPE.find((t) => question.length <= t.upTo)!
  const line = Math.round(type.size * 1.2)
  const tiles = tileBoxes(poll.options.length)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: WIDTH, height: HEIGHT, padding: PAD, background: C.background }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: CARD.header.height }}>
        <div style={{ fontSize: 32, color: C.accent, letterSpacing: -1 }}>tiebreak</div>
        <div style={{ fontSize: 24, color: C.muted }}>{statusLine(poll, shown)}</div>
      </div>
      <div style={{ display: 'flex', marginTop: CARD.question.top - PAD - CARD.header.height, height: CARD.question.height }}>
        <div
          style={{
            display: 'block',
            width: CONTENT_WIDTH,
            fontSize: type.size,
            lineHeight: `${line}px`,
            lineClamp: Math.floor(CARD.question.height / line),
            overflow: 'hidden',
            color: C.ink,
            wordBreak: 'break-word',
          }}
        >
          {question}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: CARD.options.top - CARD.question.top - CARD.question.height,
          height: OPTIONS_HEIGHT,
        }}
      >
        {poll.options.map((option, i) => (
          <Tile key={i} option={option} index={i} box={tiles[i]} thumb={thumbs[i] ?? null} shown={shown} count={poll.options.length} />
        ))}
      </div>
    </div>
  )
}

function Tile({
  option,
  index,
  box,
  thumb,
  shown,
  count,
}: {
  option: Option
  index: number
  box: Box
  thumb: Thumbnail | null
  shown: Shown
  count: number
}) {
  const split = shown.kind === 'split' ? shown : null
  const won = split?.winner === index
  const innerWidth = box.width - 2 * TILE_INSET
  const middle = TILE_INNER_HEIGHT - BADGE - ROW_GAP - (split ? ROW_GAP + RESULT_HEIGHT : 0)
  const text = OPTION_TYPE[count] ?? OPTION_TYPE[4]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: box.width,
        height: box.height,
        padding: CARD.tilePad,
        background: C.tile,
        border: `${CARD.tileBorder}px solid ${won ? C.win : C.line}`,
        borderRadius: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', height: BADGE }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: BADGE,
            height: BADGE,
            borderRadius: BADGE / 2,
            background: C.accent,
            color: '#ffffff',
            fontSize: 20,
          }}
        >
          {OPTION_LETTERS[index]}
        </div>
        {thumb && option.text ? (
          <div
            style={{
              display: 'block',
              width: innerWidth - BADGE - ROW_GAP - (won ? WINNER_PILL + 8 : 0),
              marginLeft: ROW_GAP,
              fontSize: 22,
              lineHeight: '28px',
              lineClamp: 1,
              overflow: 'hidden',
              color: C.ink,
              wordBreak: 'break-word',
            }}
          >
            {option.text}
          </div>
        ) : (
          <div style={{ display: 'flex', flexGrow: 1 }} />
        )}
        {won && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: WINNER_PILL,
              height: 30,
              marginLeft: 8,
              borderRadius: 15,
              background: C.win,
              color: '#ffffff',
              fontSize: 18,
            }}
          >
            Winner
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: thumb ? 'stretch' : 'center', marginTop: ROW_GAP, height: middle }}>
        {thumb ? (
          <Photo thumb={thumb} width={innerWidth} height={middle} />
        ) : (
          <div
            style={{
              display: 'block',
              width: innerWidth,
              fontSize: text.size,
              lineHeight: `${text.line}px`,
              lineClamp: Math.floor(middle / text.line),
              overflow: 'hidden',
              color: option.text ? C.ink : C.muted,
              wordBreak: 'break-word',
            }}
          >
            {option.text ?? 'Photo'}
          </div>
        )}
      </div>
      {split && <Split votes={split.tally[index] ?? 0} total={split.total} won={won} />}
    </div>
  )
}

// EXIF orientation → the turn that makes the photo upright. The mirrored ones (2, 4, 5, 7,
// rare outside selfie cameras) get their turn without the mirror: upright, if flipped.
const TURN: Record<number, number> = { 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270 }

/** A photo filling its box (cropped to fit), turned upright the way a browser shows it. */
function Photo({ thumb, width, height }: { thumb: Thumbnail; width: number; height: number }) {
  const turn = TURN[thumb.orientation] ?? 0
  const sideways = turn === 90 || turn === 270
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width,
        height,
        overflow: 'hidden',
        borderRadius: 10,
        background: C.background,
      }}
    >
      <img
        // satori reads an ArrayBuffer src as the image's bytes (React's types only know strings).
        src={thumb.data as unknown as string}
        alt=""
        width={sideways ? height : width}
        height={sideways ? width : height}
        style={{ objectFit: 'cover', ...(turn ? { transform: `rotate(${turn}deg)` } : {}) }}
      />
    </div>
  )
}

function Split({ votes, total, won }: { votes: number; total: number; won: boolean }) {
  const pct = total ? Math.round((100 * votes) / total) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: ROW_GAP, height: RESULT_HEIGHT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: 30 }}>
        <div style={{ fontSize: 26, color: C.ink }}>{`${pct}%`}</div>
        <div style={{ fontSize: 20, color: C.muted }}>{plural(votes, 'vote')}</div>
      </div>
      <div style={{ display: 'flex', marginTop: 6, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, background: C.background }}>
        <div style={{ display: 'flex', width: `${pct}%`, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, background: won ? C.win : C.muted }} />
      </div>
    </div>
  )
}

// ── Photos for the card ────────────────────────────────────────────────────

/** What resvg can paint. A WebP comes out blank, so a WebP option shows its letter and text instead. */
const DRAWABLE: ReadonlySet<ImageType> = new Set(['image/jpeg', 'image/png'])

/** Photo pixels one card may decode (4 bytes each, whole, in memory); options past it show their text. */
const CARD_PIXEL_BUDGET = 100_000_000

/** A crawler waits a few seconds for a card; a slow image host shouldn't make it give up on the whole card. */
const LINK_TIMEOUT_MS = 4000
const MAX_REDIRECTS = 3

/**
 * Each option's photo, or null (no image, or one that can't be had or drawn). Photos uploaded
 * here are read from the database (`ownOrigins`: the addresses this site answers on); image
 * links are fetched (see fetchLinkedImage). Either way the bytes must check out as a JPEG or PNG.
 */
export async function loadThumbnails(options: Option[], ownOrigins: string[]): Promise<(Thumbnail | null)[]> {
  const images = await Promise.all(options.map((o) => (o.imageUrl ? imageOf(o.imageUrl, ownOrigins).catch(() => null) : null)))
  let pixels = 0
  return images.map((image) => {
    if (!image) return null
    pixels += image.width * image.height
    if (pixels > CARD_PIXEL_BUDGET) return null
    const data = image.bytes.buffer.slice(image.bytes.byteOffset, image.bytes.byteOffset + image.bytes.byteLength) as ArrayBuffer
    return { type: image.type, data, orientation: image.orientation }
  })
}

async function imageOf(imageUrl: string, ownOrigins: string[]) {
  const url = new URL(imageUrl)
  const uploaded = ownOrigins.map((origin) => uploadedImageId(url, origin)).find((id) => id !== null)
  const bytes = uploaded ? ((await readImage(uploaded))?.data ?? null) : await fetchLinkedImage(url)
  if (!bytes) return null
  const image = inspectImage(bytes)
  return image.ok && DRAWABLE.has(image.type) ? image : null
}

// Addresses a server-side fetch must never reach (SSRF): "this" network, private ranges,
// carrier-grade NAT, loopback, link-local (cloud metadata), IETF and benchmarking ranges,
// multicast and reserved; IPv6 unspecified, loopback, NAT64, unique-local, link-local and
// multicast. BlockList also matches IPv4-mapped IPv6 (::ffff:10.0.0.1) against the IPv4 rules.
const BLOCKED = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6')
}

/** True when every address a host name resolves to (or the address it is) is public. */
async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false
  const family = isIP(host)
  const addresses = family ? [{ address: host, family }] : await lookup(host, { all: true }).catch(() => [])
  return addresses.length > 0 && addresses.every((a) => !BLOCKED.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))
}

/**
 * An image link's bytes, or null: https only, to public addresses only (checked again at
 * every redirect, at most 3), within LINK_TIMEOUT_MS, and at most 5 MB like an upload.
 * No cookies or credentials are sent. The host can still swap its DNS answer between the
 * check and the fetch; what comes back is only ever drawn as a JPEG or PNG on the card.
 */
async function fetchLinkedImage(link: URL): Promise<Uint8Array | null> {
  const signal = AbortSignal.timeout(LINK_TIMEOUT_MS)
  let url = link
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' || !(await isPublicHost(url.hostname))) return null
    const res = await fetch(url, { redirect: 'manual', signal, headers: { accept: 'image/jpeg,image/png' } })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel()
      url = new URL(location, url)
      continue
    }
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    return readCapped(res, MAX_IMAGE_BYTES)
  }
  return null
}

// ── Drawing ────────────────────────────────────────────────────────────────

async function draw(element: ReactElement): Promise<Uint8Array> {
  return new Uint8Array(await new ImageResponse(element, { width: WIDTH, height: HEIGHT }).arrayBuffer())
}

/** The poll's card as PNG bytes. A photo the renderer can't read costs only the photos, not the card. */
export async function pollCardPng(poll: PollView, ownOrigins: string[]): Promise<Uint8Array> {
  const thumbs = await loadThumbnails(poll.options, ownOrigins)
  try {
    return await draw(pollCardElement(poll, thumbs))
  } catch (error) {
    if (!thumbs.some(Boolean)) throw error
    console.error(`Share card for poll ${poll.id}: drawing it without photos.`, error)
    return draw(pollCardElement(poll, thumbs.map(() => null)))
  }
}
