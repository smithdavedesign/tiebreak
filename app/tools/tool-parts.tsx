import Link from 'next/link'
import { TOOLS, type ToolKind } from '@/lib/tools'

/** What "Let strangers pick" does, and what happens to the images, in the words of the privacy page. */
export function StrangersPick({ shareWith }: { shareWith: string }) {
  return (
    <>
      <h2>Still can&apos;t choose?</h2>
      <p>
        &ldquo;Let strangers pick&rdquo; uploads your images and opens a poll with them as the options. Share its link with{' '}
        {shareWith} and the poll closes at your vote target or deadline, with a winner and the vote split. Posting a poll
        is free, with no sign-up. Read each community&apos;s rules before you post a link.
      </p>
      <p className="hint">
        Your images don&apos;t leave this device until you click &ldquo;Let strangers pick&rdquo;. Then tiebreak stores
        them, without location or camera details, and anyone with the poll&apos;s link sees them. An image no poll uses is
        deleted after a day. See <Link href="/privacy">privacy</Link>.
      </p>
    </>
  )
}

/** Links to the other tools, so each page leads to its siblings. */
export function OtherTools({ current }: { current: ToolKind }) {
  return (
    <p className="hint">
      More free tools:{' '}
      {TOOLS.filter((t) => t.kind !== current).map((t, i) => (
        <span key={t.path}>
          {i > 0 && ' · '}
          <Link href={t.path}>{t.name}</Link>
        </span>
      ))}
    </p>
  )
}
