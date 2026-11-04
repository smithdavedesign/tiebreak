import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { ReportButton } from '@/app/poll-parts'
import { PathVisit } from '@/app/visit-beacon'
import { OPTION_LETTERS } from '@/lib/limits'
import { getPublishedResult, type PollView } from '@/lib/polls'
import { optionLabel, resultIdOf, resultPath, resultSlug, resultSummary, shareOf } from '@/lib/results'
import { cardAlt, cardPath } from '@/lib/share-card'
import { SHARE_IMAGE, SITE_NAME } from '@/lib/site'

// Rendered on each request: 3 reports take a page down at once, and a poll's page appears when it closes.
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

const closedOn = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

/** The published result a slug points at; anything else is a 404 (lib/polls.ts getPublishedResult). */
async function publishedFor(slug: string): Promise<PollView> {
  const id = resultIdOf(slug)
  const poll = id === null ? null : await getPublishedResult(id)
  if (!poll) notFound()
  return poll
}

/** Titled with the poll's question alone; the description states the result. Open to search, unlike /p/:id. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const poll = await publishedFor((await params).slug)
  const path = resultPath(poll)
  const description = `${resultSummary(poll)} See every option's share of the vote, then make your own tiebreak poll.`
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
 * A closed poll's public result: its question, the winner (or the tie) and every option's votes, then "Make your
 * own tiebreak". Only for polls whose creator ticked "Publish the result when it closes" (lib/results.ts).
 */
export default async function ResultPage({ params }: Props) {
  const { slug } = await params
  const poll = await publishedFor(slug)
  // One address per result: a bare id or old words go to the poll's own.
  if (slug !== resultSlug(poll)) permanentRedirect(resultPath(poll))

  const tally = poll.tally ?? poll.options.map(() => 0)
  const votes = `${poll.voteCount} ${poll.voteCount === 1 ? 'vote' : 'votes'}`
  const closed = poll.closedAt ? ` on ${closedOn.format(new Date(poll.closedAt))}` : ''
  return (
    <article className="result-page">
      <p className="hint">A tiebreak poll, closed{closed} with {votes}</p>
      <h1>{poll.question}</h1>
      <div className="card result">
        <h2>{resultSummary(poll)}</h2>
        <ul className="bars">
          {poll.options.map((option, i) => {
            const label = optionLabel(option, i)
            const share = shareOf(tally[i], poll.voteCount)
            return (
              <li key={i} className={i === poll.winner ? 'win' : undefined}>
                {option.imageUrl && (
                  // Plain <img>, as on the poll page: options are arbitrary https hosts or tiebreak's own photos.
                  <img className="option-thumb" src={option.imageUrl} alt={label} referrerPolicy="no-referrer" />
                )}
                <div className="option-split">
                  <div className="bar-label">
                    <span>
                      {OPTION_LETTERS[i]} · {label}
                    </span>
                    <span>{`${tally[i]} ${tally[i] === 1 ? 'vote' : 'votes'} (${share}%)`}</span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${share}%` }} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="hint">
        The votes are anonymous, from people the poll&apos;s creator shared its link with
        {poll.visibility === 'public' ? ' and from strangers in tiebreak’s public feed' : ''}. It closed at its vote
        target or its deadline, whichever came first, and its creator chose to publish the result.
      </p>
      <div className="card make-own">
        <p>
          <b>Stuck on a choice of your own?</b> Post 2–4 options and share the link. It&apos;s free.
        </p>
        {/* A plain <a>: the full page load runs the layout's visit beacon, which records the ref=result tag. */}
        <a className="button" href="/?ref=result">
          Make your own tiebreak
        </a>
      </div>
      <p className="report-row">
        <ReportButton pollId={poll.id} />
      </p>
      <PathVisit path={resultPath(poll)} />
    </article>
  )
}
