import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { MakeYourOwn } from '@/app/p/[id]/poll-view'
import { Face } from '@/app/poll-parts'
import { OPTION_LETTERS as LETTERS } from '@/lib/limits'
import { getPublishedResult, type PollView } from '@/lib/polls'
import { optionLabel, pollIdOfSlug, resultDescription, resultPath, resultSlug, votes } from '@/lib/results'
import { cardAlt, cardPath } from '@/lib/share-card'
import { SHARE_IMAGE, SITE_NAME } from '@/lib/site'

// Read on every request: 3 reports take a page down, and a poll past its deadline closes on its first read.
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

const CLOSED_ON = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })

/** The published result an address points at, or null (no such poll, open, not opted in, no votes or hidden). */
async function resultFor(slug: string): Promise<PollView | null> {
  const id = pollIdOfSlug(slug)
  return id === null ? null : getPublishedResult(id)
}

/** Titled with the question alone (no " · tiebreak"), described by its winner and vote count, open to search. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const poll = await resultFor((await params).slug)
  if (!poll) return {}
  const path = resultPath(poll)
  const description = resultDescription(poll)
  // The poll's own share card, which shows the result once it has closed (GET /p/:id/card).
  const image = { url: cardPath(poll), width: SHARE_IMAGE.width, height: SHARE_IMAGE.height, alt: cardAlt(poll) }
  return {
    title: { absolute: poll.question },
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE_NAME, url: path, title: poll.question, description, images: [image] },
    twitter: { card: 'summary_large_image', title: poll.question, description, images: [image] },
  }
}

/**
 * A closed poll's result, published by its creator: the question, the winner, every option with its share of the
 * votes, and "Make your own tiebreak". Anything else at /results/… is a 404; other words before the id redirect.
 */
export default async function ResultPage({ params }: Props) {
  const { slug } = await params
  const poll = await resultFor(slug)
  if (!poll) notFound()
  if (slug !== resultSlug(poll)) permanentRedirect(resultPath(poll))

  const tally = poll.tally ?? poll.options.map(() => 0)
  const winner = poll.winner === null ? null : { option: poll.options[poll.winner], index: poll.winner }
  return (
    <article className="published-result">
      <h1>{poll.question}</h1>
      <p className="hint">
        Closed with {votes(poll.voteCount)}
        {poll.closedAt && (
          <>
            {' '}
            on <time dateTime={poll.closedAt}>{CLOSED_ON.format(new Date(poll.closedAt))}</time>
          </>
        )}
        . The votes came from people who opened the poll&apos;s link
        {poll.visibility === 'public' && ' or found it in the public feed'}, and its creator chose to publish the result.
      </p>

      <div className="card result">
        <h2>{winner ? `Winner: ${LETTERS[winner.index]} · ${optionLabel(winner.option, winner.index)}` : "It's a tie."}</h2>
        {winner?.option.imageUrl && <Face option={winner.option} index={winner.index} />}
        <ul className="bars split">
          {poll.options.map((option, i) => {
            const pct = poll.voteCount ? Math.round((100 * tally[i]) / poll.voteCount) : 0
            return (
              <li key={i} className={i === poll.winner ? 'win' : undefined}>
                {option.imageUrl && (
                  // Plain <img>, as on the poll page: options can be any https host.
                  <img className="split-thumb" src={option.imageUrl} alt={optionLabel(option, i)} referrerPolicy="no-referrer" loading="lazy" />
                )}
                <div className="split-row">
                  <div className="bar-label">
                    <span>
                      {LETTERS[i]} · {optionLabel(option, i)}
                    </span>
                    <span>
                      {votes(tally[i])} ({pct}%)
                    </span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <MakeYourOwn tag="result" />
    </article>
  )
}
