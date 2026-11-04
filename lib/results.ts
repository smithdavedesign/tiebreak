// Public result pages (GROWTH.md, 2026-11-04). A creator ticks "Publish the result when it closes", and once the
// poll closes it gets a page at /results/<slug>, titled with its question and listed in the sitemap. The slug is
// the question's words, then the poll's id: the id finds the poll, the words are for people and search. Pure
// helpers, shared by the page, the sitemap and the poll page (a client component); the queries are in lib/polls.ts.
import { OPTION_LETTERS } from './limits'
import type { Option, PollView } from './polls'

const RESULTS_PREFIX = '/results/'
/** Poll ids are 12 characters (lib/polls.ts). */
const ID_LENGTH = 12
/** At most this many characters of the question go in the address, cut at a word. */
const MAX_WORDS_LENGTH = 60

/** The question as address words: "Which cover: Café Noir or Tea & Toast?" → "which-cover-cafe-noir-or-tea-toast". */
function slugWords(question: string): string {
  const words = question
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents off (NFKD split them off as marks): é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (words.length <= MAX_WORDS_LENGTH) return words
  const cut = words.slice(0, MAX_WORDS_LENGTH + 1)
  const lastBreak = cut.lastIndexOf('-')
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : words.slice(0, MAX_WORDS_LENGTH)).replace(/-+$/, '')
}

/** A poll's result page address, after /results/: its question's words and its id, or the id alone. */
export function resultSlug(poll: Pick<PollView, 'id' | 'question'>): string {
  const words = slugWords(poll.question)
  return words === '' ? poll.id : `${words}-${poll.id}`
}

export const resultPath = (poll: Pick<PollView, 'id' | 'question'>) => `${RESULTS_PREFIX}${resultSlug(poll)}`

/**
 * The poll id at the end of a result page's slug, or null if the slug can't end in one. Any words before it are
 * allowed here; the page sends a slug that isn't the poll's own to the one that is.
 */
export function resultIdOf(slug: string): string | null {
  if (slug.length < ID_LENGTH) return null
  const words = slug.slice(0, -ID_LENGTH)
  return words === '' || words.endsWith('-') ? slug.slice(-ID_LENGTH) : null
}

/** Result pages count their own visit, with their path (the page's PathVisit), apart from the rest of the site. */
export const isResultPath = (pathname: string) => pathname.startsWith(RESULTS_PREFIX)

/**
 * Whether a poll's result is published, as far as the poll itself says: its creator opted in, it isn't private,
 * it has a question to be titled with, and it closed with votes (a poll nobody voted on has nothing to show).
 * Reports can still take it down: lib/polls.ts getPublishedResult.
 */
export const hasResultPage = (poll: Pick<PollView, 'publishResult' | 'visibility' | 'status' | 'question'>) =>
  poll.publishResult && poll.visibility !== 'private' && poll.status === 'closed' && poll.question !== ''

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const optionLabel = (option: Option, i: number) => option.text ?? `Option ${OPTION_LETTERS[i]}`
/** An option's share of the vote, as the poll page shows it: a whole percentage. */
export const shareOf = (votes: number, total: number) => (total ? Math.round((100 * votes) / total) : 0)

function listOf(items: string[]) {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** The result in one sentence: the winner with its votes and share, or who tied. For a closed poll's tally. */
export function resultSummary(poll: Pick<PollView, 'options' | 'tally' | 'winner' | 'voteCount'>): string {
  const tally = poll.tally ?? poll.options.map(() => 0)
  const total = poll.voteCount
  if (poll.winner !== null) {
    const votes = tally[poll.winner]
    return `Winner: ${optionLabel(poll.options[poll.winner], poll.winner)}, with ${votes} of ${plural(total, 'vote')} (${shareOf(votes, total)}%).`
  }
  const top = Math.max(0, ...tally)
  const tied = poll.options.flatMap((option, i) => (tally[i] === top ? [optionLabel(option, i)] : []))
  return `It's a tie between ${listOf(tied)}, with ${plural(top, 'vote')} each out of ${total}.`
}
