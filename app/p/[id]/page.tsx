import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { getPlan } from '@/lib/plans'
import { getPoll } from '@/lib/polls'
import { cardAlt, cardPath } from '@/lib/share-card'
import { SHARE_IMAGE, SITE_NAME } from '@/lib/site'
import { PollView } from './poll-view'

/**
 * A poll's own title and share card (its question and options, then its result: GET /p/:id/card);
 * kept out of search (it's someone's link, not a page to find).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const poll = await getPoll(id, null).catch(() => null)
  const title = poll?.question || 'Help me decide'
  const description = poll
    ? `Swipe to vote: ${poll.options.map((o, i) => o.text || `option ${'ABCD'[i]}`).join(' or ')}.`
    : undefined
  const image = poll
    ? { url: cardPath(poll), width: SHARE_IMAGE.width, height: SHARE_IMAGE.height, alt: cardAlt(poll) }
    : SHARE_IMAGE
  return {
    title,
    description,
    robots: { index: false, follow: false },
    // Replaces the layout's share tags wholesale, so the site name goes in again.
    openGraph: { type: 'website', siteName: SITE_NAME, url: `/p/${id}`, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

/** The share URL: swipe to vote while open, the result page once closed. */
export default async function PollPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const voter = (await cookies()).get(VOTER_COOKIE)?.value
  const viewer = isVoterId(voter) ? voter : null
  const poll = await getPoll(id, viewer)
  if (!poll) notFound()
  // Only the creator's plan matters here (the CSV export); nobody else's is looked up.
  const plan = poll.mine ? await getPlan(viewer) : 'free'

  return <PollView initial={poll} justCreated={(await searchParams).new === '1'} plan={plan} />
}
