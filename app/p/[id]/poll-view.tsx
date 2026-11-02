'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AccountView } from '@/lib/credits'
import { emailHtml, postHtml, postMarkdown } from '@/lib/newsletter'
import type { Plan } from '@/lib/plans'
import type { Option, PollView as Poll } from '@/lib/polls'
import { CreditMeter, Face, LETTERS, Picker, ReportButton, labelOf } from '@/app/poll-parts'

const TICK_MS = 30_000
const MINUTE_MS = 60_000

const CREATED_NOTICE: Record<Poll['visibility'], string> = {
  unlisted: 'Your poll is live. Share the link below to collect votes.',
  public: 'Your poll is live in the public feed. Share the link below to get votes faster.',
  private: 'Your private poll is live. Only you will see the result. Share the link below to collect votes.',
}

/**
 * `plan` is the viewer's, and only matters when they created the poll (CSV export). `picked` is the option a
 * newsletter link chose (`?pick=`), or null. `siteUrl` is the newsletter links' origin until this page knows its own.
 */
export function PollView({
  initial,
  justCreated,
  plan,
  picked,
  siteUrl,
}: {
  initial: Poll
  justCreated: boolean
  plan: Plan
  picked: number | null
  siteUrl: string
}) {
  const [poll, setPoll] = useState(initial)
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

      {open && poll.myVote === null && picked === null && (
        <Picker options={poll.options} onPick={vote} disabled={busy} />
      )}
      {open && poll.myVote === null && picked !== null && (
        <ConfirmPick options={poll.options} initial={picked} onConfirm={vote} disabled={busy} />
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
      {open && poll.mine && <NewsletterPanel poll={poll} siteUrl={siteUrl} />}
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

/**
 * A newsletter link's landing (`?pick=B`): B is picked, not voted for. Inbox link scanners and prefetchers open
 * links too, so only "Confirm vote" votes, and the reader can change the pick first.
 */
function ConfirmPick({
  options,
  initial,
  onConfirm,
  disabled,
}: {
  options: Option[]
  initial: number
  onConfirm: (option: number) => void
  disabled: boolean
}) {
  const [choice, setChoice] = useState(initial)
  return (
    <div className="card confirm-pick">
      <fieldset>
        <legend>
          Your pick is <b>{LETTERS[choice]}</b>. Tap another option to change it.
        </legend>
        <div className="grid">
          {options.map((option, i) => (
            <label key={i} className={`face-button pick-option${i === choice ? ' chosen' : ''}`}>
              <input
                type="radio"
                name="pick"
                value={i}
                className="visually-hidden"
                checked={i === choice}
                disabled={disabled}
                onChange={() => setChoice(i)}
              />
              <Face option={option} index={i} />
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="confirm" disabled={disabled} onClick={() => onConfirm(choice)}>
        Confirm vote
      </button>
    </div>
  )
}

/**
 * The creator's newsletter blocks (lib/newsletter.ts), while the poll is open: one link per option, each opening
 * this poll with that option picked. Above them, the email block as an inbox shows it.
 */
function NewsletterPanel({ poll, siteUrl }: { poll: Poll; siteUrl: string }) {
  // The links point where this page is, like the share link (a preview deployment's polls live there).
  const [origin, setOrigin] = useState(siteUrl)
  const [copied, setCopied] = useState<'email' | 'post' | null>(null)
  useEffect(() => setOrigin(window.location.origin), [])
  const email = emailHtml(poll, origin)

  return (
    <section className="card newsletter" aria-labelledby="newsletter-title">
      <h2 id="newsletter-title">Get votes from your newsletter</h2>
      <p className="hint">
        Paste a block into your next email or post. Each option links to its own vote: a reader taps their pick, then
        confirms it here, so link checkers in inboxes can&apos;t vote for anyone.
      </p>
      <EmailPreview html={email} />
      <CopyBlock
        action="Copy email block (HTML)"
        label="Email block (HTML)"
        format="HTML"
        plain={email}
        html={email}
        copied={copied === 'email'}
        onCopied={() => setCopied('email')}
      >
        A table of the options for email: paste it into your email tool&apos;s HTML block, or into an email you&apos;re
        writing.
      </CopyBlock>
      <CopyBlock
        action="Copy Substack block (Markdown)"
        label="Substack block (Markdown)"
        format="Markdown"
        plain={postMarkdown(poll, origin)}
        html={postHtml(poll, origin)}
        copied={copied === 'post'}
        onCopied={() => setCopied('post')}
      >
        An image and a link per option: paste it into a Substack post, or anywhere that takes Markdown.
      </CopyBlock>
    </section>
  )
}

/**
 * The email block as an inbox shows it. The frame runs no scripts (an empty sandbox but for same-origin, so its
 * height can be read) and takes no clicks or focus (inert); the block's text is escaped in lib/newsletter.ts too.
 */
function EmailPreview({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const fit = () => {
      const doc = el.contentDocument
      if (doc?.body) el.style.height = `${doc.documentElement.scrollHeight}px`
    }
    fit()
    el.addEventListener('load', fit)
    return () => el.removeEventListener('load', fit)
  }, [html])
  return (
    <iframe
      ref={frame}
      className="newsletter-preview"
      title="Preview of the email block"
      sandbox="allow-same-origin"
      inert
      srcDoc={`<!doctype html><meta name="referrer" content="no-referrer"><body style="margin:0;padding:12px;background:#fff">${html}</body>`}
    />
  )
}

/**
 * One block's copy button. The clipboard gets the block's text and its HTML: editors that take rich text paste the
 * HTML, plain boxes the text. Without clipboard access, the text shows selected, to copy by hand.
 */
function CopyBlock({
  action,
  label,
  format,
  plain,
  html,
  copied,
  onCopied,
  children,
}: {
  action: string
  label: string
  format: string
  plain: string
  html: string
  copied: boolean
  onCopied: () => void
  children: ReactNode
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  async function copy() {
    try {
      if (typeof ClipboardItem === 'undefined') {
        await navigator.clipboard.writeText(plain)
      } else {
        const item = new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })
        await navigator.clipboard.write([item])
      }
      onCopied()
    } catch {
      if (details.current) details.current.open = true
      area.current?.select()
    }
  }

  return (
    <div className="copy-block">
      <button type="button" onClick={() => void copy()}>
        {copied ? 'Copied' : action}
      </button>
      <p className="hint">{children}</p>
      <details ref={details}>
        <summary>Show the {format}</summary>
        <textarea ref={area} readOnly rows={8} value={plain} aria-label={label} onFocus={(e) => e.target.select()} />
      </details>
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
