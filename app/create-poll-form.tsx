'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { AccountView } from '@/lib/credits'
import {
  MAX_OPTION_TEXT_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_TARGET,
  MIN_OPTIONS,
  MIN_TARGET,
  OPTION_LETTERS as LETTERS,
} from '@/lib/limits'
import type { Plan } from '@/lib/plans'

const DURATIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 6, label: '6 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
]
const DEFAULT_TARGET = 10
const DEFAULT_HOURS = 24

type Draft = { text: string; imageUrl: string }
const blank = (): Draft => ({ text: '', imageUrl: '' })

export function CreatePollForm({ account, plan }: { account: AccountView; plan: Plan }) {
  const router = useRouter()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<Draft[]>([blank(), blank()])
  const [target, setTarget] = useState(String(DEFAULT_TARGET))
  const [durationHours, setDurationHours] = useState(DEFAULT_HOURS)
  const [isPublic, setIsPublic] = useState(false)
  // Private (Pro) and public are exclusive: a private poll never goes to the feed.
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canPostPublic = account.credits > 0

  const update = (i: number, patch: Partial<Draft>) =>
    setOptions((all) => all.map((o, j) => (j === i ? { ...o, ...patch } : o)))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/polls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          options: options.map((o) => ({ text: o.text, imageUrl: o.imageUrl.trim() || undefined })),
          target: Number(target),
          durationHours,
          visibility: isPrivate ? 'private' : isPublic ? 'public' : 'unlisted',
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.status !== 201) {
        setError(body?.error ?? 'Something went wrong. Try again.')
        setBusy(false)
        return
      }
      router.push(`/p/${body.id}?new=1`)
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
    }
  }

  return (
    <form className="card create" onSubmit={submit}>
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
          <input
            aria-label={`Option ${LETTERS[i]} image URL`}
            type="url"
            value={option.imageUrl}
            placeholder="https:// image link (optional)"
            onChange={(e) => update(i, { imageUrl: e.target.value })}
          />
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
      <button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create poll'}
      </button>
    </form>
  )
}
