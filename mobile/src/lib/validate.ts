// Client-side checks for the create form, mirroring the server's parseNewPoll
// (../../lib/polls.ts) so people see the problem before sending.
import {
  MAX_HOURS,
  MAX_OPTIONS,
  MAX_OPTION_TEXT_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_TARGET,
  MIN_HOURS,
  MIN_OPTIONS,
  MIN_TARGET,
} from './limits'
import type { NewPoll, Visibility } from './api'

export interface Draft {
  question: string
  options: { text: string; imageUrl: string }[]
  target: string
  durationHours: string
  visibility: Visibility
}

const wholeIn = (text: string, min: number, max: number) => {
  const n = Number(text)
  return /^\d+$/.test(text.trim()) && n >= min && n <= max ? n : null
}

const isHttpsUrl = (text: string) => {
  try {
    return new URL(text).protocol === 'https:'
  } catch {
    return false
  }
}

/** The request body for a valid draft, or the first problem to show. */
export function toNewPoll(draft: Draft): { ok: true; value: NewPoll } | { ok: false; error: string } {
  const question = draft.question.trim()
  if (question.length > MAX_QUESTION_LENGTH) return { ok: false, error: `Keep the question under ${MAX_QUESTION_LENGTH} characters.` }
  const options = draft.options
    .map((o) => ({ text: o.text.trim(), imageUrl: o.imageUrl.trim() }))
    .filter((o) => o.text !== '' || o.imageUrl !== '')
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return { ok: false, error: `Give ${MIN_OPTIONS} to ${MAX_OPTIONS} options.` }
  }
  for (const [i, o] of options.entries()) {
    if (o.text.length > MAX_OPTION_TEXT_LENGTH) return { ok: false, error: `Option ${i + 1} is over ${MAX_OPTION_TEXT_LENGTH} characters.` }
    if (o.imageUrl !== '' && !isHttpsUrl(o.imageUrl)) return { ok: false, error: `Option ${i + 1}'s image must be an https link.` }
  }
  const target = wholeIn(draft.target, MIN_TARGET, MAX_TARGET)
  if (target === null) return { ok: false, error: `Votes needed must be ${MIN_TARGET}–${MAX_TARGET}.` }
  const durationHours = wholeIn(draft.durationHours, MIN_HOURS, MAX_HOURS)
  if (durationHours === null) return { ok: false, error: `Hours open must be ${MIN_HOURS}–${MAX_HOURS}.` }
  return {
    ok: true,
    value: {
      question,
      options: options.map((o) => ({ ...(o.text ? { text: o.text } : {}), ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}) })),
      target,
      durationHours,
      visibility: draft.visibility,
    },
  }
}
