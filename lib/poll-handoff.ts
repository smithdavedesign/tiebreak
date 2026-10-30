// A new poll started on another page (the Etsy listing photo test): the photos the visitor picked there,
// handed to the new-poll form on / so it opens with them as options A, B, … The tool sets it and navigates
// to / client-side; the form reads it once as it opens and clears it. It lives in the page's memory only:
// photos can be up to 5 MB each, too big for sessionStorage, and nothing is uploaded until the poll is
// created. A full reload of / drops it, and the form opens blank as usual.

export type PollDraft = {
  question: string
  /** Picked from the device, 2 to 4 of them, not uploaded yet. */
  photos: File[]
}

let pending: PollDraft | null = null

export function handOffPoll(draft: PollDraft) {
  pending = draft
}

export function pendingPoll(): PollDraft | null {
  return pending
}

export function clearPendingPoll() {
  pending = null
}
