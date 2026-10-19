// Poll limits, shared by server validation and the create form.
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4
/** How options are labelled in the UI and the CSV export: one letter per option. */
export const OPTION_LETTERS = 'ABCD'
export const MIN_TARGET = 1
export const MAX_TARGET = 100
export const MIN_HOURS = 1
export const MAX_HOURS = 168
export const MAX_QUESTION_LENGTH = 140
export const MAX_OPTION_TEXT_LENGTH = 80
export const MAX_URL_LENGTH = 2048
/** Photos an option can upload instead of linking: the file picker's `accept` list and the server's check. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
/** 5 MB as phones show file sizes (decimal). */
export const MAX_IMAGE_BYTES = 5_000_000
/** "Vote 5, post 1": votes on other people's polls that earn one public poll. */
export const VOTES_PER_CREDIT = 5
/** Reports from distinct accounts that take a poll out of the public feed. */
export const REPORTS_TO_HIDE = 3
export const FEED_PAGE_SIZE = 20
