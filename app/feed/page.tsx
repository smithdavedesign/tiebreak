import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { getAccount } from '@/lib/credits'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { VOTES_PER_CREDIT } from '@/lib/limits'
import { listFeed } from '@/lib/polls'
import { FeedView } from './feed-view'

export const metadata: Metadata = {
  title: 'Public feed',
  description: 'Swipe through open polls and help strangers decide. Every 5 votes earns you a public poll of your own.',
  alternates: { canonical: '/feed' },
}

/** The public feed: swipe through strangers' polls and earn posting credits. */
export default async function FeedPage() {
  const voter = (await cookies()).get(VOTER_COOKIE)?.value
  const viewer = isVoterId(voter) ? voter : null
  const [polls, account] = await Promise.all([listFeed(viewer), getAccount(viewer)])

  return (
    <>
      <h1>Break someone&apos;s tie</h1>
      <p className="lede">
        Pick a side on strangers&apos; polls. Every {VOTES_PER_CREDIT} votes earn a credit to post your own
        poll here.
      </p>
      <FeedView initialPolls={polls} initialAccount={account} />
    </>
  )
}
