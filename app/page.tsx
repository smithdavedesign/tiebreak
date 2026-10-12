import { cookies } from 'next/headers'
import Link from 'next/link'
import { getAccount } from '@/lib/credits'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { getPlan } from '@/lib/plans'
import { CreatePollForm } from './create-poll-form'

export default async function HomePage() {
  const voter = (await cookies()).get(VOTER_COOKIE)?.value
  const viewer = isVoterId(voter) ? voter : null
  const [account, plan] = await Promise.all([getAccount(viewer), getPlan(viewer)])

  return (
    <>
      <h1>Can&apos;t choose? Let them swipe.</h1>
      <p className="lede">
        Add 2–4 options, pick how many votes you need and how long to wait, then share the link.
        The poll closes at the vote target or the deadline, whichever comes first.
      </p>
      <p className="hint">
        Want strangers to vote too? <Link href="/feed">Vote in the public feed</Link> to earn credits for
        posting there.
      </p>
      <CreatePollForm account={account} plan={plan} />
    </>
  )
}
