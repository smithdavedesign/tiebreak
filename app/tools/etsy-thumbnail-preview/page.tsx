import { ThumbnailTool } from '@/app/tools/thumbnail-tool'
import { pageMetadata } from '@/lib/site'

export const metadata = pageMetadata(
  '/tools/etsy-thumbnail-preview',
  'Etsy thumbnail preview: compare listing photos side by side',
  'Free Etsy thumbnail preview: add 2–4 listing photos and see each in a search-grid mock at 1:1, 4:3 and 5:4 crops, side by side. Then let strangers pick one.',
)

export default function EtsyThumbnailPreviewPage() {
  return (
    <article className="tool-page">
      <h1>Etsy thumbnail preview</h1>
      <p className="lede">
        Your first listing photo is the thumbnail shoppers see in search: small, and cropped. Add the photos you&apos;re
        choosing between and see them side by side as search-grid tiles at three crops: square (1:1), 4:3 and 5:4.
      </p>

      <ThumbnailTool kind="etsy" />

      <h2>What to look for</h2>
      <ul className="features">
        <li>
          <b>Does the item read at a glance?</b> In a small tile, can you tell what it is and what makes it yours?
        </li>
        <li>
          <b>Does a crop cut anything off?</b> Check that the item, and any detail you rely on, survives all three crops.
        </li>
        <li>
          <b>Which one do you look at first?</b> Side by side, the photo that catches your eye is the one to beat. Your own
          eye is biased, though: you know which one you worked hardest on.
        </li>
      </ul>

      <h2>When you can&apos;t decide</h2>
      <p>
        Press Let strangers pick. Your photos go into a new tiebreak poll as its options. Pick a vote target and a
        deadline, share the link with people who shop on Etsy, and the poll closes with a winner and the split. It&apos;s
        free, with no sign-up.
      </p>
    </article>
  )
}
