// The hand-off from a thumbnail tool to the new-poll form on `/`: the tool uploads its images, offers them
// here and navigates to `/` in the browser, where the form opens with them as options A, B, … It lives in
// memory only, so it survives that client-side navigation and nothing else: a reload opens a blank form
// (and photos no poll uses are deleted after a day, lib/images.ts). Only that click handler sets it, so on
// the server it stays empty and the form renders blank there.

export type DraftPhoto = {
  /** The picked file, so the form shows its thumbnail without loading anything. */
  file: File
  /** Its URL on tiebreak from POST /images: the form posts it as the option's imageUrl, with no second upload. */
  url: string
}
export type PollDraft = { question: string; photos: DraftPhoto[] }

let waiting: PollDraft | null = null

export function offerPollDraft(draft: PollDraft): void {
  waiting = draft
}

export function peekPollDraft(): PollDraft | null {
  return waiting
}

/** The form calls this once it has opened with the draft, so it's used once. */
export function clearPollDraft(): void {
  waiting = null
}
