'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { sendSignal } from '@/lib/beacon'
import type { AccountView } from '@/lib/credits'
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_OPTION_TEXT_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_TARGET,
  MIN_OPTIONS,
  MIN_TARGET,
  OPTION_LETTERS as LETTERS,
} from '@/lib/limits'
import type { Plan } from '@/lib/plans'
import { clearPendingPoll, pendingPoll } from '@/lib/poll-handoff'

const DURATIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 6, label: '6 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
]
const DEFAULT_TARGET = 10
const DEFAULT_HOURS = 24

const PHOTO_ACCEPT = IMAGE_TYPES.join(',')
const PHOTO_HINT = `JPEG, PNG or WebP, up to ${MAX_IMAGE_BYTES / 1_000_000} MB`

type Draft = {
  text: string
  imageUrl: string
  /** A photo picked from the device. It's uploaded when the poll is posted, and wins over the link. */
  photo: File | null
  /** The photo's URL on tiebreak once uploaded, so posting again doesn't upload it twice. */
  uploaded: string | null
  /** Why the photo was refused, shown in this option. */
  photoError: string | null
}
const blank = (): Draft => ({ text: '', imageUrl: '', photo: null, uploaded: null, photoError: null })

/** The message for a refused upload: the server's own, else one for the status. */
function uploadError(status: number, body: { error?: unknown } | null) {
  if (typeof body?.error === 'string') return body.error
  // Vercel refuses a request body over 4.5 MB itself, before the app sees it.
  if (status === 413) return 'That photo is too big to upload. Try a smaller copy of it.'
  return "The photo didn't upload. Try again."
}

