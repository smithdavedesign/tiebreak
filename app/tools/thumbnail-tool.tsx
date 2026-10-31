'use client'

// The thumbnail preview tools (GROWTH.md, 2026-10-22). Picked images are previewed from object URLs, so nothing
// leaves the device until "Let strangers pick": that uploads them (POST /images, as the new-poll form does) and
// hands them to the form on / as options A, B, …, where posting the poll is the usual core action.
//
//   pick files → object URLs → <Previews> (Etsy crops | cover shelves | YouTube grid and feed)
//   Let strangers pick → uploadPhoto × n → handOffToNewPoll → router.push('/') → CreatePollForm, prefilled
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { handOffToNewPoll, uploadPhoto } from '@/app/create-poll-form'
import { sendSignal } from '@/lib/beacon'
import { IMAGE_TYPES, MAX_OPTIONS, MIN_OPTIONS, OPTION_LETTERS } from '@/lib/limits'
import { COVER_HEIGHTS, ETSY_CROPS, toolOf, type ToolKind } from '@/lib/tools'

const ACCEPT = IMAGE_TYPES.join(',')
const isAccepted = (file: File) => (IMAGE_TYPES as readonly string[]).includes(file.type)

/** One candidate as the mocks show it: its option letter, its local (blob:) URL and its file name. */
export type Shown = { letter: string; src: string; name: string }

type Candidate = {
  file: File
  /** The file's object URL: every preview draws from it, on the device. */
  src: string
  /** Its URL on tiebreak once uploaded, so trying again doesn't upload it twice. */
  uploaded: string | null
  /** Why its upload was refused, shown next to it. */
  error: string | null
}

