// Public result pages (GROWTH.md, 2026-11-06): a creator ticks "Publish the result when it closes", and once the
// poll closes with votes, /results/<slug> shows it to anyone and /sitemap.xml lists it. The slug is the question's
// words, then the poll id, so the address reads like the question and still finds the poll if the words change.
//
//   POST /polls {publishResult: true} → closes → /results/<words>-<id> (app/results/[slug]) + /sitemap.xml
//
// Pure helpers only, so the browser can use them too (the visit beacon, the poll page's link). Which polls are
// public, and the reads behind the page and the sitemap, live with the rest of the SQL in lib/polls.ts.
import { OPTION_LETTERS } from './limits'
import type { Option, PollView } from './polls'

const RESULTS_PREFIX = '/results/'

/** Poll ids are 12 base64url characters (lib/polls.ts). */
const ID_LENGTH = 12
/** How much of the question the address keeps, cut between words. */
const MAX_SLUG_WORDS = 60

/** The question as an address: lower-case ASCII letters and digits, accents dropped, words joined by dashes. */
function slugWords(question: string): string {
  const words = question
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (words.length <= MAX_SLUG_WORDS) return words
  const cut = words.slice(0, MAX_SLUG_WORDS + 1)
  const lastBreak = cut.lastIndexOf('-')
  return lastBreak > 0 ? cut.slice(0, lastBreak) : words.slice(0, MAX_SLUG_WORDS)
}

/** `which-book-cover-<id>`, or just the id when the question has no letters or digits to use. */
export function resultSlug(poll: Pick<PollView, 'id' | 'question'>): string {
  const words = slugWords(poll.question)
  return words ? `${words}-${poll.id}` : poll.id
}

export const resultPath = (poll: Pick<PollView, 'id' | 'question'>) => `${RESULTS_PREFIX}${resultSlug(poll)}`

/** The poll id at the end of a slug (whatever words come first), or null if it can't hold one. */
export function pollIdOfSlug(slug: string): string | null {
  if (slug.length < ID_LENGTH) return null
  const words = slug.slice(0, -ID_LENGTH)
  return words === '' || words.endsWith('-') ? slug.slice(-ID_LENGTH) : null
}

/** A result page's address (the visit beacon sends it as the visit's `path`). */
export const isResultPath = (pathname: string) =>
  pathname.startsWith(RESULTS_PREFIX) && /^[^/]+$/.test(pathname.slice(RESULTS_PREFIX.length))

/** "1 vote", "3 votes". */
export const votes = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`

/**
 * An option's label on the page, as the poll page shows it (app/poll-parts.tsx `labelOf`, which a server page
 * can't call: that module is client code).
 */
export const optionLabel = (option: Option, i: number) => option.text ?? `Option ${OPTION_LETTERS[i]}`

/** An option as the description names it: its text in quotes, or its letter for a photo on its own. */
const nameOf = (option: Option, i: number) => (option.text ? `“${option.text}”` : `Option ${OPTION_LETTERS[i]}`)

const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** The result in one sentence for the meta description: the winner (or the tie) and the vote count. */
export function resultDescription(poll: PollView): string {
  const tally = poll.tally ?? poll.options.map(() => 0)
  const total = poll.voteCount
  const more = "See every option's share of the votes in this closed tiebreak poll."
  if (poll.winner !== null) {
    const share = total ? Math.round((100 * tally[poll.winner]) / total) : 0
    return `${nameOf(poll.options[poll.winner], poll.winner)} won with ${tally[poll.winner]} of ${votes(total)} (${share}%). ${more}`
  }
  const top = Math.max(...tally)
  const tied = poll.options.flatMap((option, i) => (tally[i] === top ? [nameOf(option, i)] : []))
  return `${listOf(tied)} tied with ${votes(top)} each, out of ${total}. ${more}`
}
