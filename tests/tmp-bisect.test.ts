// The share card's address and alt text, as a poll page's og:image and twitter:image carry them.
// Pure functions, no database. (The file name is left over from bisecting a slow test-database boot
// during the share-card build; the build sandbox can't rename or delete files. Rename it freely.)
import { describe, expect, it } from 'vitest'
import type { PollView } from '@/lib/polls'
import { CARD_SIZE, cardImage, cardPath } from '@/lib/share-card'

const poll = (overrides: Partial<PollView> = {}): PollView => ({
  id: 'AbCdEfGhIjKl',
  question: 'Which listing photo?',
  options: [
    { text: 'Red mug', imageUrl: null },
    { text: null, imageUrl: 'https://images.example.com/blue.png' },
  ],
  target: 3,
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
})

describe('cardPath', () => {
  it('names the poll and its status, so the URL changes when the poll closes', () => {
    expect(cardPath(poll())).toBe('/p/AbCdEfGhIjKl/card?v=open')
    expect(cardPath(poll({ status: 'closed' }))).toBe('/p/AbCdEfGhIjKl/card?v=closed')
  })
})

describe('cardImage', () => {
  it('is 1200×630 and describes the question and each option, a photo option by its letter', () => {
    expect(cardImage(poll())).toEqual({
      url: '/p/AbCdEfGhIjKl/card?v=open',
      width: CARD_SIZE.width,
      height: CARD_SIZE.height,
      alt: 'Which listing photo? (A: Red mug, B: photo B)',
    })
  })

  it('names the winner once a poll has closed with one, and falls back for a poll without a question', () => {
    expect(cardImage(poll({ status: 'closed', winner: 0, tally: [2, 1], voteCount: 3 })).alt).toBe(
      'Which listing photo? (A: Red mug, B: photo B) Winner: A.',
    )
    expect(cardImage(poll({ question: '' })).alt).toMatch(/^Which one\? /)
  })
})
