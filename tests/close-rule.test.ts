import { describe, expect, it } from 'vitest'
import { decide } from '@/lib/polls'

describe('decide (the verdict at close)', () => {
  it('no votes → no_result', () => {
    expect(decide([0, 0])).toEqual({ status: 'no_result', winner: null })
  })

  it('a single vote wins', () => {
    expect(decide([0, 1])).toEqual({ status: 'closed', winner: 1 })
  })

  it('the majority option wins', () => {
    expect(decide([2, 1])).toEqual({ status: 'closed', winner: 0 })
  })

  it('a plurality wins among 4 options', () => {
    expect(decide([1, 3, 2, 2])).toEqual({ status: 'closed', winner: 1 })
  })

  it('a tie for first place has no winner', () => {
    expect(decide([2, 2])).toEqual({ status: 'closed', winner: null })
    expect(decide([3, 1, 3, 0])).toEqual({ status: 'closed', winner: null })
  })

  it('a tie below first place does not matter', () => {
    expect(decide([1, 4, 1])).toEqual({ status: 'closed', winner: 1 })
  })
})