export function CreatePollForm({ account, plan }: { account: AccountView; plan: Plan }) {
  const router = useRouter()
  // Photos handed over by the Etsy photo test (lib/poll-handoff.ts): read as the form opens, then cleared.
  const [prefill] = useState(pendingPoll)
  useEffect(() => clearPendingPoll(), [])
  const [question, setQuestion] = useState(prefill?.question ?? '')
  const [options, setOptions] = useState<Draft[]>(() =>
    prefill ? prefill.photos.map((photo) => ({ ...blank(), photo })) : [blank(), blank()],
  )
  const [target, setTarget] = useState(String(DEFAULT_TARGET))
  const [durationHours, setDurationHours] = useState(DEFAULT_HOURS)
  const [isPublic, setIsPublic] = useState(false)
  // Private (Pro) and public are exclusive: a private poll never goes to the feed.
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<false | 'uploading' | 'creating'>(false)
  const canPostPublic = account.credits > 0

  const update = (i: number, patch: Partial<Draft>) =>
    setOptions((all) => all.map((o, j) => (j === i ? { ...o, ...patch } : o)))

  /**
   * Uploads each picked photo that isn't up yet, all at once. Returns each option's
   * photo URL (null without a photo), or null if any was refused: its option says why.
   */
  async function uploadPhotos(): Promise<(string | null)[] | null> {
    const results = await Promise.all(
      options.map(async (o, i): Promise<string | null | false> => {
        if (!o.photo) return null
        if (o.uploaded) return o.uploaded
        const res = await fetch('/images', {
          method: 'POST',
          headers: { 'content-type': o.photo.type || 'application/octet-stream' },
          body: o.photo,
        })
        const body = await res.json().catch(() => null)
        if (res.status === 201 && typeof body?.url === 'string') {
          update(i, { uploaded: body.url })
          return body.url
        }
        update(i, { photoError: uploadError(res.status, body) })
        return false
      }),
    )
    return results.includes(false) ? null : (results as (string | null)[])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setOptions((all) => all.map((o) => ({ ...o, photoError: null })))
    try {
      // Photos go up first; the poll is posted only once every one is stored.
      setBusy(options.some((o) => o.photo && !o.uploaded) ? 'uploading' : 'creating')
      const photos = await uploadPhotos()
      if (!photos) {
        setBusy(false)
        return
      }
      setBusy('creating')
      const res = await fetch('/polls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          options: options.map((o, i) => ({ text: o.text, imageUrl: photos[i] ?? (o.imageUrl.trim() || undefined) })),
          target: Number(target),
          durationHours,
          visibility: isPrivate ? 'private' : isPublic ? 'public' : 'unlisted',
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.status !== 201) {
        // A stored photo that can't be used any more is uploaded again next time.
        if (typeof body?.option === 'number') update(body.option, { uploaded: null, photoError: body.error })
        else setError(body?.error ?? 'Something went wrong. Try again.')
        setBusy(false)
        return
      }
      sendSignal('activate')
      router.push(`/p/${body.id}?new=1`)
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
    }
  }

  return (
    <form className="card create" onSubmit={submit}>
      {prefill && (
        <p className="notice">
          Your {prefill.photos.length} photos are options A–{LETTERS[prefill.photos.length - 1]} below. They upload
          when you create the poll.
        </p>
      )}
      <label>
        Question <span className="hint">(optional)</span>
        <input
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="Which listing photo should I use?"
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>

      {options.map((option, i) => (
        <fieldset key={i} className="option-input">
          <legend>Option {LETTERS[i]}</legend>
          <input
            aria-label={`Option ${LETTERS[i]} text`}
            value={option.text}
            maxLength={MAX_OPTION_TEXT_LENGTH}
            placeholder="Text"
            onChange={(e) => update(i, { text: e.target.value })}
          />
          {option.photo ? (
            <div className="photo">
              <Thumbnail file={option.photo} alt={`Option ${LETTERS[i]} photo preview`} />
              <button
                type="button"
                className="link"
                onClick={() => update(i, { photo: null, uploaded: null, photoError: null })}
              >
                Remove photo
              </button>
            </div>
          ) : (
            <input
              aria-label={`Option ${LETTERS[i]} image URL`}
              type="url"
              value={option.imageUrl}
              placeholder="https:// image link (optional)"
              onChange={(e) => update(i, { imageUrl: e.target.value })}
            />
          )}
          <label className="photo-pick">
            <input
              type="file"
              className="visually-hidden"
              accept={PHOTO_ACCEPT}
              aria-label={`Option ${LETTERS[i]} photo`}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) update(i, { photo: file, uploaded: null, photoError: null })
                e.target.value = '' // so picking the same file again still counts
              }}
            />
            <span className="pick">{option.photo ? 'Change photo' : 'Upload a photo'}</span>
            <span className="hint">{PHOTO_HINT}</span>
          </label>
          {option.photoError && (
            <p className="error" role="alert">
              {option.photoError}
            </p>
          )}
          {options.length > MIN_OPTIONS && (
            <button
              type="button"
              className="link"
              onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          )}
        </fieldset>
      ))}
      {options.length < MAX_OPTIONS && (
        <button type="button" className="secondary" onClick={() => setOptions((all) => [...all, blank()])}>
          + Add option
        </button>
      )}

      <div className="row">
        <label>
          Close at
          <input
            type="number"
            min={MIN_TARGET}
            max={MAX_TARGET}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <span className="hint">votes</span>
        </label>
        <label>
          or after
          <select value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={isPublic && !isPrivate}
          disabled={!canPostPublic || isPrivate}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        <span>
          Also post it to the public feed so strangers vote
          <span className="hint">
            {' '}
            (uses 1 of your {account.credits} {account.credits === 1 ? 'credit' : 'credits'})
          </span>
        </span>
      </label>
      {!canPostPublic && (
        <p className="hint">
          Link-only polls are free. A public post costs 1 credit: vote on {account.votesToNextCredit} more{' '}
          {account.votesToNextCredit === 1 ? 'poll' : 'polls'} in the <Link href="/feed">feed</Link> to earn
          one.
        </p>
      )}

      {plan === 'pro' ? (
        <label className="check">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          <span>
            Keep the result private: only you see the winner and the split
            <span className="hint"> (Pro)</span>
          </span>
        </label>
      ) : (
        <p className="hint">
          Want the result kept private, or every vote in a spreadsheet? <Link href="/pro">Get Pro</Link>.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy !== false}>
        {busy === 'uploading' ? 'Uploading photos…' : busy === 'creating' ? 'Creating…' : 'Create poll'}
      </button>
    </form>
  )
}

/**
 * A picked photo's preview, drawn from the file itself before anything is uploaded.
 * The object URL lives as long as this thumbnail. A file the browser can't draw
 * shows its name instead.
 */
function Thumbnail({ file, alt }: { file: File; alt: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  if (!src || failed === src) return <span className="photo-name">{file.name}</span>
  return <img className="thumb" src={src} alt={alt} onError={() => setFailed(src)} />
}
