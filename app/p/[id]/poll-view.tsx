'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountView } from '@/lib/credits'
import type { Plan } from '@/lib/plans'
import type { PollView as Poll } from '@/lib/polls'
import { CreditMeter, Face, LETTERS, Picker, ReportButton, labelOf } from '@/app/poll-parts'
import { NewsletterPanel } from './newsletter-panel'

const TICK_MS = 30_000
const MINUTE_MS = 60_000

const CREATED_NOTICE: Record<Poll['visibility'], string> = {
  unlisted: 'Your poll is live. Share the link below to collect votes.',
  public: 'Your poll is live in the public feed. Share the link below to get votes faster.',
  private: 'Your private poll is live. Only you will see the result. Share the link below to collect votes.',
}

/**
 * `plan` is the viewer's, and only matters when they created the poll (CSV export). `pick` is the option a
 * newsletter's vote link chose (`?pick=B`): it starts preselected, and nothing is cast until "Confirm vote".
 * `siteUrl` is the server's address for the site, which the newsletter blocks use until the page has loaded.
 */
export function PollView({
  initial,
  justCreated,
  plan,
  pick = null,
  siteUrl,
}: {
  initial: Poll
  justCreated: boolean
  plan: Plan
  pick?: number | null
  siteUrl: string
}) {
  const [poll, setPoll] = useState(initial)
  const [choice, setChoice] = useState(pick)
  // The voter's credits, known once they vote here (the vote response carries them).
  const [account, setAccount] = useState<AccountView | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const sending = useRef(false)
  const now = useNow()

  const refresh = useCallback(async () => {
    const res = await fetch(`/polls/${poll.id}`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setPoll((await res.json()).poll)
  }, [poll.id])

  // Drop ?new=1 so a creator who copies the address bar shares the clean link.
  useEffect(() => {
    if (justCreated) window.history.replaceState(null, '', `/p/${initial.id}`)
  }, [justCreated, initial.id])

  // The server closes a poll lazily; ask once the deadline passes on screen.
  const pastDeadline = now !== null && now >= Date.parse(poll.closesAt)
  useEffect(() => {
    if (pastDeadline && poll.status === 'open') void refresh()
  }, [pastDeadline, poll.status, refresh])

  async function vote(option: number) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`/polls/${poll.id}/votes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ option }),
      })
      if (res.status === 201) {
        const body = await res.json()
        setPoll(body.poll)
        setAccount(body.account)
        // Voted from a vote link: the address bar becomes the plain share link, so a copied address doesn't
        // preselect this pick for someone else or count their visit as a newsletter one.
        if (pick !== null) window.history.replaceState(null, '', `/p/${initial.id}`)
        return
      }
      if (res.status === 409) setNotice('You already voted on this poll.')
      else if (res.status === 410) setNotice('This poll closed before your vote arrived.')
      else setNotice('Your vote did not go through. Try again.')
      await refresh()
    } catch {
      setNotice('Network error. Try again.')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const open = poll.status === 'open'
  // A private poll's result is the creator's alone; the server sends nobody else the split.
  const resultHidden = poll.visibility === 'private' && !poll.mine
  return (
    <section>
      {justCreated && <p className="notice">{CREATED_NOTICE[poll.visibility]}</p>}
      <h1>{poll.question || 'Which one?'}</h1>
      <p className="hint">
        {open
          ? `${poll.voteCount} of ${poll.target} votes · ${now === null ? '' : timeLeft(Date.parse(poll.closesAt) - now)}`
          : `Closed with ${poll.voteCount} ${poll.voteCount === 1 ? 'vote' : 'votes'}`}
      </p>

      {open && poll.myVote === null && choice === null && (
        <Picker options={poll.options} onPick={vote} disabled={busy} />
      )}
      {open && poll.myVote === null && choice !== null && (
        <ConfirmPick
          options={poll.options}
          choice={choice}
          onChoose={setChoice}
          onConfirm={() => void vote(choice)}
          disabled={busy}
        />
      )}
      {open && poll.myVote !== null && (
        <div className="card">
          <p>
            You picked <b>{labelOf(poll.options[poll.myVote], poll.myVote)}</b>.
          </p>
          <p className="hint">
            {resultHidden
              ? 'This is a private poll: its creator keeps the result private.'
              : `The result shows here when the poll reaches ${poll.target} votes or the time runs out.`}
          </p>
          <button type="button" className="secondary" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      )}
      {!open && (resultHidden ? <PrivateResult poll={poll} /> : <Result poll={poll} />)}
      {!open && poll.mine && <Export id={poll.id} plan={plan} />}
      {!poll.mine && (poll.myVote !== null || !open) && <MakeYourOwn />}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {account && !poll.mine && <CreditMeter account={account} feedLink />}
      <ShareLink id={poll.id} />
      {poll.mine && open && <NewsletterPanel poll={poll} siteUrl={siteUrl} />}
      {!poll.mine && (
        <p className="report-row">
          <ReportButton pollId={poll.id} />
        </p>
      )}
    </section>
  )
}

function useNow() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

function timeLeft(ms: number) {
  if (ms <= 0) return 'closing now'
  const minutes = Math.ceil(ms / MINUTE_MS)
  if (minutes < 60) return `${minutes}m left`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m left`
  return `${Math.floor(hours / 24)}d ${hours % 24}h left`
}

/**
 * Opened from a newsletter's vote link: that option is selected, tapping another changes the selection only, and
 * one button casts the vote. Opening the link never votes (email link scanners open links too). The button comes
 * before the options so it's on screen when the page opens, on a phone too.
 */
function ConfirmPick({
  options,
  choice,
  onChoose,
  onConfirm,
  disabled,
}: {
  options: Poll['options']
  choice: number
  onChoose: (option: number) => void
  onConfirm: () => void
  disabled: boolean
}) {
  return (
    <div className="confirm-pick">
      <p>
        Your pick: <b>{labelOf(options[choice], choice)}</b>
      </p>
      <button type="button" className="confirm" disabled={disabled} onClick={onConfirm}>
        Confirm vote
      </button>
      <p className="hint">Changed your mind? Tap another option before you confirm.</p>
      <div className="grid">
        {options.map((option, i) => (
          <button
            key={i}
            type="button"
            className={`face-button${i === choice ? ' chosen' : ''}`}
            aria-pressed={i === choice}
            disabled={disabled}
            onClick={() => onChoose(i)}
          >
            <Face option={option} index={i} />
          </button>
        ))}
      </div>
    </div>
  )
}

function Result({ poll }: { poll: Poll }) {
  const tally = poll.tally ?? poll.options.map(() => 0)
  const heading =
    poll.status === 'no_result'
      ? 'No votes came in before the deadline.'
      : poll.winner === null
        ? "It's a tie."
        : `Winner: ${LETTERS[poll.winner]} · ${labelOf(poll.options[poll.winner], poll.winner)}`

  return (
    <div className="card result">
      <h2>{heading}</h2>
      {poll.winner !== null && poll.options[poll.winner].imageUrl && (
        <Face option={poll.options[poll.winner]} index={poll.winner} />
      )}
      <ul className="bars">
        {poll.options.map((option, i) => {
          const pct = poll.voteCount ? Math.round((100 * tally[i]) / poll.voteCount) : 0
          return (
            <li key={i} className={i === poll.winner ? 'win' : undefined}>
              <div className="bar-label">
                <span>
                  {LETTERS[i]} · {labelOf(option, i)}
                </span>
                <span>
                  {tally[i]} ({pct}%)
                </span>
              </div>
              <div className="bar">
                <div style={{ width: `${pct}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
      {poll.myVote !== null && <p className="hint">You voted {LETTERS[poll.myVote]}.</p>}
    </div>
  )
}

/** A closed private poll, as anyone but its creator sees it. */
function PrivateResult({ poll }: { poll: Poll }) {
  return (
    <div className="card result">
      <h2>This poll has closed.</h2>
      <p>Its creator keeps the result private. Thanks for voting!</p>
      {poll.myVote !== null && <p className="hint">You voted {LETTERS[poll.myVote]}.</p>}
    </div>
  )
}

/**
 * The voter loop: once someone has voted here (or the poll closed before they could), invite
 * them to post their own. A plain <a>, not <Link>: the full page load runs the layout's visit
 * beacon on arrival, which records the ref=poll tag.
 */
function MakeYourOwn() {
  return (
    <div className="card make-own">
      <p>
        <b>Stuck on a choice of your own?</b> Post 2–4 options and share the link. It&apos;s free.
      </p>
      <a className="button" href="/?ref=poll">
        Make your own tiebreak
      </a>
    </div>
  )
}

/** The creator's CSV download of a closed poll (Pro), or where to get it. */
function Export({ id, plan }: { id: string; plan: Plan }) {
  if (plan === 'pro') {
    return (
      <p className="export">
        <a className="button" href={`/polls/${id}/export`} download>
          Download votes (CSV)
        </a>
      </p>
    )
  }
  return (
    <p className="export hint">
      <Link href="/pro">Get Pro</Link> to download every vote as a CSV.
    </p>
  )
}

function ShareLink({ id }: { id: string }) {
  const [url, setUrl] = useState(`/p/${id}`)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => setUrl(`${window.location.origin}/p/${id}`), [id])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      input.current?.select()
    }
  }

  return (
    <div className="share">
      <input ref={input} readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
      <button type="button" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}
