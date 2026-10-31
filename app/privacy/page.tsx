import Link from 'next/link'
import { ISSUES_URL, pageMetadata } from '@/lib/site'

export const metadata = pageMetadata(
  '/privacy',
  'Privacy',
  'What tiebreak stores (an anonymous id, your polls and votes), its one cookie, what it never collects, and who else sees anything.',
)

/** What's stored and why, in plain language. Keep it true when the product changes. */
export default function PrivacyPage() {
  const contact = process.env.CONTACT_EMAIL
  return (
    <article className="terms">
      <h1>Privacy</h1>
      <p className="hint">Short version: no sign-up, no ads, no tracking cookies. We store polls and votes against a random id.</p>

      <h2>Your account is a random id</h2>
      <p>
        There are no logins. The website gives your browser one cookie holding a random id. The iPhone and Android app keeps
        the same kind of id in the phone&apos;s secure storage. That id is your account. It owns your polls, votes, reports,
        posting credits and Pro, and it&apos;s never tied to your name. Clearing cookies or deleting the app starts a new one.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Polls you create: the question, the options (text, image links and photos) and when they close.</li>
        <li>
          Photos you upload for an option, kept in our database. We remove location, camera and other hidden details from
          the file first. Anyone with the poll&apos;s link sees them (and the public feed, if you post it there). A photo
          no poll uses is deleted after a day, and deleting a poll deletes its photos.
        </li>
        <li>
          Nothing from the thumbnail tools until you ask for a poll: their previews are drawn in your browser. Pressing
          &ldquo;Let strangers pick&rdquo; uploads the images as photos for a new poll, as above.
        </li>
        <li>Your votes and reports, with the time. Creators can download the votes on their own polls (time and option, never who voted).</li>
        <li>
          If you buy Pro: Stripe handles your card and we never see it. Stripe tells us your email, the amount and the
          currency, which we keep to answer refund requests.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        One, because the site needs it: <code>tb_voter</code> holds the random id above, so your polls, votes and credits
        stay yours. It lasts a year, only this site can read it, and it isn&apos;t used for ads or tracking. We set no
        other cookies, and nobody else sets any on this site. Stripe&apos;s checkout page, on Stripe&apos;s own site, has
        its own.
      </p>

      <h2>Visit counting</h2>
      <p>
        Our own counter (RepoHQ) gets three anonymous events: a &ldquo;visit&rdquo; (the first page you open in a browser
        session), an &ldquo;activate&rdquo; (the first time you create a poll in this browser) and a &ldquo;checkout&rdquo;
        (when you click the button to buy Pro). Each carries only the page that linked you here, if it was another site and
        your browser shares it. A visit to one of the free thumbnail tools also says which tool page it was, and is counted
        once per session for each. A link of ours can carry a short tag, like <code>ref=poll</code> on &ldquo;Make your own
        tiebreak&rdquo; under a poll you voted on; following one sends one more visit with that tag, so we can tell which
        links bring people. No cookie is set and no id is sent. The counter stores a one-way hash of your IP address
        with the event, never the address itself, so it can limit spam to a few counts an hour. Nothing is sent from
        automated browsers, or if you set <code>repohq:notrack</code> in this site&apos;s local storage. To avoid counting
        you twice, your browser keeps a few small flags in its own storage; they never leave your device. There are no
        third-party analytics, ad trackers or pixels.
      </p>

      <h2>Who else sees anything</h2>
      <p>
        Stripe, if you pay. Our hosts, Vercel (the website) and Neon (the database), run the service. Uploaded photos load
        from tiebreak itself. Option images given as links load straight from those links, so those sites see the
        request; tiebreak&apos;s server also fetches them to draw the poll&apos;s share card (the preview picture chat apps
        and social sites show for its link). The share card shows a poll&apos;s question and options to anyone the link is
        sent to, and once it closes, its result, unless the poll is private. Nothing is sold or shared for ads.
      </p>

      <h2>Contact</h2>
      <p>
        {contact ? (
          <>
            Email <a href={`mailto:${contact}`}>{contact}</a>
          </>
        ) : (
          <>
            Open an issue on <a href={ISSUES_URL}>GitHub</a> (issues are public, so leave out anything private)
          </>
        )}{' '}
        to ask what&apos;s stored for your id or to have it deleted. See also the <Link href="/terms">terms and refunds</Link>.
      </p>
    </article>
  )
}
