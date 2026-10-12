// The same poll limits as the web app and API (../../lib/limits.ts), so the form
// rejects what the server would. Keep the two in step.
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4
export const OPTION_LETTERS = 'ABCD'
export const MIN_TARGET = 1
export const MAX_TARGET = 100
export const MIN_HOURS = 1
export const MAX_HOURS = 168
export const MAX_QUESTION_LENGTH = 140
export const MAX_OPTION_TEXT_LENGTH = 80
export const VOTES_PER_CREDIT = 5
