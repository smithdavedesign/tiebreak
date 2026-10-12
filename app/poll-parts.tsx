'use client'

// Pieces shared by the poll page and the feed: the picker (swipe card for two
// options, grid for three or four), the report button and the credit meter.
import Link from 'next/link'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { AccountView } from '@/lib/credits'
import { OPTION_LETTERS, VOTES_PER_CREDIT } from '@/lib/limits'
import type { Option } from '@/lib/polls'
import { swipeChoice } from '@/lib/swipe'

export const LETTERS = OPTION_LETTERS
// A pointer that moves less than this is a tap, not a drag.
const TAP_SLOP_PX = 6

export const labelOf = (option: Option, i: number) => option.text ?? `Option ${LETTERS[i]}`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function Face({ option, index }: { option: Option; index: number }) {
  return (
    <div className="face">
      {option.imageUrl && (
        // Plain <img>: options are arbitrary https hosts, so next/image's optimiser doesn't apply.
        <img src={option.imageUrl} alt={labelOf(option, index)} referrerPolicy="no-referrer" draggable={false} />
      )}
      <span className="face-label">
        <b>{LETTERS[index]}</b> {option.text}
      </span>
    </div>
  )
}

export function Picker({
  options,
  onPick,
  disabled,
}: {
  options: Option[]
  onPick: (option: number) => void
  disabled: boolean
}) {
  if (options.length === 2) return <SwipeCard options={options} onPick={onPick} disabled={disabled} />
  return (
    <div className="grid">
      {options.map((option, i) => (
        <button key={i} type="button" className="face-button" disabled={disabled} onClick={() => onPick(i)}>
          <Face option={option} index={i} />
        </button>
      ))}
    </div>
  )
}

/** Two options on one card: drag left for A, right for B, or tap a side. */
function SwipeCard({
  options,
  onPick,
  disabled,
}: {
  options: Option[]
  onPick: (option: number) => void
  disabled: boolean
}) {
  const [dx, setDx] = useState(0)
  const drag = useRef<{ x: number; side: number | null; moved: boolean } | null>(null)

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return
    const side = (event.target as HTMLElement).closest<HTMLElement>('[data-side]')?.dataset.side
    drag.current = { x: event.clientX, side: side === undefined ? null : Number(side), moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const distance = event.clientX - drag.current.x
    if (Math.abs(distance) > TAP_SLOP_PX) drag.current.moved = true
    setDx(distance)
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    drag.current = null
    setDx(0)
    if (!current) return
    const choice = current.moved ? swipeChoice(event.clientX - current.x) : current.side
    if (choice !== null) onPick(choice)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    if (event.key === 'ArrowLeft') onPick(0)
    if (event.key === 'ArrowRight') onPick(1)
  }

  const leaning = swipeChoice(dx)
  return (
    <>
      <div
        className={`swipe-card${disabled ? ' disabled' : ''}`}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 25}deg)` }}
        role="group"
        aria-label="Swipe left for A or right for B. Arrow keys work too."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null
          setDx(0)
        }}
        onKeyDown={onKeyDown}
      >
        {options.map((option, i) => (
          <div key={i} data-side={i} className={`side${leaning === i ? ' leaning' : ''}`}>
            <Face option={option} index={i} />
          </div>
        ))}
      </div>
      <p className="hint center">← swipe left for A · tap either side · swipe right for B →</p>
      <div className="row center">
        {options.map((_, i) => (
          <button key={i} type="button" className="secondary" disabled={disabled} onClick={() => onPick(i)}>
            Pick {LETTERS[i]}
          </button>
        ))}
      </div>
    </>
  )
}

/**
 * Reports a poll after a confirm step (3 reports take a poll out of the feed,
 * so a stray tap shouldn't count). A repeat report counts as done.
 */
export function ReportButton({
  pollId,
  disabled = false,
  onReported,
}: {
  pollId: string
  disabled?: boolean
  onReported?: () => void
}) {
  const [state, setState] = useState<'idle' | 'confirm' | 'sending' | 'done' | 'failed'>('idle')

  async function send() {
    setState('sending')
    const res = await fetch(`/polls/${pollId}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => null)
    if (res?.status === 201 || res?.status === 409) {
      setState('done')
      onReported?.()
    } else {
      setState('failed')
    }
  }

  if (state === 'done') {
    return <p className="hint">Reported. Thanks, it won&apos;t show up in your feed again.</p>
  }
  if (state === 'confirm' || state === 'sending') {
    return (
      <div className="report-confirm" role="group" aria-label="Confirm report">
        <span>Report this poll as spam, offensive or illegal?</span>
        <button type="button" className="danger" disabled={state === 'sending'} onClick={() => void send()}>
          Report
        </button>
        <button type="button" className="link" onClick={() => setState('idle')}>
          Cancel
        </button>
      </div>
    )
  }
  return (
    <span className="report">
      <button type="button" className="link" disabled={disabled} onClick={() => setState('confirm')}>
        Report
      </button>
      {state === 'failed' && <span className="error"> The report didn&apos;t go through. Try again.</span>}
    </span>
  )
}

/** "Vote 5, post 1": the caller's credits and progress toward the next one. */
export function CreditMeter({ account, feedLink = false }: { account: AccountView; feedLink?: boolean }) {
  const done = VOTES_PER_CREDIT - account.votesToNextCredit
  return (
    <div className="meter" aria-live="polite">
      <p>
        <b>{plural(account.credits, 'credit')}</b> to post a public poll ·{' '}
        {plural(account.votesToNextCredit, 'more vote')} to earn the next
      </p>
      <div
        className="bar"
        role="progressbar"
        aria-label="Votes toward your next credit"
        aria-valuemin={0}
        aria-valuemax={VOTES_PER_CREDIT}
        aria-valuenow={done}
      >
        <div style={{ width: `${(100 * done) / VOTES_PER_CREDIT}%` }} />
      </div>
      <p className="hint">
        {account.credits > 0 && (
          <>
            <Link href="/">Post a public poll</Link>
            {feedLink && ' · '}
          </>
        )}
        {feedLink && <Link href="/feed">Vote on more polls in the feed</Link>}
      </p>
    </div>
  )
}
