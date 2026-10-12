// Swipe semantics shared with the web app (../../lib/swipe.ts): left picks option A,
// right picks option B. Polls with 3 or 4 options vote with buttons instead.

/** How far (px) a card must be dragged before the drag counts as a pick. */
export const SWIPE_THRESHOLD = 80

/** Maps a horizontal drag to an option: left picks option 0, right picks option 1. */
export function swipeChoice(dx: number): 0 | 1 | null {
  'worklet'
  if (!Number.isFinite(dx)) return null
  if (dx <= -SWIPE_THRESHOLD) return 0
  if (dx >= SWIPE_THRESHOLD) return 1
  return null
}

/** Only two-option polls are swiped; more options get a button per option. */
export function canSwipe(optionCount: number): boolean {
  return optionCount === 2
}
