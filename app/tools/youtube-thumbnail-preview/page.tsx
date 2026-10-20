import { pageMetadata } from '@/lib/site'
import { ThumbnailTool } from '../thumbnail-tool'
import { OtherTools, StrangersPick } from '../tool-parts'

const YOUTUBE_THUMBNAIL_HELP = 'https://support.google.com/youtube/answer/72431'

export const metadata = pageMetadata(
  '/tools/youtube-thumbnail-preview',
  'YouTube thumbnail preview (free): compare thumbnails',
  'Preview 2–4 YouTube thumbnails side by side at 16:9, as tiles in a desktop grid and a phone feed. Free, in your browser, no sign-up. Then let strangers vote.',
)

export default function YouTubeThumbnailPreviewPage() {
  return (
    <article className="tool-page">
      <h1>YouTube thumbnail preview</h1>
      <p className="lede">
        Add 2 to 4 thumbnails and see them side by side at 16:9, as tiles in a desktop grid and in a phone feed. It all
        happens in your browser. Can&apos;t choose? Let strangers pick.
      </p>

      <ThumbnailTool kind="youtube" />

      <h2>Why 16:9?</h2>
      <p>
        <a href={YOUTUBE_THUMBNAIL_HELP}>YouTube&apos;s help</a> recommends custom thumbnails at 1280 × 720 pixels, a 16:9
        ratio, the one most used in its players and previews. This preview fills each tile at 16:9, so an image of
        another shape is cropped here: make yours 16:9 before you upload it.
      </p>

      <h2>What to check</h2>
      <ul className="features">
        <li>
          <b>Read it on the phone tile.</b> If the text needs the desktop size, it&apos;s too small.
        </li>
        <li>
          <b>The face or the focal point still reads</b> when the tile is small.
        </li>
        <li>
          <b>Next to the others, which would you click first?</b> In a feed, yours sits between other videos.
        </li>
      </ul>

      <StrangersPick shareWith="your community, a Discord or a creator forum" />
      <OtherTools current="youtube" />
    </article>
  )
}
