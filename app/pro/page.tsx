import { cookies } from 'next/headers'
import Link from 'next/link'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { confirmCheckout, getPlan } from '@/lib/plans'
import { PRICE, pageMetadata } from '@/lib/site'
import { getProPrice, paymentsReady } from '@/lib/stripe'
import { UpgradeButton } from './upgrade-button'

export const metadata = pageMetadata(
  '/pro',
  'Pro',
  `tiebreak Pro: private polls where only you see the result, and CSV export of your votes. ${PRICE.label}, paid once.`,
)

/**
 * What Pro adds and the Buy button; also Stripe Checkout's return page (?session_id=…). The button shows
 * only when payments are set up (STRIPE_PAYMENT_LINK in production), so nobody clicks into an error.
 */
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
  const forSale = plan === 'free' && paymentsReady()
  const price = forSale ? await getProPrice() : null

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
      ) : !forSale ? (
        <p className="card">
          Pro isn&apos;t on sale yet. Everything else in tiebreak is free, so <Link href="/">post a poll</Link> in the
          meantime.
        </p>
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
