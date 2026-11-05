import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { MakeYourOwn, ReportButton } from '@/app/poll-parts'
import { OPTION_LETTERS } from '@/lib/limits'
import { getPublishedResult, type PollView } from '@/lib/polls'
import { optionLabel, pollIdOfSlug, resultDescription, resultHeading, resultSlug, splitOf } from '@/lib/results'
import { cardAlt, cardPath } from '@/lib/share-card'
import { SHARE_IMAGE, SITE_NAME } from '@/lib/site'
import { ResultVisit } from './result-visit'

// Read per request: a poll's page appears when it closes and goes when it's reported.
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

/**
 * The published result for this address, or a 404: the poll must qualify (getPublishedResult) and the address
 * must be its own, so each result has exactly one. Shared by the metadata and the page within a request.
 */
const resultFor = cache(async (slug: string): Promise<PollView> => {
  const id = pollIdOfSlug(slug)
  const poll = id === null ? null : await getPublishedResult(id)
  if (!poll || resultSlug(poll) !== slug) notFound()
  return poll
})

/** Titled with the question itself (no " · tiebreak"), described by its result, and open to search. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const poll = await resultFor(slug)
  const path = `/results/${slug}`
  const description = resultDescription(poll)
  const image = { url: cardPath(poll), width: SHARE_IMAGE.width, height: SHARE_IMAGE.height, alt: cardAlt(poll) }
  return {
    title: { absolute: poll.question },
    description,
    alternates: { canonical: path },
    openGraph: { type: 'article', siteName: SITE_NAME, url: path, title: poll.question, description, images: [image] },
    twitter: { card: 'summary_large_image', title: poll.question, description, images: [image] },
  }
}

/** /results/<slug>: a closed poll's result, published by its creator (GROWTH.md, 2026-11-05). */
export default async function ResultPage({ params }: Props) {
  const { slug } = await params
  const poll = await resultFor(slug)
  const split = splitOf(poll)
  const closed = new Date(poll.closedAt ?? poll.closesAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <article className="published-result">
      <h1>{poll.question}</h1>
      <p className="hint">
        {`Closed on ${closed} with ${poll.voteCount} ${poll.voteCount === 1 ? 'vote' : 'votes'}. Its creator chose to publish the result.`}
      </p>
      <div className="card result">
        <h2>{resultHeading(poll)}</h2>
        <ul className="bars">
          {poll.options.map((option, i) => (
            <li key={i} className={i === poll.winner ? 'result-option win' : 'result-option'}>
              {option.imageUrl && (
                // Plain <img>: options are arbitrary https hosts, so next/image's optimiser doesn't apply.
                <img src={option.imageUrl} alt={optionLabel(option, i)} referrerPolicy="no-referrer" />
              )}
              <div>
                <div className="bar-label">
                  <span>{`${OPTION_LETTERS[i]} · ${optionLabel(option, i)}`}</span>
                  <span>{`${split[i].votes} ${split[i].votes === 1 ? 'vote' : 'votes'} (${split[i].percent}%)`}</span>
                </div>
                <div className="bar">
                  <div style={{ width: `${split[i].percent}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <MakeYourOwn from="results" />
      <p className="report-row">
        <ReportButton pollId={poll.id} />
      </p>
      <ResultVisit path={`/results/${slug}`} />
    </article>
  )
}
