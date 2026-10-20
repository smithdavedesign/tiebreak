import { pageMetadata } from '@/lib/site'
import { ThumbnailTool } from '../thumbnail-tool'
import { OtherTools, StrangersPick } from '../tool-parts'

export const metadata = pageMetadata(
  '/tools/book-cover-thumbnail-test',
  'Book cover thumbnail test (free): compare covers small',
  'Test 2–4 book covers side by side at about 160 px and 80 px tall, to see whether the title still reads when small. Free, in your browser, no sign-up.',
)

export default function BookCoverThumbnailTestPage() {
  return (
    <article className="tool-page">
      <h1>Book cover thumbnail test</h1>
      <p className="lede">
        Add 2 to 4 covers and see them side by side at about 160 px and about 80 px tall, small, the way covers show up
        in store search results and recommendation rows. It all happens in your browser. Can&apos;t choose? Let
        strangers pick.
      </p>

      <ThumbnailTool kind="book-cover" />

      <h2>Why these sizes?</h2>
      <p>
        Author guides disagree on the exact pixels, but put covers in store search results at roughly 100 to 200 pixels
        tall, and some rows and panels smaller still. About 160 px is a typical search result; about 80 px is the hard
        test. Each cover keeps its own shape, so a wider or narrower one shows as it is.
      </p>

      <h2>What to check</h2>
      <ul className="features">
        <li>
          <b>Can you read the title at 160 px?</b> At 80 px, can you still tell the genre?
        </li>
        <li>
          <b>Squint at the row.</b> Which cover still stands out next to the others?
        </li>
        <li>
          <b>Does it look like its genre?</b> A reader should know at a glance whether it&apos;s for them.
        </li>
      </ul>

      <StrangersPick shareWith="your newsletter, readers in your genre or a writing group" />
      <OtherTools current="book-cover" />
    </article>
  )
}
