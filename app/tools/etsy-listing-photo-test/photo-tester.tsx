'use client'

import { useEffect, useRef, useState } from 'react'
import { CreatePollForm, Thumbnail } from '@/app/create-poll-form'
import { sendSignal } from '@/lib/beacon'
import type { AccountView } from '@/lib/credits'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_OPTIONS, MIN_OPTIONS, OPTION_LETTERS as LETTERS } from '@/lib/limits'
import type { Plan } from '@/lib/plans'
import { ETSY_PHOTO_TEST_PATH } from '@/lib/site'

const PHOTO_ACCEPT = IMAGE_TYPES.join(',')
const PHOTO_HINT = `JPEG, PNG or WebP, up to ${MAX_IMAGE_BYTES / 1_000_000} MB`
/** The poll's question to start with, in the Etsy forum's own words (RESEARCH.md). */
const QUESTION = 'Which picture do you think is best for my Etsy listing?'
const MAX_TITLE_LENGTH = 140
const MAX_PRICE_LENGTH = 20

type Picked = { id: number; file: File }

/** Why a file can't be a candidate, or null. The server checks the bytes again when the poll is posted. */
export function refusal(file: File): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return `${file.name}: only ${PHOTO_HINT}.`
  if (file.size > MAX_IMAGE_BYTES) return `${file.name} is over ${MAX_IMAGE_BYTES / 1_000_000} MB. Try a smaller copy of it.`
  return null
}

/**
 * 2–4 candidate main photos as square tiles in a mock Etsy search grid, drawn from the files on this
 * device (nothing is uploaded), then "Let strangers pick": the usual new-poll form, with the photos as
 * its options. They upload when that form posts the poll, as any picked photo does.
 */
export function PhotoTester({ account, plan }: { account: AccountView; plan: Plan }) {
  const [photos, setPhotos] = useState<Picked[]>([])
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const nextId = useRef(0)
  const pollRef = useRef<HTMLElement>(null)

  // The layout's beacon runs once per page load; following a link here from another page mounts only this.
  useEffect(() => sendSignal('visit', ETSY_PHOTO_TEST_PATH), [])

  const ready = photos.length >= MIN_OPTIONS
  const showPoll = open && ready
  useEffect(() => {
    if (showPoll) pollRef.current?.scrollIntoView({ block: 'start' })
  }, [showPoll])

  function add(files: FileList | null) {
    const skipped: string[] = []
    const added: Picked[] = []
    for (const file of Array.from(files ?? [])) {
      const why = refusal(file)
      if (why) skipped.push(why)
      else if (photos.length + added.length >= MAX_OPTIONS) skipped.push(`${file.name} wasn't added: a poll takes up to ${MAX_OPTIONS} photos.`)
      else added.push({ id: nextId.current++, file })
    }
    setPhotos((all) => [...all, ...added])
    setNotes(skipped)
  }

  function remove(id: number) {
    setPhotos((all) => all.filter((p) => p.id !== id))
    setNotes([])
  }

  const shownTitle = title.trim() || 'Your listing title'
  return (
    <>
      <div className="card tester-fields">
        <label>
          Listing title <span className="hint">(optional)</span>
          <input
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Speckled ceramic mug, 12 oz"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Price <span className="hint">(optional)</span>
          <input value={price} maxLength={MAX_PRICE_LENGTH} placeholder="$28.00" onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>

      <section className="etsy-mock" aria-label="Mock Etsy search results">
        <div className="etsy-search" aria-hidden="true">
          {title.trim() || 'Search for anything'}
        </div>
        <ul className="etsy-grid">
          {photos.map((p, i) => (
            <li key={p.id} className="etsy-tile">
              <div className="etsy-photo">
                <Thumbnail file={p.file} alt={`Photo ${LETTERS[i]}`} className="etsy-img" />
                <span className="etsy-letter">{LETTERS[i]}</span>
                <button
                  type="button"
                  className="etsy-remove"
                  aria-label={`Remove photo ${LETTERS[i]}`}
                  onClick={() => remove(p.id)}
                >
                  ×
                </button>
              </div>
              <p className="etsy-title">{shownTitle}</p>
              {price.trim() && <p className="etsy-price">{price.trim()}</p>}
            </li>
          ))}
          {photos.length < MAX_OPTIONS && (
            <li className="etsy-tile">
              <label className="etsy-add">
                <input
                  type="file"
                  multiple
                  className="visually-hidden"
                  accept={PHOTO_ACCEPT}
                  aria-label="Add photos"
                  onChange={(e) => {
                    add(e.target.files)
                    e.target.value = '' // so picking the same file again still counts
                  }}
                />
                <span className="pick">{photos.length === 0 ? `+ Add ${MIN_OPTIONS}–${MAX_OPTIONS} photos` : '+ Add a photo'}</span>
                <span className="hint">{PHOTO_HINT}</span>
              </label>
            </li>
          )}
        </ul>
        <p className="hint etsy-caption">A mock-up of Etsy search results, not Etsy itself. Each photo is cropped square from its centre.</p>
      </section>

      {notes.length > 0 && (
        <div className="error" role="alert">
          {notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      )}

      <div className="tester-cta">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            setOpen(true)
            pollRef.current?.scrollIntoView({ block: 'start' })
          }}
        >
          Let strangers pick
        </button>
        <span className="hint">
          {ready
            ? 'Your photos stay on this device until you post the poll.'
            : `Add at least ${MIN_OPTIONS} photos. They stay on this device until you post a poll.`}
        </span>
      </div>

      {showPoll && (
        <section ref={pollRef} className="tester-poll" aria-labelledby="new-poll-heading">
          <h2 id="new-poll-heading">New poll</h2>
          <p className="hint">
            Your photos are options {LETTERS[0]}–{LETTERS[photos.length - 1]}. Set a vote target and a deadline, then
            post it: the photos upload, and you get a link to share.
          </p>
          <CreatePollForm
            key={photos.map((p) => p.id).join('-')}
            account={account}
            plan={plan}
            initialQuestion={QUESTION}
            initialPhotos={photos.map((p) => p.file)}
          />
        </section>
      )}
    </>
  )
}
