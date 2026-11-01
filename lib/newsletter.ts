// Vote from your newsletter (growth, 2026-11-01): a poll's options as blocks its creator pastes into a newsletter or
// email, each option linking to its own vote. Opening a link never votes, because email link scanners and
// prefetchers open links too:
//
//   reader taps B in the email ─▶ GET /polls/<id>?pick=B&src=newsletter ─307─▶ /p/<id>?pick=B&src=newsletter
//     (no vote, no account)          (app/polls/[id]/route.ts)                   B preselected, one "Confirm vote"
//                                                                                ─▶ POST /polls/<id>/votes, as before
//
// The landing's visit beacon carries the poll's path and source "newsletter" (lib/beacon.ts).
// Pure string building, shared by the poll page (client) and the route; nothing here touches the database.
import type { Source } from './beacon'
import { OPTION_LETTERS } from './limits'
import type { Option } from './polls'

export const NEWSLETTER_SOURCE: Source = 'newsletter'

export type BlockPoll = { id: string; question: string; options: Option[] }

/** A link's `pick` (a letter, either case) as an option index; null unless it's one of `optionCount` options. */
export function pickIndex(value: unknown, optionCount: number): number | null {
  if (typeof value !== 'string' || value.length !== 1) return null
  const index = OPTION_LETTERS.indexOf(value.toUpperCase())
  return index >= 0 && index < optionCount ? index : null
}

/** One option's vote link: `<origin>/polls/<id>?pick=<letter>&src=newsletter`. */
export function voteLink(origin: string, pollId: string, option: number): string {
  return `${origin}/polls/${pollId}?pick=${OPTION_LETTERS[option]}&src=${NEWSLETTER_SOURCE}`
}

/**
 * Where GET /polls/<id> sends a vote link: the poll page, passing on only a letter A–D and a known source.
 * `id` must already be a poll id (lib/polls.ts isPollId), since it goes into a Location header.
 */
export function pollPageFor(id: string, query: URLSearchParams): string {
  const pass = new URLSearchParams()
  const letter = pickIndex(query.get('pick'), OPTION_LETTERS.length)
  if (letter !== null) pass.set('pick', OPTION_LETTERS[letter])
  if (query.get('src') === NEWSLETTER_SOURCE) pass.set('src', NEWSLETTER_SOURCE)
  const search = pass.toString()
  return `/p/${id}${search ? `?${search}` : ''}`
}

const questionOf = (poll: BlockPoll) => poll.question || 'Which one?' // as the poll page's heading reads
const labelOf = (option: Option, i: number) => option.text ?? `Option ${OPTION_LETTERS[i]}`
const altOf = (option: Option, i: number) => (option.text === null ? `Option ${OPTION_LETTERS[i]}` : `${OPTION_LETTERS[i]}: ${option.text}`)
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const FOOTNOTE = "Tap the one you'd pick, then confirm your vote on tiebreak."

/** An option's image as a normalised absolute http(s) URL, or null (the link then wraps its text only). */
function imageOf(option: Option): string | null {
  if (!option.imageUrl) return null
  try {
    const url = new URL(option.imageUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Email clients drop <style> and classes, so every style is inline; sizes in px, as email HTML expects.
const BLOCK_WIDTH = 600
const CELL_PAD = 6
const INK = '#1d1d1f'
const MUTED = '#6e6e73'
const LINE = '#d2d2d7'
const ACCENT = '#ff5a36'
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Three options sit in one row; two or four, two to a row (four in a row is too small on a phone). */
const columnsFor = (count: number) => (count === 3 ? 3 : 2)

function optionCell(poll: BlockPoll, origin: string, option: Option, i: number, columns: number): string {
  const letter = OPTION_LETTERS[i]
  const image = imageOf(option)
  const imageWidth = Math.floor(BLOCK_WIDTH / columns) - 2 * CELL_PAD
  const label = escapeHtml(oneLine(labelOf(option, i)))
  const face = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(oneLine(altOf(option, i)))}" width="${imageWidth}" style="display:block;width:100%;max-width:${imageWidth}px;height:auto;margin:0 auto;border:0;border-radius:8px;">` +
      `<span style="display:block;padding:8px 0 0;font-size:15px;line-height:20px;color:${INK};"><b>${letter}</b> ${option.text === null ? '' : label}</span>`
    : `<span style="display:block;padding:18px 8px;border:2px solid ${LINE};border-radius:8px;font-size:16px;line-height:22px;color:${INK};"><b>${letter}</b> ${label}</span>`
  return (
    `<td width="${Math.floor(100 / columns)}%" valign="top" style="width:${Math.floor(100 / columns)}%;padding:${CELL_PAD}px;vertical-align:top;text-align:center;">` +
    `<a href="${escapeHtml(voteLink(origin, poll.id, i))}" style="display:block;color:${INK};text-decoration:none;">` +
    face +
    `<span style="display:inline-block;margin-top:8px;padding:8px 16px;border-radius:8px;background:${ACCENT};color:#ffffff;font-size:14px;line-height:18px;font-weight:bold;">Vote ${letter}</span>` +
    `</a></td>`
  )
}

/**
 * The email block: one <table> with inline styles (no <script>, <style> or classes), and one <a href> per option
 * wrapping its image (or its text), all absolute URLs. Pastes into an email as it is, or into an HTML/code block.
 */
export function newsletterHtml(poll: BlockPoll, origin: string): string {
  const columns = columnsFor(poll.options.length)
  const rows: string[] = []
  for (let start = 0; start < poll.options.length; start += columns) {
    const cells = poll.options.slice(start, start + columns).map((option, j) => optionCell(poll, origin, option, start + j, columns))
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  const wide = `colspan="${columns}"`
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${BLOCK_WIDTH}px;margin:0 auto;border-collapse:collapse;font-family:${FONT};color:${INK};">` +
    `<tr><td ${wide} style="padding:0 ${CELL_PAD}px 10px;font-size:20px;line-height:26px;font-weight:bold;text-align:center;color:${INK};">${escapeHtml(oneLine(questionOf(poll)))}</td></tr>` +
    rows.join('') +
    `<tr><td ${wide} style="padding:10px ${CELL_PAD}px 0;font-size:13px;line-height:18px;text-align:center;color:${MUTED};">${escapeHtml(FOOTNOTE)}</td></tr>` +
    `</table>`
  )
}

/** Markdown link and image text: brackets and emphasis characters escaped, on one line. */
const escapeMarkdown = (text: string) => oneLine(text).replace(/([\\[\]*_`])/g, '\\$1')
/** A URL inside Markdown's ( ): spaces and parentheses percent-encoded so the link can't end early. */
const markdownUrl = (url: string) => url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')

/**
 * The Markdown/plain block, for Substack and similar editors: per option, one image line (when it has a photo) and
 * one link line, each its own paragraph.
 */
export function newsletterMarkdown(poll: BlockPoll, origin: string): string {
  const lines = [`**${escapeMarkdown(questionOf(poll))}**`]
  poll.options.forEach((option, i) => {
    const image = imageOf(option)
    if (image) lines.push(`![${escapeMarkdown(altOf(option, i))}](${markdownUrl(image)})`)
    const vote = option.text === null ? `Vote ${OPTION_LETTERS[i]}` : `Vote ${OPTION_LETTERS[i]}: ${option.text}`
    lines.push(`[${escapeMarkdown(vote)}](${markdownUrl(voteLink(origin, poll.id, i))})`)
  })
  lines.push(FOOTNOTE)
  return lines.join('\n\n')
}
