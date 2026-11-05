// Public result pages (GROWTH.md, 2026-11-05): a closed poll whose creator ticked "Publish the result when it
// closes" gets a page at /results/<slug>, titled with its question and listed in the sitemap. Its address, its
// labels and its description live here; which polls qualify is getPublishedResult() in lib/polls.ts. No server
// code: the visit beacon (app/visit-beacon.tsx) and the poll page read this too.
//
//   "Which book cover? Red or navy!" + AbC123xyz_-0  →  /results/which-book-cover-red-or-navy-AbC123xyz_-0
import { OPTION_LETTERS } from './limits'
import type { Option, PollView } from './polls'

const PREFIX = '/results/'
/** Poll ids are 12 characters (9 random bytes as base64url), so a slug's last 12 are the id. */
const ID_LENGTH = 12
const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/
/** The question's words in an address: enough for search to read, short enough to share. */
const MAX_SLUG_WORDS = 60

/**
 * The question's words in lower case (accents dropped, anything but a-z and 0-9 between them as a dash), at most
 * MAX_SLUG_WORDS characters cut between words, then the poll id. Just the id when the question has no such words.
 */
export function resultSlug({ id, question }: { id: string; question: string }): string {
  const words = question
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // the accents NFKD split off: é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // One character more than fits, then back to the last dash, so a word that would be cut goes whole.
  const head = words.slice(0, MAX_SLUG_WORDS + 1)
  const cut = words.length <= MAX_SLUG_WORDS ? words : head.includes('-') ? head.replace(/-[^-]*$/, '') : head.slice(0, -1)
  return cut ? `${cut}-${id}` : id
}

export const resultPath = (poll: { id: string; question: string }) => `${PREFIX}${resultSlug(poll)}`

/** The poll id at the end of a slug, or null if there isn't one. The page still checks the whole slug. */
export function pollIdOfSlug(slug: string): string | null {
  const id = slug.slice(-ID_LENGTH)
  return ID_PATTERN.test(id) ? id : null
}

/** A result page's address (one path segment under /results/). Those pages send their own visit, with the path. */
export const isResultPath = (pathname: string) => /^\/results\/[^/]+$/.test(pathname)

export const optionLabel = (option: Option, i: number) => option.text ?? `Option ${OPTION_LETTERS[i]}`

const votes = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`

/** "A", "A and B", "A, B and C". */
const listOf = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** Each option's votes and share of all votes (whole percent, as the poll page shows it). */
export function splitOf(poll: PollView): { votes: number; percent: number }[] {
  const tally = poll.tally ?? poll.options.map(() => 0)
  return tally.map((n) => ({ votes: n, percent: poll.voteCount ? Math.round((100 * n) / poll.voteCount) : 0 }))
}

/** The heading over the split: the winner, or a tie. */
export function resultHeading(poll: PollView): string {
  return poll.winner === null
    ? "It's a tie."
    : `Winner: ${OPTION_LETTERS[poll.winner]} · ${optionLabel(poll.options[poll.winner], poll.winner)}`
}

/** The page's meta description: the winner (or the tie) and the vote count. Only for a closed poll's result. */
export function resultDescription(poll: PollView): string {
  const split = splitOf(poll)
  const after = 'See how every option did in this closed tiebreak poll.'
  if (poll.winner !== null) {
    const { votes: won, percent } = split[poll.winner]
    return `Winner: ${optionLabel(poll.options[poll.winner], poll.winner)}, with ${won} of ${votes(poll.voteCount)} (${percent}%). ${after}`
  }
  const top = Math.max(...split.map((s) => s.votes))
  const tied = poll.options.flatMap((o, i) => (split[i].votes === top ? [optionLabel(o, i)] : []))
  return `It's a tie: ${listOf(tied)}, ${votes(top)} each, out of ${votes(poll.voteCount)}. ${after}`
}
