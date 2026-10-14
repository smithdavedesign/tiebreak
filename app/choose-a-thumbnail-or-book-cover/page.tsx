import { TryTiebreak } from '@/app/guide-parts'
import { pageMetadata } from '@/lib/site'

export const metadata = pageMetadata(
  '/choose-a-thumbnail-or-book-cover',
  'How to choose between two thumbnails or book covers',
  'Stuck between two YouTube thumbnails or book covers? What to check first, who to ask, and how to run a quick poll with a vote target and a deadline.',
)

export default function ThumbnailCoverPage() {
  return (
    <article className="terms">
      <h1>How to choose between two thumbnails or book covers</h1>
      <p className="lede">
        Thumbnails and covers are judged at a glance, by strangers, at a small size. Your own opinion is the least
        reliable one in the room. Here is a way to decide.
      </p>

      <h2>Check these first</h2>
      <ul className="features">
        <li>
          <b>Shrink it.</b> View each candidate at the size it will appear in search results or a store listing. If you
          can&apos;t read the title or see the focal point, it loses.
        </li>
        <li>
          <b>Signal the genre or topic.</b> A stranger should know what kind of book or video it is within a second.
        </li>
        <li>
          <b>Put them side by side.</b> Compare them next to similar covers or videos in your niche, not alone on a
          white page.
        </li>
      </ul>

      <h2>Who to ask</h2>
      <p>
        Friends and family are kind, and they are not your viewers or readers. Better: your own audience (a newsletter, a
        Discord, a subreddit that allows feedback requests), or people who read or watch in your genre. Read each
        community&apos;s rules before you post a link.
      </p>

      <h2>Running the poll</h2>
      <ol className="features">
        <li>Post the two or three finalists as options, as images or with a short description.</li>
        <li>Ask one question: &ldquo;Which would you click?&rdquo; or &ldquo;Which cover looks like a thriller?&rdquo;.</li>
        <li>Set a vote target and a deadline. The poll closes at whichever comes first.</li>
        <li>Share the link. Votes are anonymous and need no account.</li>
      </ol>

      <h2>What a poll can and can&apos;t tell you</h2>
      <p>
        A poll measures what people say they prefer, not what they click. Use it to drop the weakest option and to catch
        a cover that confuses people. If the result is close, the options are probably close, so choose on your own
        criteria. A tally gives no reasons; if you need to know why, ask a few people in a thread alongside it. Once
        you&apos;ve published, a platform&apos;s own click data beats any poll where you can see it.
      </p>

      <h2>A worked example</h2>
      <p>
        An example, made up for illustration: you have two thumbnail versions of one video, one with a close-up face and one
        with the product on a plain background. Post both with the question &ldquo;Which would you click?&rdquo;, a target of
        20 votes and a 24-hour deadline, and share it with your community. If the face wins 14 to 6, use it. If it&apos;s 11
        to 9, either will do, and the thumbnail that is easier to read at small size is the safer choice.
      </p>

      <TryTiebreak>Post your finalists and get a tally by your deadline. It&apos;s free, with no sign-up.</TryTiebreak>
    </article>
  )
}
