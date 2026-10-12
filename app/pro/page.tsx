import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { confirmCheckout, getPlan } from '@/lib/plans'
import { getProPrice } from '@/lib/stripe'
import { UpgradeButton } from './upgrade-button'

export const metadata: Metadata = { title: 'Pro · tiebreak' }

/** What Pro adds and the upgrade button; also Stripe Checkout's return page (?session_id=…). */
export default async function ProPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const voter = (await cookies()).get(VOTER_COOKIE)?.value
  const viewer = isVoterId(voter) ? voter : null
  const { session_id: sessionId } = await searchParams
  const returned = typeof sessionId === 'string'
  // Back from Checkout: fulfil now instead of waiting for the webhook (Stripe's
  // recommended pattern; both paths record the same payment once).
  if (returned) await confirmCheckout(sessionId)
  const plan = await getPlan(viewer)
  const price = plan === 'pro' ? null : await getProPrice()

  return (
    <>
      <h1>tiebreak Pro</h1>
      {plan === 'pro' && (
        <p className="notice" role="status">
          {returned && 'Payment received, thank you. '}You have Pro on this browser.
        </p>
      )}
      {plan === 'free' && returned && (
        <p className="notice" role="status">
          We&apos;re confirming your payment with Stripe. This usually takes a few seconds, so refresh this page in a
          moment.
        </p>
      )}

      <ul className="features">
        <li>
          <b>Private polls.</b> Share the link as usual, but only you see the winner and the split.
        </li>
        <li>
          <b>CSV export.</b> Download every vote of a closed poll, with its time and option, for your spreadsheet.
        </li>
      </ul>

      {plan === 'pro' ? (
        <Link className="button" href="/">
          Create a private poll
        </Link>
      ) : (
        <div className="card">
          <p>
            {price ? <b>{price}</b> : 'One payment'}, paid once. No subscription
            {price ? '.' : ' (price shown at checkout).'}
          </p>
          <UpgradeButton price={price} />
          <p className="hint">
            There are no logins, so Pro belongs to this browser, like your polls and credits. If you clear cookies or
            switch devices you lose it; reply to your Stripe receipt for a refund. By paying you agree to the{' '}
            <Link href="/terms">terms</Link>.
          </p>
        </div>
      )}
    </>
  )
}
