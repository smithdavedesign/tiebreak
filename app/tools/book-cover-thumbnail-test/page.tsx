import { ThumbnailTool } from '@/app/tools/thumbnail-tool'
import { pageMetadata } from '@/lib/site'

export const metadata = pageMetadata(
  '/tools/book-cover-thumbnail-test',
  'Book cover thumbnail test: see your covers small, side by side',
  'Free book cover thumbnail test: add 2–4 covers and see them side by side at 160 and 80 pixels tall. Nothing uploads until you ask strangers to pick one.',
)

export default function BookCoverThumbnailTestPage() {
  return (
    <article className="tool-page">
      <h1>Book cover thumbnail test</h1>
      <p className="lede">
        Covers are judged at a glance, by strangers, at a small size, next to other books. Add the covers you&apos;re
        choosing between and see them side by side at about 160 and 80 pixels tall.
      </p>

      <ThumbnailTool kind="book-cover" />

      <h2>What to look for</h2>
      <ul className="features">
        <li>
          <b>Can you still read the title?</b> At 80 pixels tall, if the title or your name turns to noise, the image has
          to carry the cover on its own.
        </li>
        <li>
          <b>Does it signal the genre?</b> A stranger should know what kind of book it is within a second.
        </li>
        <li>
          <b>What&apos;s left when it&apos;s small?</b> Squint at the smaller row: the cover that is still one clear shape
          and a few colours holds up best in a list.
        </li>
      </ul>

      <h2>When you can&apos;t decide</h2>
      <p>
        Press Let strangers pick. Your covers go into a new tiebreak poll as its options. Pick a vote target and a
        deadline, share the link with readers of your genre, and the poll closes with a winner and the split. It&apos;s
        free, with no sign-up.
      </p>
    </article>
  )
}