export function ThumbnailTool({ kind }: { kind: ToolKind }) {
  const tool = toolOf(kind)
  const router = useRouter()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [skipped, setSkipped] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // This page counts its own visit, under its path; the layout's beacon leaves tool pages to it.
  useEffect(() => {
    sendSignal('visit', tool.path)
  }, [tool.path])

  // Object URLs live until their image is removed or the page goes.
  const current = useRef<Candidate[]>([])
  useEffect(() => {
    current.current = candidates
  }, [candidates])
  useEffect(
    () => () => {
      for (const c of current.current) URL.revokeObjectURL(c.src)
    },
    [],
  )

  function add(files: File[]) {
    setError(null)
    const room = MAX_OPTIONS - candidates.length
    const added: Candidate[] = []
    const wrongType: string[] = []
    const noRoom: string[] = []
    for (const file of files) {
      if (!isAccepted(file)) wrongType.push(file.name)
      else if (added.length >= room) noRoom.push(file.name)
      else added.push({ file, src: URL.createObjectURL(file), uploaded: null, error: null })
    }
    const notes = [
      wrongType.length > 0 && `Skipped ${wrongType.join(', ')}: pick JPEG, PNG or WebP images.`,
      noRoom.length > 0 && `Skipped ${noRoom.join(', ')}: a poll takes ${MAX_OPTIONS} images at most.`,
    ].filter(Boolean)
    setSkipped(notes.length > 0 ? notes.join(' ') : null)
    setCandidates((all) => [...all, ...added])
  }

  function remove(i: number) {
    URL.revokeObjectURL(candidates[i].src)
    setCandidates((all) => all.filter((_, j) => j !== i))
    setSkipped(null)
  }

  async function letStrangersPick() {
    setError(null)
    setBusy(true)
    try {
      const results = await Promise.all(candidates.map((c) => (c.uploaded ? { url: c.uploaded } : uploadPhoto(c.file))))
      setCandidates((all) =>
        all.map((c, i) => {
          const r = results[i]
          return 'url' in r ? { ...c, uploaded: r.url, error: null } : { ...c, error: r.error }
        }),
      )
      const urls = results.map((r) => ('url' in r ? r.url : null))
      if (urls.includes(null)) {
        setError("Some images didn't upload: the reason is next to each one, above.")
        setBusy(false)
        return
      }
      handOffToNewPoll({ question: tool.question, photos: candidates.map((c, i) => ({ file: c.file, url: urls[i]! })) })
      router.push('/')
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
    }
  }

  const full = candidates.length >= MAX_OPTIONS
  return (
    <>
      <div className="card tool-pick">
        <label className="photo-pick">
          <input
            type="file"
            className="visually-hidden"
            multiple
            accept={ACCEPT}
            aria-label="Add images"
            disabled={full || busy}
            onChange={(e) => {
              add([...(e.target.files ?? [])])
              e.target.value = '' // so picking the same file again still counts
            }}
          />
          <span className="pick">{candidates.length > 0 ? 'Add more images' : 'Add images'}</span>
          <span className="hint">
            {MIN_OPTIONS}–{MAX_OPTIONS} JPEG, PNG or WebP images. They stay on your device: they&apos;re uploaded only
            when you press Let strangers pick.
          </span>
        </label>
        {skipped && (
          <p className="hint" role="status">
            {skipped}
          </p>
        )}
        {candidates.length > 0 && (
          <ol className="candidates">
            {candidates.map((c, i) => (
              <li key={c.src}>
                <b>{OPTION_LETTERS[i]}</b> <span className="photo-name">{c.file.name}</span>{' '}
                <button type="button" className="link" disabled={busy} onClick={() => remove(i)}>
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
      </div>

      <Previews
        kind={kind}
        candidates={candidates.map((c, i) => ({ letter: OPTION_LETTERS[i], src: c.src, name: c.file.name }))}
      />

      <div className="card tool-cta">
        <p>
          Still torn? Put them to a vote. This uploads the images and opens a new poll with them as the options: set a
          vote target and a deadline, share the link, and the poll closes with a winner and the split.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" disabled={candidates.length < MIN_OPTIONS || busy} onClick={letStrangersPick}>
          {busy ? 'Uploading images…' : 'Let strangers pick'}
        </button>
        {candidates.length < MIN_OPTIONS && <p className="hint">Add at least {MIN_OPTIONS} images to make a poll.</p>}
      </div>
    </>
  )
}

/** The mocks: every candidate, side by side, the way the tool's platform shows it. Draws only from local URLs. */
export function Previews({ kind, candidates }: { kind: ToolKind; candidates: Shown[] }) {
  if (candidates.length === 0) return <p className="hint tool-empty">Your images show here, side by side, once you add them.</p>
  const Mock = MOCKS[kind]
  return (
    <div className="mocks">
      <Mock candidates={candidates} />
    </div>
  )
}

const MOCKS: Record<ToolKind, (props: { candidates: Shown[] }) => ReactNode> = {
  etsy: EtsyGrids,
  'book-cover': CoverShelves,
  youtube: YouTubeMocks,
}

/** Etsy: a search grid per crop (1:1, 4:3, 5:4), each image centre-cropped to it. */
function EtsyGrids({ candidates }: { candidates: Shown[] }) {
  return ETSY_CROPS.map((crop) => (
    <section key={crop.label} className="mock etsy-grid" data-crop={crop.label} aria-label={`Search grid, ${crop.label} crop`}>
      <h3>{crop.label} crop</h3>
      <div className="mock-grid">
        {candidates.map((c) => (
          <figure key={c.src} className="preview-tile etsy-card">
            <div className={`crop ${crop.className}`}>
              <img src={c.src} alt={`${c.letter}, ${c.name}, ${crop.label} crop`} />
            </div>
            <figcaption>
              <b>{c.letter}</b>
              <MockLines />
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  ))
}

/** Book covers: a shelf per height (160 and 80 px), each cover uncropped, next to the others. */
function CoverShelves({ candidates }: { candidates: Shown[] }) {
  return COVER_HEIGHTS.map((height) => (
    <section
      key={height}
      className={`mock cover-shelf shelf-${height}`}
      data-height={height}
      aria-label={`Covers ${height} pixels tall`}
    >
      <h3>About {height} px tall</h3>
      <div className="shelf">
        {candidates.map((c) => (
          <figure key={c.src} className="preview-tile cover">
            <img src={c.src} alt={`${c.letter}, ${c.name}, ${height} pixels tall`} />
            <figcaption>
              <b>{c.letter}</b>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  ))
}

/** YouTube: each thumbnail at 16:9 in a desktop grid, and again in a phone's feed. */
function YouTubeMocks({ candidates }: { candidates: Shown[] }) {
  return (
    <>
      <section className="mock yt-desktop" aria-label="Desktop grid">
        <h3>Desktop grid</h3>
        <div className="yt-grid">
          {candidates.map((c) => (
            <YouTubeTile key={c.src} candidate={c} where="desktop grid" />
          ))}
        </div>
      </section>
      <section className="mock yt-phone" aria-label="Phone feed">
        <h3>Phone feed</h3>
        <div className="phone-frame">
          {candidates.map((c) => (
            <YouTubeTile key={c.src} candidate={c} where="phone feed" />
          ))}
        </div>
      </section>
    </>
  )
}

/** A video tile: the thumbnail at 16:9 with a length badge over its corner, then the channel and title lines. */
function YouTubeTile({ candidate: c, where }: { candidate: Shown; where: string }) {
  return (
    <figure className="preview-tile yt-tile">
      <div className="crop ratio-16-9">
        <img src={c.src} alt={`${c.letter}, ${c.name}, ${where}`} />
        <span className="duration" aria-hidden="true">
          12:34
        </span>
      </div>
      <figcaption>
        <span className="avatar" aria-hidden="true" />
        <span className="lines">
          <b>{c.letter}</b>
          <MockLines />
        </span>
      </figcaption>
    </figure>
  )
}

/** Grey bars where a listing's or a video's title and details go. */
function MockLines() {
  return (
    <>
      <span className="mock-line" aria-hidden="true" />
      <span className="mock-line short" aria-hidden="true" />
    </>
  )
}
