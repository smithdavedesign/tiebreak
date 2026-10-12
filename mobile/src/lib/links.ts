// Share links. The web share URL is https://<host>/p/<id>; the app also opens
// tiebreak://p/<id>. Both map to the same poll screen.

const POLL_ID = /^[A-Za-z0-9_-]{12}$/

/** The poll id from a share link or a bare id, or null if it isn't one. */
export function pollIdFrom(input: string): string | null {
  const text = input.trim()
  if (POLL_ID.test(text)) return text
  const match = /(?:^|\/)p\/([A-Za-z0-9_-]{12})(?:[/?#]|$)/.exec(text)
  return match ? match[1] : null
}

/** The web share URL for a poll, the one people can open without the app. */
export function shareUrl(apiBase: string, id: string): string {
  return `${apiBase.replace(/\/+$/, '')}/p/${id}`
}
