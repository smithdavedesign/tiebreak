'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_OPTIONS, MIN_OPTIONS, OPTION_LETTERS as LETTERS } from '@/lib/limits'
import { uploadPhoto } from '@/lib/photo-upload'
import { offerPollDraft } from '@/lib/poll-draft'
import { toolOf, type ToolKind } from '@/lib/tools'
import { CoverPreview, EtsyPreview, YouTubePreview, type Candidate } from './previews'

const ACCEPT = IMAGE_TYPES.join(',')
const PREVIEWS = { etsy: EtsyPreview, 'book-cover': CoverPreview, youtube: YouTubePreview } satisfies Record<
  ToolKind,
  (props: { candidates: Candidate[] }) => unknown
>
const EMPTY: Record<ToolKind, string> = {
  etsy: 'Add 2 to 4 listing photos to see each one in a search grid at the square, 4:3 and 5:4 crops.',
  'book-cover': 'Add 2 to 4 covers to see them side by side at about 160 px and 80 px tall.',
  youtube: 'Add 2 to 4 thumbnails to see them at 16:9 in a desktop grid and a phone feed.',
}

/** An added image: its object URL draws every tile, so nothing loads from the network. */
type Pick = { id: number; file: File; src: string }
type Upload = { url: string } | { error: string }
const isUp = (u: Upload | undefined): u is { url: string } => u !== undefined && 'url' in u

/**
 * A thumbnail preview tool: 2–4 images from the device, side by side in the tool's mock placements,
 * entirely in the browser. "Let strangers pick" is the first time anything is sent: it uploads the
 * images, hands them to the new-poll form (lib/poll-draft.ts) and opens it, with them as options A, B, …
 */
export function ThumbnailTool({ kind }: { kind: ToolKind }) {
  const tool = toolOf(kind)
  const Preview = PREVIEWS[kind]
  const router = useRouter()
  const [picks, setPicks] = useState<Pick[]>([])
  const [uploads, setUploads] = useState<ReadonlyMap<number, Upload>>(new Map())
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nextId = useRef(0)

  // Object URLs live until their image is removed or the tool goes (a reload frees them too).
  const current = useRef(picks)
  useEffect(() => {
    current.current = picks
  }, [picks])
  useEffect(() => () => current.current.forEach((p) => URL.revokeObjectURL(p.src)), [])

  const full = picks.length >= MAX_OPTIONS
  const last = LETTERS[picks.length - 1]

  function add(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])]
    event.target.value = '' // so picking the same file again still counts
    const images = chosen.filter((f) => f.type.startsWith('image/'))
    const room = MAX_OPTIONS - picks.length
    const added = images.slice(0, room).map((file) => ({ id: nextId.current++, file, src: URL.createObjectURL(file) }))
    setPicks((all) => [...all, ...added])
    const notes = []
    const notImages = chosen.length - images.length
    if (notImages > 0) notes.push(`Left out ${notImages} ${notImages === 1 ? "file that isn't an image" : "files that aren't images"}.`)
    if (images.length > room) notes.push(`A poll takes up to ${MAX_OPTIONS} images, so ${images.length - room} didn't fit.`)
    setNotice(notes.length ? notes.join(' ') : null)
  }

  function remove(id: number) {
    const gone = picks.find((p) => p.id === id)
    if (gone) URL.revokeObjectURL(gone.src)
    setPicks((all) => all.filter((p) => p.id !== id))
    setNotice(null)
  }

  async function letStrangersPick() {
    setError(null)
    setBusy(true)
    try {
      // An image that went up on an earlier try isn't sent again.
      const results = await Promise.all(picks.map((p) => (isUp(uploads.get(p.id)) ? uploads.get(p.id)! : uploadPhoto(p.file))))
      setUploads(new Map(picks.map((p, i) => [p.id, results[i]])))
      if (!results.every(isUp)) {
        setBusy(false)
        return
      }
      offerPollDraft({ question: tool.question, photos: picks.map((p, i) => ({ file: p.file, url: results[i].url })) })
      router.push('/')
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
    }
  }

  const candidates: Candidate[] = picks.map((p, i) => ({ id: p.id, letter: LETTERS[i], name: p.file.name, src: p.src }))

  return (
    <section className="card tool" data-tool={kind} aria-label={tool.name}>
      <label className="photo-pick">
        <input
          type="file"
          multiple
          className="visually-hidden"
          accept={ACCEPT}
          aria-label="Add images"
          disabled={full || busy}
          onChange={add}
        />
        <span className="pick">{picks.length === 0 ? 'Add images' : 'Add more images'}</span>
        <span className="hint">
          {full
            ? `That's ${MAX_OPTIONS}, the most a poll takes. Remove one to add another.`
            : `JPEG, PNG or WebP (up to ${MAX_IMAGE_BYTES / 1_000_000} MB to post). They stay on this device until you post a poll.`}
        </span>
      </label>
      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}

      {picks.length > 0 && (
        <ol className="picks">
          {picks.map((p, i) => {
            const upload = uploads.get(p.id)
            return (
              <li key={p.id}>
                <b>{LETTERS[i]}</b>
                <span className="photo-name">{p.file.name}</span>
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove image ${LETTERS[i]}`}
                  disabled={busy}
                  onClick={() => remove(p.id)}
                >
                  Remove
                </button>
                {upload && 'error' in upload && (
                  <p className="error" role="alert">
                    {upload.error}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {candidates.length > 0 ? <Preview candidates={candidates} /> : <p className="tool-empty">{EMPTY[kind]}</p>}

      <div className="tool-cta">
        <button type="button" disabled={picks.length < MIN_OPTIONS || busy} onClick={() => void letStrangersPick()}>
          {busy ? 'Uploading images…' : 'Let strangers pick'}
        </button>
        <p className="hint">
          {picks.length < MIN_OPTIONS
            ? `Add at least ${MIN_OPTIONS} images to post them as a poll.`
            : `Uploads these ${picks.length} images and opens a poll with them as options A–${last}.`}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
