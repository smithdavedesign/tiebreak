'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { uploadError } from '@/app/create-poll-form'
import { IMAGE_TYPES, MAX_OPTIONS, MIN_OPTIONS, OPTION_LETTERS as LETTERS } from '@/lib/limits'
import { handOver } from '@/lib/photo-handoff'
import { optionRange, type Tool, type ToolView } from '@/lib/tools'

const ACCEPT = IMAGE_TYPES.join(',')

type Candidate = {
  /** Stays the same when an earlier candidate is removed (and the letters move up). */
  key: number
  file: File
  /** The file's object URL: every preview is drawn from the device, so nothing is sent to preview it. */
  src: string
  /** Once uploaded: its id and path on tiebreak, so pressing the button again doesn't send it twice. */
  uploaded: { id: string; path: string } | null
  /** Why its upload was refused, shown in its own slot. */
  error: string | null
}

let nextKey = 0

/**
 * The tool: pick 2–4 images, see them side by side in the tool's mocks, then "Let strangers pick" uploads
 * them (POST /images, all at once) and opens the new-poll form with them as the options. Nothing leaves
 * the device before that button.
 */
export function ThumbnailPreview({ tool }: { tool: Tool }) {
  const router = useRouter()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Off until the page is interactive, so a file picked before then isn't silently dropped.
  const [ready, setReady] = useState(false)
  const objectUrls = useRef(new Set<string>())
  const n = candidates.length

  useEffect(() => {
    setReady(true)
    const live = objectUrls.current
    return () => {
      for (const url of live) URL.revokeObjectURL(url)
      live.clear()
    }
  }, [])

  const update = (key: number, patch: Partial<Candidate>) =>
    setCandidates((all) => all.map((c) => (c.key === key ? { ...c, ...patch } : c)))

  function add(files: File[]) {
    const fits = files.slice(0, Math.max(MAX_OPTIONS - n, 0))
    const left = files.length - fits.length
    setNote(left > 0 ? `A poll takes up to ${MAX_OPTIONS}, so ${left} ${left === 1 ? 'was' : 'were'} left out.` : null)
    setError(null)
    const added = fits.map((file) => {
      const src = URL.createObjectURL(file)
      objectUrls.current.add(src)
      return { key: nextKey++, file, src, uploaded: null, error: null }
    })
    setCandidates((all) => [...all, ...added])
  }

  function remove(key: number) {
    const gone = candidates.find((c) => c.key === key)
    if (gone) {
      URL.revokeObjectURL(gone.src)
      objectUrls.current.delete(gone.src)
    }
    setCandidates((all) => all.filter((c) => c.key !== key))
    setNote(null)
  }

  async function letStrangersPick() {
    setError(null)
    setBusy(true)
    setCandidates((all) => all.map((c) => ({ ...c, error: null })))
    try {
      const stored = await Promise.all(
        candidates.map(async (c) => {
          if (c.uploaded) return c.uploaded
          const res = await fetch('/images', {
            method: 'POST',
            headers: { 'content-type': c.file.type || 'application/octet-stream' },
            body: c.file,
          })
          const body = await res.json().catch(() => null)
          if (res.status === 201 && typeof body?.id === 'string' && typeof body?.url === 'string') {
            const uploaded = { id: body.id, path: new URL(body.url, location.href).pathname }
            update(c.key, { uploaded })
            return uploaded
          }
          update(c.key, { error: uploadError(res.status, body) })
          return null
        }),
      )
      if (stored.includes(null)) {
        setBusy(false)
        return
      }
      const query = new URLSearchParams({ tool: tool.slug })
      candidates.forEach((c, i) => {
        const photo = stored[i]!
        handOver(photo.path, c.file)
        query.append('photo', photo.id)
      })
      router.push(`/?${query}`)
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="tool">
      <div className="card tool-controls">
        <label className="photo-pick">
          <input
            type="file"
            className="visually-hidden"
            multiple
            accept={ACCEPT}
            aria-label="Add images"
            disabled={!ready || busy || n >= MAX_OPTIONS}
            onChange={(e) => {
              add([...(e.target.files ?? [])])
              e.target.value = '' // so picking the same file again still counts
            }}
          />
          <span className="pick">Add images</span>
          <span className="hint">
            {n >= MAX_OPTIONS
              ? `${MAX_OPTIONS} is the most a poll takes. Remove one to add another.`
              : `2–4 ${tool.noun}: JPEG, PNG or WebP. They stay on your device until you ask for a poll.`}
          </span>
        </label>
        {note && (
          <p className="hint" role="status">
            {note}
          </p>
        )}
        {n > 0 && (
          <ol className="candidates">
            {candidates.map((c, i) => (
              <li key={c.key}>
                <b>{LETTERS[i]}</b>
                <span className="photo-name">{c.file.name}</span>
                <button type="button" className="link" disabled={busy} onClick={() => remove(c.key)}>
                  Remove
                </button>
                {c.error && (
                  <p className="error" role="alert">
                    {c.error}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="tool-cta">
          <button type="button" disabled={!ready || busy || n < MIN_OPTIONS} onClick={letStrangersPick}>
            {busy ? 'Uploading…' : 'Let strangers pick'}
          </button>
          <span className="hint">
            {n < MIN_OPTIONS
              ? `Add at least ${MIN_OPTIONS} to put them to a vote.`
              : `Uploads these ${n} and opens a new poll with them as ${optionRange(n)}. You share its link, and people swipe to pick one.`}
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <PreviewMocks
        tool={tool}
        candidates={
          n > 0
            ? candidates.map((c) => ({ key: c.key, src: c.src, name: c.file.name }))
            : [0, 1].map((key) => ({ key, src: null, name: '' }))
        }
      />
    </div>
  )
}

/** A candidate as the mocks draw it; `src` null is an empty slot, shown before any image is added. */
type PreviewCandidate = { key: number; src: string | null; name: string }

/** Each of the tool's views, with every candidate in it side by side, lettered like the poll's options. */
export function PreviewMocks({ tool, candidates }: { tool: Tool; candidates: PreviewCandidate[] }) {
  return (
    <div className="mocks">
      {tool.views.map((view) => (
        <section key={view.key} className={`mock mock-${view.layout}`} aria-label={`${tool.name}: ${view.label}`}>
          <h2>{view.label}</h2>
          {view.layout === 'grid' && <span className="mock-bar" aria-hidden="true" />}
          <div className="mock-tiles" style={view.layout === 'grid' ? ({ '--tile': `${view.tile}rem` } as CSSProperties) : undefined}>
            {candidates.map((c, i) => (
              <figure key={c.key} className="tile">
                {c.src ? (
                  <img src={c.src} alt={`${LETTERS[i]}: ${c.name}`} data-view={view.key} data-option={LETTERS[i]} style={sizeIn(view)} />
                ) : (
                  <span className="tile-empty" style={sizeIn(view, true)} aria-hidden="true">
                    {LETTERS[i]}
                  </span>
                )}
                <figcaption aria-hidden="true">
                  <b>{LETTERS[i]}</b>
                  <span className="mock-line" />
                  <span className="mock-line short" />
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** A tile's size: its crop (the image covers it), or a cover's height (its width follows the image). */
function sizeIn(view: ToolView, empty = false): CSSProperties {
  if (view.layout === 'shelf') return empty ? { height: view.height, aspectRatio: '5 / 8' } : { height: view.height }
  return { aspectRatio: `${view.ratio[0]} / ${view.ratio[1]}` }
}
