import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'tiebreak — let strangers break the tie',
  description: 'Post 2–4 options, share the link, get a verdict at N votes or the deadline.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1d1d1f',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            tiebreak
          </Link>
          <nav>
            <Link href="/feed">Feed</Link>
            <Link href="/">New poll</Link>
            <Link href="/pro">Pro</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <Link href="/terms">Terms, refunds &amp; privacy</Link>
        </footer>
      </body>
    </html>
  )
}
