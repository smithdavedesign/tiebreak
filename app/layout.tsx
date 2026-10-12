import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'tiebreak — let strangers break the tie', template: '%s · tiebreak' },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: SITE_NAME, title: 'tiebreak — let strangers break the tie', description: SITE_DESCRIPTION, url: '/' },
  twitter: { card: 'summary_large_image', title: 'tiebreak — let strangers break the tie', description: SITE_DESCRIPTION },
}

// Structured data for search: what the product is (no price listed until there's a public one).
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: 'LifestyleApplication',
  operatingSystem: 'Web, iOS, Android',
  description: SITE_DESCRIPTION,
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
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
          <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms &amp; refunds</Link>
        </footer>
      </body>
    </html>
  )
}
