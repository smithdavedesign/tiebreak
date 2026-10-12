import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms and refunds',
  description: 'Plain-language terms for tiebreak: the service, Pro (a one-time payment), refunds within 14 days, and acceptable use.',
  alternates: { canonical: '/terms' },
}

/** The terms a buyer agrees to, the refund policy and what's stored. Plain language. */
export default function TermsPage() {
  const contact = process.env.CONTACT_EMAIL

  return (
    <article className="terms">
      <h1>Terms and refunds</h1>
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
        What&apos;s stored and who sees it is on the <Link href="/privacy">privacy page</Link>.
      </p>

      <h2>No warranty</h2>
      <p>
        tiebreak is provided as is, without warranty of any kind. A poll&apos;s result is a quick signal from whoever
        voted, not advice.
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
