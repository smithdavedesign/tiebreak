import { VOTES_PER_CREDIT } from '@/lib/limits'
import { ETSY_PHOTO_TEST_PATH, pageMetadata } from '@/lib/site'
import { PhotoTest } from './photo-test'

export const metadata = pageMetadata(
  ETSY_PHOTO_TEST_PATH,
  'Free Etsy listing photo test: compare main photos',
  'Compare 2–4 Etsy listing photos side by side in a mock Etsy search grid, small and cropped square, then let strangers vote on your main photo. Free, no account.',
)

/** The free Etsy listing photo test (GROWTH.md, 2026-10-30): one page for a seller choosing a main photo. */
export default function EtsyPhotoTestPage() {
  return (
    <article className="terms photo-test-page">
      <h1>Free Etsy listing photo test</h1>
      <p className="lede">
        Can&apos;t decide which picture to use as your main photo? Add 2–4 candidates and see them small and side by
        side in a mock Etsy search grid, each cropped to a square from the centre. Then let strangers pick.
      </p>
      <p className="hint">
        Your photos stay on this device while you compare them: nothing is uploaded until you create the poll.
      </p>

      <PhotoTest />

      <h2>What to look for</h2>
      <ul className="features">
        <li>Can you tell what the item is at this size, at a glance?</li>
        <li>Does the crop cut anything off? If it does, leave more room around the item.</li>
        <li>Which one would you click if it came up next to other shops&apos; listings?</li>
      </ul>

      <h2>About the grid</h2>
      <p>
        It&apos;s a mock, not Etsy: grey bars stand in for the title, shop and price, and it says nothing about how Etsy
        ranks listings. Etsy crops your first photo into a thumbnail whose shape can differ by page and device, so keep
        the item in the middle and check the crop in Etsy&apos;s listing editor before you publish.
      </p>

      <h2>How &ldquo;Let strangers pick&rdquo; works</h2>
      <ol className="features">
        <li>
          It opens a new poll with your photos as options A, B and so on, and the question &ldquo;Which photo would you
          click in Etsy search?&rdquo;. Change anything you like.
        </li>
        <li>
          Pick a vote target and a deadline, then create the poll. Only then do your photos upload, with location and
          camera details removed.
        </li>
        <li>
          Share the link with shop followers, friends who shop on Etsy, or a seller community that allows it. Vote on{' '}
          {VOTES_PER_CREDIT} polls in the public feed and you can post yours there too.
        </li>
        <li>When the poll closes you see the winner and the vote split.</li>
      </ol>
      <p className="hint">
        Treat the tally as a quick signal: voters are anonymous and may not be your buyers. Link-only polls are free and
        need no account.
      </p>
    </article>
  )
}
