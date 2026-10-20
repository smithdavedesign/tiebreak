// POST /images from the browser, shared by the new-poll form and the thumbnail tools.

/** The message for a refused upload: the server's own, else one for the status. */
function uploadError(status: number, body: { error?: unknown } | null) {
  if (typeof body?.error === 'string') return body.error
  // Vercel refuses a request body over 4.5 MB itself, before the app sees it.
  if (status === 413) return 'That photo is too big to upload. Try a smaller copy of it.'
  return "The photo didn't upload. Try again."
}

/** Uploads one picked photo: its URL on tiebreak, or why it was refused. A network failure throws. */
export async function uploadPhoto(file: File): Promise<{ url: string } | { error: string }> {
  const res = await fetch('/images', {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  const body = await res.json().catch(() => null)
  if (res.status === 201 && typeof body?.url === 'string') return { url: body.url }
  return { error: uploadError(res.status, body) }
}
