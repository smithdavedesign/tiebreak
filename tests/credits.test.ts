import { describe, expect, it } from 'vitest'
import { creditsFrom } from '@/lib/credits'

describe('creditsFrom (vote 5, post 1)', () => {
  it('a new account has nothing and needs 5 votes', () => {
    expect(creditsFrom(0, 0)).toEqual({ credits: 0, countedVotes: 0, publicPolls: 0, votesToNextCredit: 5 })
  })

  it('4 votes are one short', () => {
    expect(creditsFrom(4, 0)).toMatchObject({ credits: 0, votesToNextCredit: 1 })
  })

  it('5 votes earn 1 credit', () => {
    expect(creditsFrom(5, 0)).toMatchObject({ credits: 1, votesToNextCredit: 5 })
  })

  it('posting spends the credit; the next one takes another 5 votes', () => {
    expect(creditsFrom(5, 1)).toMatchObject({ credits: 0, votesToNextCredit: 5 })
    expect(creditsFrom(9, 1)).toMatchObject({ credits: 0, votesToNextCredit: 1 })
    expect(creditsFrom(10, 1)).toMatchObject({ credits: 1, votesToNextCredit: 5 })
  })

  it('earns one credit per 5 votes', () => {
    expect(creditsFrom(23, 0)).toMatchObject({ credits: 4, votesToNextCredit: 2 })
  })

  it('never goes negative', () => {
    expect(creditsFrom(3, 2).credits).toBe(0)
  })
})
