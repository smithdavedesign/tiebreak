import { cookies } from 'next/headers'
import Link from 'next/link'
import { getAccount } from '@/lib/credits'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { VOTES_PER_CREDIT } from '@/lib/limits'
import { getPlan } from '@/lib/plans'
import { ETSY_PHOTO_TEST_PATH, pageMetadata } from '@/lib/site'
import { PhotoTester } from './photo-tester'

// Etsy's own page on listing photos: thumbnails cropped square, portrait and landscape, and the
// thumbnail adjustment tool.
const ETSY_IMAGE_HELP = 'https://help.etsy.com/hc/en-us/articles/115015663347-Requirements-and-Best-Practices-for-Images-in-Your-Etsy-Shop'

export const metadata = pageMetadata(
  ETSY_PHOTO_TEST_PATH,
  'Free Etsy listing photo tester: compare main photos in a search grid',
  'See 2–4 candidate main photos side by side as square tiles in a mock Etsy search grid, then let strangers vote on which one to use. Free, no account.',
)

export default async function EtsyPhotoTestPage() {
  const voter = (await cookies()).get(VOTER_COOKIE)?.value
  const viewer = isVoterId(voter) ? voter : null
  const [account, plan] = await Promise.all([getAccount(viewer), getPlan(viewer)])

  return (
    <>
      <h1>Free Etsy listing photo tester</h1>
      <p className="lede">
        Can&apos;t decide which picture to use as your main photo? Add 2–4 candidates and see them small and side by
        side, the way a shopper scrolling search results meets them. Then let strangers pick.
      </p>

      <PhotoTester account={account} plan={plan} />

      <section className="terms">
        <h2>How it works</h2>
        <ol className="features">
          <li>Add 2–4 photos from your phone or computer. They stay on this device until you post a poll.</li>
          <li>
            Compare them in the mock search grid. Each one is cropped square from its centre, so check that nothing
            important sits at the edges.
          </li>
          <li>
            Press <b>Let strangers pick</b>. Your photos become the options of a new poll; set a vote target and a
            deadline, and post it.
          </li>
          <li>
            Share the poll&apos;s link where people will vote: shop followers, friends who shop on Etsy, or a community
            that allows it. Vote on {VOTES_PER_CREDIT} polls in the <Link href="/feed">public feed</Link> and you can
            post yours there too.
          </li>
          <li>When the poll closes you see the winner and the vote split.</li>
        </ol>

        <h2>What the grid can and can&apos;t show</h2>
        <p>
          Etsy crops your first photo into square, portrait and landscape thumbnails, depending on where it&apos;s
          shown, and has a thumbnail tool to adjust them (<a href={ETSY_IMAGE_HELP}>Etsy&apos;s guide to listing
          photos</a>). This grid shows the square crop only, so check the others with that tool when you list.
        </p>
        <p>
          A tally is a quick signal, not a sales result. Voters are anonymous and may not be your buyers, and the real
          test is how shoppers click once the listing is live. You can reorder your Etsy photos at any time, so try the
          winner and watch your listing stats.
        </p>
        <p>
          More on choosing: <Link href="/which-etsy-photo-is-best">Which Etsy listing photo is best?</Link>
        </p>
      </section>
    </>
  )
}
