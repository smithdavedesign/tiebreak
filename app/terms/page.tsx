import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Terms, refunds and privacy · tiebreak' }

/** The terms a buyer agrees to, the refund policy and what's stored. Plain language. */
export default function TermsPage() {
  const contact = process.env.CONTACT_EMAIL

  return (
    <article className="terms">
      <h1>Terms, refunds and privacy</h1>
      <p className="hint">Plain-language terms for tiebreak while it is in beta.</p>

      <h2>The service</h2>
      <p>
        tiebreak lets you post 2–4 options, collect votes from anyone with the link (and from strangers in the public
        feed, if you post there), and see which option wins. A poll closes at its vote target or its deadline. Votes
        are anonymous, so treat a result as a quick signal, not a survey.
      </p>

      <h2>Pro</h2>
      <p>
        Pro is a one-time payment through Stripe, with no subscription. It adds private polls, where only you see the
        result, and CSV export of the votes on your polls. There are no logins: Pro belongs to the browser you paid in,
        like your polls and credits, so clearing cookies or switching devices loses it. The price is shown on the{' '}
        <Link href="/pro">Pro page</Link> and at checkout.
      </p>

      <h2>Refunds</h2>
      <p>
        Ask within 14 days of paying and you get a full refund, no questions asked. If you lose Pro with your cookies,
        you can ask for a refund at any time.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t post anything illegal, hateful, sexual or violent, or anything you don&apos;t have the right to
        share. A public poll that three people report leaves the feed, and any poll can be deleted.
      </p>

      <h2>Privacy</h2>
      <p>
        Your browser gets a random id in a cookie, and that id is your account. We store the polls you create and your
        votes and reports, tied to that id and never to your name. Creators can download the votes on their own polls
        (time and option, never who voted). If you buy Pro, Stripe handles your card and we never see it. Stripe tells
        us your email, the amount and the currency, which we keep to answer refund requests. There are no ads,
        analytics or trackers. Option images load straight from the links poll creators give.
      </p>

      <h2>Contact</h2>
      <p>
        {contact ? (
          <>
            Email <a href={`mailto:${contact}`}>{contact}</a>.
          </>
        ) : (
          <>If you bought Pro, reply to your Stripe receipt.</>
        )}{' '}
        To flag a poll, use its Report button.
      </p>
    </article>
  )
}
