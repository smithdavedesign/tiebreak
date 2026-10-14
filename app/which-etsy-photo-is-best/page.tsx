import { TryTiebreak } from '@/app/guide-parts'
import { pageMetadata } from '@/lib/site'

export const metadata = pageMetadata(
  '/which-etsy-photo-is-best',
  'Which Etsy listing photo is best? How to pick one',
  "Can't decide which picture to use as your Etsy main photo? A short checklist, why forum threads leave you stuck, and a way to get a tally.",
)

export default function EtsyPhotoPage() {
  return (
    <article className="terms">
      <h1>Which Etsy listing photo is best?</h1>
      <p className="lede">
        You have two to four candidates for the main photo and can&apos;t decide. Here is how to narrow them down, and
        how to get a clear answer instead of a few replies that disagree.
      </p>

      <h2>Why the main photo matters</h2>
      <p>
        The first photo is the thumbnail shoppers see in search results, so it has to make them click. It is also
        small, often on a phone, so judge your candidates at thumbnail size, not full screen.
      </p>

      <h2>Before you ask anyone: a checklist</h2>
      <ul className="features">
        <li>Is the item clear and large in the frame, on a simple background?</li>
        <li>Does it still read when shrunk to the size of a search result?</li>
        <li>Is there room around the edges, so a crop doesn&apos;t cut it off?</li>
        <li>Does it match the look of the rest of your shop?</li>
        <li>Is there text on it? Small text is unreadable in a thumbnail.</li>
      </ul>
      <p>Cut anything that fails two or more of these. What is left is worth putting in front of other people.</p>

      <h2>Why the forum thread doesn&apos;t settle it</h2>
      <p>
        Posting your photos in the Etsy forum or a subreddit is free, and it helps. But replies trickle in over days,
        nobody counts them, and people disagree. You end up with three opinions and no winner.
      </p>

      <h2>Get a tally instead</h2>
      <ol className="features">
        <li>Post 2–4 photos as options (paste an image link for each).</li>
        <li>Set a vote target (say 15 or 20) and a deadline (say 24 hours).</li>
        <li>Share the link with shop followers, friends who shop on Etsy, or a community that allows it.</li>
        <li>When the poll closes you see the winner and the vote split.</li>
      </ol>
      <p>
        Treat a tally as a quick signal. Voters are anonymous and may not be your buyers, and the real test is how
        shoppers click once the listing is live. You can reorder your Etsy photos at any time, so try the winner and watch
        your listing stats.
      </p>

      <h2>A worked example</h2>
      <p>
        An example, made up for illustration: a mug listing with the question &ldquo;Which photo for my ceramic mug
        listing?&rdquo; and two options, &ldquo;Speckled blue glaze, morning light&rdquo; and &ldquo;Matte white on a walnut
        shelf&rdquo;, with a target of 3 votes. Two people vote on the shared link and you swipe the third. The poll closes
        with the winner and the split, 2 to 1. With a bigger target the split means more; with a close split, go with the
        photo that matches the rest of your shop.
      </p>

      <TryTiebreak>Put your photo candidates in a poll. It&apos;s free and needs no account.</TryTiebreak>
    </article>
  )
}
