import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { getPlan } from '@/lib/plans'
import { getPoll } from '@/lib/polls'
import { PollView } from './poll-view'

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
