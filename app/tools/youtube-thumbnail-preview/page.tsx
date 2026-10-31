import { ThumbnailTool } from '@/app/tools/thumbnail-tool'
import { pageMetadata } from '@/lib/site'

export const metadata = pageMetadata(
  '/tools/youtube-thumbnail-preview',
  'YouTube thumbnail preview: desktop grid and phone feed',
  'Free YouTube thumbnail preview: add 2–4 thumbnails and see each at 16:9 in a desktop-grid tile and a phone-feed tile, side by side. Then let strangers pick one.',
)

export default function YouTubeThumbnailPreviewPage() {
  return (
    <article className="tool-page">
      <h1>YouTube thumbnail preview</h1>
      <p className="lede">
        Viewers see your thumbnail at 16:9: in a grid of videos on a computer, and across the screen in the feed on a
        phone. Add the thumbnails you&apos;re choosing between and see each one in both, side by side.
      </p>

      <ThumbnailTool kind="youtube" />

      <h2>What to look for</h2>
      <ul className="features">
        <li>
          <b>The corner under the length.</b> The video&apos;s length sits over the bottom-right corner, so keep text and
          faces clear of it.
        </li>
        <li>
          <b>Text at grid size.</b> If the words don&apos;t read in the desktop tile, use fewer and bigger ones.
        </li>
        <li>
          <b>One focal point.</b> Which one tells a stranger what the video is about before they read the title?
        </li>
      </ul>

      <h2>When you can&apos;t decide</h2>
      <p>
        Press Let strangers pick. Your thumbnails go into a new tiebreak poll as its options. Pick a vote target and a
        deadline, share the link with your viewers or a community that allows feedback requests, and the poll closes
        with a winner and the split. It&apos;s free, with no sign-up.
      </p>
    </article>
  )
}
