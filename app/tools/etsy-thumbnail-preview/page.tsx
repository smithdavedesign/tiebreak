import { pageMetadata } from '@/lib/site'
import { ThumbnailTool } from '../thumbnail-tool'
import { OtherTools, StrangersPick } from '../tool-parts'

const ETSY_IMAGE_HELP =
  'https://help.etsy.com/hc/en-us/articles/115015663347-Requirements-and-Best-Practices-for-Images-in-Your-Etsy-Shop'

export const metadata = pageMetadata(
  '/tools/etsy-thumbnail-preview',
  'Etsy thumbnail preview (free): compare listing photos',
  'Preview 2–4 Etsy listing photos side by side in a search-grid mock, cropped square, 4:3 and 5:4. Free, in your browser, no sign-up. Then let strangers vote.',
)

export default function EtsyThumbnailPreviewPage() {
  return (
    <article className="tool-page">
      <h1>Etsy thumbnail preview</h1>
      <p className="lede">
        Add 2 to 4 listing photos and see them side by side in a mock search grid, cropped square (1:1), 4:3 and 5:4.
        It all happens in your browser. Can&apos;t choose? Let strangers pick.
      </p>

      <ThumbnailTool kind="etsy" />

      <h2>Why three crops?</h2>
      <p>
        Etsy doesn&apos;t publish one fixed thumbnail shape. <a href={ETSY_IMAGE_HELP}>Its image guidelines</a> ask for
        enough border around the item that the first photo can be cropped to square, portrait and landscape thumbnails,
        and seller guides disagree on whether search shows it at 4:3, 5:4 or square. So this shows all three: a photo that
        holds up in every crop is safe wherever it lands.
      </p>

      <h2>What to check</h2>
      <ul className="features">
        <li>
          <b>Nothing important is cut off in the square crop.</b> It trims the most from the sides of a landscape photo.
        </li>
        <li>
          <b>The item reads from the tile alone,</b> without its title.
        </li>
        <li>
          <b>It stands apart from the photos next to it.</b> In search, shoppers see it in a grid, not on its own.
        </li>
        <li>After you upload it, check the thumbnail in Etsy&apos;s listing editor too.</li>
      </ul>

      <StrangersPick shareWith="your customers or a seller forum thread" />
      <OtherTools current="etsy" />
    </article>
  )
}
