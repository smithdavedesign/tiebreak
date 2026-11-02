// Vote from your newsletter: the blocks a poll's creator pastes into an email or a Substack post, one link per
// option. A link (/polls/<id>?pick=B&src=newsletter) opens the poll page with that option picked, and nothing is
// voted until the reader presses "Confirm vote": inbox link scanners and prefetchers open every link in an email.
//
// Two blocks, each copied as plain text and as HTML, so the paste fits where it lands:
// - the email block: a table with inline styles (email clients drop <style> and never run <script>). Its text is
//   its own HTML source, for an email tool's HTML box; rich editors (Gmail, most email builders) take the HTML.
// - the Substack block: Markdown, an image line and a link line per option. Substack's editor doesn't read pasted
//   Markdown, so the HTML version (the same lines, no table: Substack drops tables) is what it takes on paste.
import type { Source } from './beacon'
import { OPTION_LETTERS } from './limits'
import type { Option } from './polls'

type Poll = { id: string; question: string; options: Option[] }

const SOURCE: Source = 'newsletter'
const MAX_WIDTH_PX = 600
const CELL_PAD_PX = 6
const INK = '#1d1d1f'
const MUTED = '#6e6e73'
const LINE = '#d2d2d7'
const ACCENT = '#ff5a36'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const FOOTNOTE = 'Tap your pick, then confirm your vote on tiebreak.'

/** An option's own link: `<origin>/polls/<id>?pick=<letter>&src=newsletter`. */
export function pickLink(origin: string, id: string, option: number): string {
  return `${origin}/polls/${id}?pick=${OPTION_LETTERS[option]}&src=${SOURCE}`
}

/** The option a `?pick=` letter names (either case), or null if it isn't one of this poll's letters. */
export function pickedOption(pick: string | string[] | undefined, optionCount: number): number | null {
  if (typeof pick !== 'string' || pick.length !== 1) return null
  const index = OPTION_LETTERS.indexOf(pick.toUpperCase())
  return index >= 0 && index < optionCount ? index : null
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Markdown's own characters in link and image text, backslash-escaped so they read as written. */
const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>]/g, '\\$&')

/** A URL as written into a block: normalised (spaces encoded), and with parentheses encoded so Markdown keeps it whole. */
const blockUrl = (url: string) => new URL(url).href.replace(/\(/g, '%28').replace(/\)/g, '%29')

const questionOf = (poll: Poll) => poll.question || 'Which one?'
/** "A: Teal waves", or "Option A" for a photo with no text. */
const nameOf = (option: Option, i: number) => (option.text ? `${OPTION_LETTERS[i]}: ${option.text}` : `Option ${OPTION_LETTERS[i]}`)
/** "Vote A: Teal waves", or "Vote A". */
const voteLabel = (option: Option, i: number) => `Vote ${OPTION_LETTERS[i]}${option.text ? `: ${option.text}` : ''}`

/** The email block: the question, then a row with one cell per option, each one link around its photo or text. */
export function emailHtml(poll: Poll, origin: string): string {
  const count = poll.options.length
  const cellWidth = Math.floor(100 / count)
  const imageWidth = Math.floor(MAX_WIDTH_PX / count) - 2 * CELL_PAD_PX
  const cells = poll.options.map((option, i) => {
    const letter = OPTION_LETTERS[i]
    const face = option.imageUrl
      ? `<img src="${escapeHtml(blockUrl(option.imageUrl))}" alt="${escapeHtml(nameOf(option, i))}" width="${imageWidth}" style="display:block;width:100%;max-width:${imageWidth}px;height:auto;margin:0 auto;border:0;border-radius:8px">` +
        `<span style="display:block;padding:8px 2px 0;font-size:15px;line-height:1.35;color:${INK}"><b>${letter}</b>${option.text ? ` ${escapeHtml(option.text)}` : ''}</span>`
      : `<span style="display:block;padding:20px 8px;border:1px solid ${LINE};border-radius:8px;font-size:17px;line-height:1.35;color:${INK}"><b>${letter}</b> ${escapeHtml(option.text ?? '')}</span>`
    return (
      `<td width="${cellWidth}%" valign="top" style="width:${cellWidth}%;padding:0 ${CELL_PAD_PX}px;vertical-align:top;text-align:center">` +
      `<a href="${escapeHtml(pickLink(origin, poll.id, i))}" style="display:block;color:${INK};text-decoration:none">` +
      face +
      `<span style="display:inline-block;margin-top:8px;padding:8px 16px;border-radius:999px;background:${ACCENT};color:#ffffff;font-size:14px;font-weight:700">Vote ${letter}</span>` +
      `</a></td>`
    )
  })
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${MAX_WIDTH_PX}px;border-collapse:collapse;font-family:${FONT};color:${INK}">`,
    `<tr><td colspan="${count}" style="padding:0 ${CELL_PAD_PX}px 12px;font-size:20px;font-weight:700;line-height:1.3">${escapeHtml(questionOf(poll))}</td></tr>`,
    `<tr>${cells.join('')}</tr>`,
    `<tr><td colspan="${count}" style="padding:14px ${CELL_PAD_PX}px 0;font-size:13px;line-height:1.4;color:${MUTED}">${FOOTNOTE}</td></tr>`,
    `</table>`,
  ].join('\n')
}

/** The Substack block as Markdown: the question, then per option its image line (or its text) and its link line. */
export function postMarkdown(poll: Poll, origin: string): string {
  const lines = [`**${escapeMarkdown(questionOf(poll))}**`]
  poll.options.forEach((option, i) => {
    lines.push(
      option.imageUrl ? `![${escapeMarkdown(nameOf(option, i))}](${blockUrl(option.imageUrl)})` : `**${escapeMarkdown(nameOf(option, i))}**`,
      `[${escapeMarkdown(voteLabel(option, i))}](${blockUrl(pickLink(origin, poll.id, i))})`,
    )
  })
  lines.push(FOOTNOTE)
  return lines.join('\n\n') + '\n'
}

/** The Substack block's lines as plain HTML paragraphs: what a rich editor (Substack's) makes of a paste. */
export function postHtml(poll: Poll, origin: string): string {
  const lines = [`<p><b>${escapeHtml(questionOf(poll))}</b></p>`]
  poll.options.forEach((option, i) => {
    lines.push(
      option.imageUrl
        ? `<p><img src="${escapeHtml(blockUrl(option.imageUrl))}" alt="${escapeHtml(nameOf(option, i))}"></p>`
        : `<p><b>${escapeHtml(nameOf(option, i))}</b></p>`,
      `<p><a href="${escapeHtml(pickLink(origin, poll.id, i))}">${escapeHtml(voteLabel(option, i))}</a></p>`,
    )
  })
  lines.push(`<p>${FOOTNOTE}</p>`)
  return lines.join('\n')
}
