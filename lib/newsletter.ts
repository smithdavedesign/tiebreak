// Vote from your newsletter (GROWTH.md, 2026-11-03): the blocks a poll's creator pastes into an email or a post,
// with one link per option, and how tiebreak reads those links when a reader taps one.
//
//   reader taps B ── GET /polls/:id?pick=B&src=newsletter ──▶ 303 ──▶ /p/:id?pick=B&src=newsletter
//   (records nothing, so email link scanners and prefetchers,         B preselected, one "Confirm vote" button
//    which only GET, can't vote)                                        │ tapped
//                                                                       ▼
//                                                       POST /polls/:id/votes { option: 1 }: the one vote
//
// The landing's visit carries the poll page's path and source "newsletter" (app/visit-beacon.tsx).
// Pure functions with no server imports: the poll page's client components use them too.
import { OPTION_LETTERS } from './limits'
import type { Option, PollView } from './polls'

/** The `src` of the blocks' links, which the visit beacon passes on as the landing visit's `source`. */
export const NEWSLETTER_SOURCE = 'newsletter'

/** A poll page's path (the id shape of lib/polls.ts): the only page whose visit carries the source. */
const POLL_PAGE_PATH = /^\/p\/[A-Za-z0-9_-]{12}$/

/** The line under the options in both blocks. */
const HOW_TO_VOTE = "Tap the one you'd pick, then confirm your vote on tiebreak."

// The site's own colours (app/globals.css), written into the email block since email clients drop stylesheets.
const INK = '#1d1d1f'
const MUTED = '#6e6e73'
const LINE = '#d2d2d7'
const ACCENT = '#ff5a36'
/** An option's picture in the email block, at most this wide (in CSS pixels, and in Outlook's `width`). */
const IMAGE_PX = 160

export type BlockPoll = Pick<PollView, 'id' | 'question' | 'options'>

export interface NewsletterBlocks {
  /** For email: a <table> with inline styles, one <a href> per option around its image or text. */
  emailHtml: string
  /** For Substack and similar editors: per option, an image line (the image links to its vote) and a link line. */
  markdown: string
  /** The Markdown as HTML, copied alongside it, so a rich editor gets pictures and links rather than the source. */
  markdownHtml: string
}

const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

/** How the blocks and the confirm step name an option: "B · Night ferry", or "Option B" with no text. */
export function optionName(option: Option, index: number): string {
  const text = squash(option.text)
  return text ? `${OPTION_LETTERS[index]} · ${text}` : `Option ${OPTION_LETTERS[index]}`
}

/** An option's link text: "Vote B · Night ferry", or "Vote B". */
function voteLabel(option: Option, index: number): string {
  const text = squash(option.text)
  return text ? `Vote ${OPTION_LETTERS[index]} · ${text}` : `Vote ${OPTION_LETTERS[index]}`
}

/** One option's link in the blocks: it opens the poll with that option picked, and counts nothing by itself. */
export function optionLink(origin: string, pollId: string, index: number): string {
  return `${origin}/polls/${encodeURIComponent(pollId)}?pick=${OPTION_LETTERS[index]}&src=${NEWSLETTER_SOURCE}`
}

/** The option a `?pick=` letter (either case) names on a poll with `optionCount` options, or null. */
export function pickedOption(pick: unknown, optionCount: number): number | null {
  if (typeof pick !== 'string' || pick.length !== 1) return null
  const index = OPTION_LETTERS.indexOf(pick.toUpperCase())
  return index >= 0 && index < optionCount ? index : null
}

/**
 * Where GET /polls/:id sends a block's link (a query with `pick` or `src`): the poll's page with just those two;
 * null for any other query, which keeps the JSON answer.
 */
export function landingPage(pollId: string, query: URLSearchParams): string | null {
  if (!query.has('pick') && !query.has('src')) return null
  const kept = new URLSearchParams()
  for (const name of ['pick', 'src']) {
    const value = query.get(name)
    if (value !== null) kept.set(name, value)
  }
  return `/p/${encodeURIComponent(pollId)}?${kept}`
}

/** The `source` a page's visit carries: "newsletter" on a poll page opened from a block's link, else null. */
export function visitSource(pathname: string, search: string): typeof NEWSLETTER_SOURCE | null {
  return POLL_PAGE_PATH.test(pathname) && new URLSearchParams(search).get('src') === NEWSLETTER_SOURCE
    ? NEWSLETTER_SOURCE
    : null
}

