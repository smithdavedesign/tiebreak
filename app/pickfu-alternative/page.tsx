import { TryTiebreak } from '@/app/guide-parts'
import { pageMetadata } from '@/lib/site'

export const metadata = pageMetadata(
  '/pickfu-alternative',
  'A PickFu alternative for a quick A/B pick',
  'Looking for a PickFu alternative? What PickFu is for, what a free swipe poll does instead, and how to tell which one your decision needs.',
)

export default function PickFuAlternativePage() {
  return (
    <article className="terms">
      <h1>A PickFu alternative for a quick A/B pick</h1>
      <p className="lede">
        PickFu is built for one job: show your options to a paid panel and get written reasons back. If you only need
        to know which of two or three options people prefer, there is a lighter way to get it.
      </p>

      <h2>What PickFu gives you</h2>
      <p>
        PickFu&apos;s help center lists $1 per response with a $15 minimum per poll, plus extra for targeting. What you pay
        for is a panel you can aim at an audience, and written explanations of each vote. Prices change, so check{' '}
        <a href="https://www.pickfu.com/help/how-does-pickfu-s-pricing-work">their pricing page</a> before you decide.
      </p>

      <h2>What tiebreak does instead</h2>
      <ul className="features">
        <li>You post 2–4 options (text, or an image link) and pick a vote target and a deadline.</li>
        <li>Anyone with your link swipes to pick one. There is no sign-up and votes are anonymous.</li>
        <li>The poll closes at the vote target or the deadline, whichever comes first, and shows the winner and the split.</li>
        <li>
          Posting a poll is free. Pro (private polls, CSV export) is a one-time payment, not a subscription. You can also
          vote on other people&apos;s polls in the public feed to earn credits for posting there.
        </li>
      </ul>

      <h2>What tiebreak does not do</h2>
      <ul className="features">
        <li>It has no paid panel. The voters are your own audience and people from the public feed.</li>
        <li>You cannot choose who votes by age, country or interest.</li>
        <li>Voters do not write reasons. You get a tally, not an explanation.</li>
      </ul>

      <h2>How to choose</h2>
      <p>
        Ask what the decision costs if you get it wrong. If you are choosing a main product photo, a thumbnail or a
        cover that a defined group of buyers will see, and you need to know <em>why</em> they pick one, a targeted
        panel such as PickFu is built for that. If the stakes are small, the options are close, or you already have an
        audience to ask (a mailing list, a Discord, a forum thread), a free tally with a deadline is often enough, and a
        panel is overkill.
      </p>
      <p>
        A middle path: run the quick poll first to drop the clear loser, then spend on a targeted panel only for the last
        two.
      </p>

      <h2>A worked example</h2>
      <p>
        An example, made up for illustration: you sell ceramic mugs and have three candidate main photos. Post them as
        options A, B and C with a target of 20 votes and a 24-hour deadline, and share the link where your customers
        already are. If A gets 11, B gets 6 and C gets 3, drop C and decide between A and B. If the votes split nearly
        evenly, the photos are probably equally good and you can pick the one that fits your shop. A paid panel would
        tell you more, at a higher price.
      </p>

      <TryTiebreak>Post your options, share the link, and see the tally when the poll closes.</TryTiebreak>
    </article>
  )
}
