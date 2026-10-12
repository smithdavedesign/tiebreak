import { describe, expect, it } from 'vitest'
import { SWIPE_THRESHOLD, swipeChoice } from '@/lib/swipe'

describe('swipeChoice (drag distance → picked option)', () => {
  it('a left swipe past the threshold picks the left option', () => {
    expect(swipeChoice(-SWIPE_THRESHOLD)).toBe(0)
    expect(swipeChoice(-400)).toBe(0)
  })

  it('a right swipe past the threshold picks the right option', () => {
    expect(swipeChoice(SWIPE_THRESHOLD)).toBe(1)
    expect(swipeChoice(400)).toBe(1)
  })

  it('a short drag picks nothing (the card snaps back)', () => {
    expect(swipeChoice(0)).toBeNull()
    expect(swipeChoice(SWIPE_THRESHOLD - 1)).toBeNull()
    expect(swipeChoice(-(SWIPE_THRESHOLD - 1))).toBeNull()
  })

  it('ignores non-finite input', () => {
    expect(swipeChoice(Number.NaN)).toBeNull()
  })
})
