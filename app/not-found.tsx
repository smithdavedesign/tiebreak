import type { Metadata } from 'next'
import Link from 'next/link'

// The 404 page: any address the app doesn't have, and a poll that doesn't exist. Next marks it noindex itself.
// It has no address of its own to name, so its canonical URL is the home page on the site's host, as on every
// other page (GROWTH.md 2026-11-07); the layout sets none, so it can't leak into pages that need their own.
export const metadata: Metadata = {
  title: 'Page not found',
  alternates: { canonical: '/' },
}

export default function NotFound() {
  return (
    <div className="center">
      <h1>Page not found</h1>
      <p className="lede">Nothing lives at this address. The poll may have been deleted, or the link cut short.</p>
      <p>
        <Link href="/">Post a poll</Link> · <Link href="/feed">Vote on the feed</Link>
      </p>
    </div>
  )
}
