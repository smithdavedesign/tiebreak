'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_OPTIONS, MIN_OPTIONS, OPTION_LETTERS as LETTERS } from '@/lib/limits'
import { handOffPoll } from '@/lib/poll-handoff'

/** The question the new poll opens with (the seller can change it on the form). */
export const POLL_QUESTION = 'Which photo would you click in Etsy search?'

/** One row of a desktop search grid (two rows on a phone): the photos, then stand-ins for other listings. */
const GRID_TILES = 4
const ACCEPT = IMAGE_TYPES.join(',')
const TYPES_LABEL = 'JPEG, PNG or WebP'
const MAX_MB = MAX_IMAGE_BYTES / 1_000_000

export type Skipped = { name: string; reason: string }

/**
 * Which of `files` can join the `have` photos already picked, in order: the photo types and size a poll
 * takes, and MAX_OPTIONS photos at most. The rest are skipped, each with the reason.
 */
export function takePhotos(have: number, files: File[]): { taken: File[]; skipped: Skipped[] } {
  const taken: File[] = []
  const skipped: Skipped[] = []
  for (const file of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) skipped.push({ name: file.name, reason: `not a ${TYPES_LABEL}` })
    else if (file.size > MAX_IMAGE_BYTES) skipped.push({ name: file.name, reason: `over ${MAX_MB} MB` })
    else if (have + taken.length >= MAX_OPTIONS) skipped.push({ name: file.name, reason: `a poll takes ${MAX_OPTIONS} photos at most` })
    else taken.push(file)
  }
  return { taken, skipped }
}

type Picked = { id: number; file: File }

/**
 * The photo test: pick or drop 2–4 photos, see each as a square tile in a mock Etsy search grid, then hand
 * them to the new-poll form. Everything here stays in the browser; the form uploads the photos when the
 * poll is created.
 */
export function PhotoTest() {
  const router = useRouter()
  const [photos, setPhotos] = useState<Picked[]>([])
  const [skipped, setSkipped] = useState<Skipped[]>([])
  const nextId = useRef(0)
  const full = photos.length >= MAX_OPTIONS
  const ready = photos.length >= MIN_OPTIONS

  function add(files: File[]) {
    if (files.length === 0) return
    const { taken, skipped } = takePhotos(photos.length, files)
    setSkipped(skipped)
    setPhotos((all) => [...all, ...taken.map((file) => ({ id: nextId.current++, file }))])
  }

  function letStrangersPick() {
    handOffPoll({ question: POLL_QUESTION, photos: photos.map((p) => p.file) })
    router.push('/')
  }

  return (
    <div className="photo-test">
      <label
        className="photo-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          add([...e.dataTransfer.files])
        }}
      >
        <input
          type="file"
          className="visually-hidden"
          multiple
          accept={ACCEPT}
          aria-label="Add photos"
          disabled={full}
          onChange={(e) => {
            add([...(e.target.files ?? [])])
            e.target.value = '' // so picking the same file again still counts
          }}
        />
        <span className="pick">{photos.length === 0 ? 'Add photos' : 'Add more photos'}</span>
        <span className="hint">
          {full
            ? `${MAX_OPTIONS} photos is the most a poll takes. Remove one to try another.`
            : `${MIN_OPTIONS}–${MAX_OPTIONS} photos, ${TYPES_LABEL}, up to ${MAX_MB} MB each. Or drop them here.`}
        </span>
      </label>
      {skipped.length > 0 && (
        <ul className="error skipped" role="alert">
          {skipped.map((s, i) => (
            <li key={i}>
              Skipped {s.name}: {s.reason}.
            </li>
          ))}
        </ul>
      )}

      <ul className="etsy-grid" aria-label="Mock Etsy search results">
        {photos.map((p, i) => (
          <Tile
            key={p.id}
            file={p.file}
            letter={LETTERS[i]}
            onRemove={() => setPhotos((all) => all.filter((q) => q.id !== p.id))}
          />
        ))}
        {Array.from({ length: Math.max(0, GRID_TILES - photos.length) }, (_, i) => (
          <li key={`other-${i}`} className="etsy-tile other" aria-hidden="true">
            <div className="etsy-thumb" />
            <Listing />
          </li>
        ))}
      </ul>

      <div className="photo-test-go">
        <button type="button" disabled={!ready} onClick={letStrangersPick}>
          Let strangers pick
        </button>
        <p className="hint">
          {ready
            ? `Opens a new poll with these ${photos.length} photos as options A–${LETTERS[photos.length - 1]}.`
            : `Add at least ${MIN_OPTIONS} photos to put them to a vote.`}
        </p>
      </div>
    </div>
  )
}

/** Grey bars where a search result shows its title, shop and price: no made-up text. */
function Listing() {
  return (
    <>
      <span className="etsy-line title" />
      <span className="etsy-line title short" />
      <span className="etsy-line shop" />
      <span className="etsy-line price" />
    </>
  )
}

/**
 * One picked photo as a search result: cropped to a square from the centre, drawn from the file itself
 * (an object URL that lives as long as the tile). A file the browser can't draw shows its name instead.
 */
function Tile({ file, letter, onRemove }: { file: File; letter: string; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <li className="etsy-tile">
      <div className="etsy-thumb">
        {src && failed !== src ? (
          <img src={src} alt={`Photo ${letter}: ${file.name}`} onError={() => setFailed(src)} />
        ) : (
          <span className="photo-name">{file.name}</span>
        )}
        <span className="etsy-letter">{letter}</span>
        <button type="button" className="etsy-remove" aria-label={`Remove photo ${letter}`} onClick={onRemove}>
          ×
        </button>
      </div>
      <Listing />
    </li>
  )
}
