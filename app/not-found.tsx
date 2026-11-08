import type { Metadata } from 'next'
import Link from 'next/link'

// Every 404: a missing poll (/p/:id calls notFound()) and any address the app doesn't have. Next renders one
// 404 page ahead of time for every unknown address, so the page can't name the address that was asked for. Its
// canonical URL is the home page on the site's host instead (GROWTH.md 2026-11-08). Next adds noindex to every 404.
export const metadata: Metadata = {
  title: 'Not found',
  alternates: { canonical: '/' },
}

export default function NotFound() {
  return (
    <>
      <h1>Nothing here</h1>
      <p className="lede">There&apos;s no poll or page at this link. It may be mistyped, or the poll was deleted.</p>
      <p>
        <Link className="button" href="/">
          Post your poll
        </Link>{' '}
        or <Link href="/feed">vote on others</Link>
      </p>
    </>
  )
}
