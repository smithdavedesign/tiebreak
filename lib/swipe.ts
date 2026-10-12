/** How far (px) a card must be dragged before the drag counts as a pick. */
export const SWIPE_THRESHOLD = 80

/** Maps a horizontal drag to an option: left picks option 0, right picks option 1. */
export function swipeChoice(dx: number): 0 | 1 | null {
  if (!Number.isFinite(dx)) return null
  if (dx <= -SWIPE_THRESHOLD) return 0
  if (dx >= SWIPE_THRESHOLD) return 1
  return null
}
