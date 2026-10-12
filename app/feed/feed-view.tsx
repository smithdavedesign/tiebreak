'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import type { AccountView } from '@/lib/credits'
import type { PollView as Poll } from '@/lib/polls'
import { CreditMeter, LETTERS, Picker, ReportButton, labelOf } from '@/app/poll-parts'

type Notice = { text: string; href?: string }

/** One poll at a time: vote, skip or report, then the next card. */
export function FeedView({ initialPolls, initialAccount }: { initialPolls: Poll[]; initialAccount: AccountView }) {
  const [queue, setQueue] = useState(initialPolls)
  const [account, setAccount] = useState(initialAccount)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const sending = useRef(false)
  // Polls handled this session (voted, skipped or reported); a refill never shows them again.
  const seen = useRef(new Set<string>())
  const poll = queue[0]

  async function refill() {
    setLoading(true)
    const res = await fetch('/polls', { cache: 'no-store' }).catch(() => null)
    const polls: Poll[] = res?.ok ? (await res.json()).polls : []
    setQueue(polls.filter((p) => !seen.current.has(p.id)))
    setLoading(false)
  }

  function advance(id: string) {
    seen.current.add(id)
    const rest = queue.filter((p) => !seen.current.has(p.id))
    setQueue(rest)
    if (rest.length === 0) void refill()
  }

  async function vote(option: number) {
    if (!poll || sending.current) return
    const current = poll
    sending.current = true
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`/polls/${current.id}/votes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ option }),
      })
      if (res.status === 201) {
        const body = await res.json()
        setAccount(body.account)
        setNotice({
          text: `You picked ${LETTERS[option]} · ${labelOf(current.options[option], option)}. See the result`,
          href: `/p/${current.id}`,
        })
        advance(current.id)
      } else if (res.status === 409 || res.status === 410 || res.status === 404) {
        setNotice({ text: res.status === 410 ? 'That poll just closed.' : 'You already voted on that one.' })
        advance(current.id)
      } else {
        setNotice({ text: 'Your vote did not go through. Try again.' })
      }
    } catch {
      setNotice({ text: 'Network error. Try again.' })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <section>
      <CreditMeter account={account} />

      {notice && (
        <p className="notice" role="status">
          {notice.text}
          {notice.href && (
            <>
              {' '}
              <Link href={notice.href}>when it closes</Link>.
            </>
          )}
        </p>
      )}

      {poll ? (
        <article key={poll.id} className="card feed-card">
          <h2>{poll.question || 'Which one?'}</h2>
          <p className="hint">
            {poll.voteCount} of {poll.target} votes so far
          </p>
          <Picker options={poll.options} onPick={vote} disabled={busy} />
          <div className="feed-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => advance(poll.id)}>
              Skip
            </button>
            <ReportButton
              pollId={poll.id}
              disabled={busy}
              onReported={() => {
                setNotice({ text: "Reported. That poll won't show up in your feed again." })
                advance(poll.id)
              }}
            />
          </div>
        </article>
      ) : (
        <div className="card">
          {loading ? (
            <p>Loading more polls…</p>
          ) : (
            <>
              <p>
                <b>You&apos;re all caught up.</b> No other public polls are waiting for a vote right now.
              </p>
              <div className="row">
                <button type="button" className="secondary" onClick={() => void refill()}>
                  Check again
                </button>
                <Link className="button" href="/">
                  Create a poll
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