/** An option's image as an absolute http(s) address, or null. The API stores only those; this is belt and braces. */
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
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Text that Markdown shows as written: no links, emphasis, code or HTML made from the poll's own words. */
const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>]/g, '\\$&')

/** An address inside a Markdown link's parentheses (URL.href already encodes spaces). */
const markdownUrl = (url: string) => url.replace(/\(/g, '%28').replace(/\)/g, '%29')

function emailHtml(poll: BlockPoll, origin: string): string {
  // Two or three options side by side; four as two rows of two, so each stays tappable on a phone.
  const perRow = poll.options.length === 4 ? 2 : poll.options.length
  const width = Math.floor(100 / perRow)
  const cells = poll.options.map((option, i) => {
    const image = imageOf(option)
    const text = squash(option.text)
    const picture = image
      ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(optionName(option, i))}" width="${IMAGE_PX}" style="display:block;width:100%;max-width:${IMAGE_PX}px;height:auto;margin:0 auto 8px;border:0;border-radius:8px;">`
      : ''
    const words = text
      ? `<span style="display:block;padding:${image ? '0' : '20px 4px'};font-size:15px;line-height:1.3;">${escapeHtml(text)}</span>`
      : ''
    const button = `<span style="display:inline-block;margin-top:8px;padding:8px 14px;border-radius:8px;background:${ACCENT};color:#ffffff;font-size:14px;font-weight:bold;">Vote ${OPTION_LETTERS[i]}</span>`
    return (
      `<td width="${width}%" style="width:${width}%;padding:6px;vertical-align:top;text-align:center;">` +
      `<a href="${escapeHtml(optionLink(origin, poll.id, i))}" style="display:block;padding:8px;border:1px solid ${LINE};border-radius:12px;color:${INK};text-decoration:none;">` +
      `${picture}${words}${button}</a></td>`
    )
  })
  const rows: string[] = []
  for (let i = 0; i < cells.length; i += perRow) rows.push(`<tr>${cells.slice(i, i + perRow).join('')}</tr>`)
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;color:${INK};">`,
    `<tr><td colspan="${perRow}" style="padding:0 6px 8px;font-size:20px;font-weight:bold;line-height:1.3;">${escapeHtml(squash(poll.question) || 'Which one?')}</td></tr>`,
    ...rows,
    `<tr><td colspan="${perRow}" style="padding:8px 6px 0;font-size:13px;line-height:1.4;color:${MUTED};">${escapeHtml(HOW_TO_VOTE)}</td></tr>`,
    '</table>',
  ].join('\n')
}

/** The paragraphs of the Markdown block, each as [Markdown, HTML]. */
function postParagraphs(poll: BlockPoll, origin: string): [string, string][] {
  const question = squash(poll.question) || 'Which one?'
  const paragraphs: [string, string][] = [
    [`**${escapeMarkdown(question)}**`, `<p><strong>${escapeHtml(question)}</strong></p>`],
    [escapeMarkdown(HOW_TO_VOTE), `<p>${escapeHtml(HOW_TO_VOTE)}</p>`],
  ]
  poll.options.forEach((option, i) => {
    const link = optionLink(origin, poll.id, i)
    const image = imageOf(option)
    const name = optionName(option, i)
    if (image) {
      paragraphs.push([
        `[![${escapeMarkdown(name)}](${markdownUrl(image)})](${link})`,
        `<p><a href="${escapeHtml(link)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" width="${IMAGE_PX * 2}"></a></p>`,
      ])
    }
    const label = voteLabel(option, i)
    paragraphs.push([`[${escapeMarkdown(label)}](${link})`, `<p><a href="${escapeHtml(link)}">${escapeHtml(label)}</a></p>`])
  })
  return paragraphs
}

/** The two blocks of a poll's "Get votes from your newsletter" panel, with links on `origin` (this site). */
export function newsletterBlocks(poll: BlockPoll, origin: string): NewsletterBlocks {
  const paragraphs = postParagraphs(poll, origin)
  return {
    emailHtml: emailHtml(poll, origin),
    markdown: `${paragraphs.map(([markdown]) => markdown).join('\n\n')}\n`,
    markdownHtml: paragraphs.map(([, html]) => html).join('\n'),
  }
}
