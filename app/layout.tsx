import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { GUIDES } from '@/lib/guides'
import { ETSY_PHOTO_TEST_PATH, HOME_TITLE, JSON_LD, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site'
import { VisitBeacon } from './visit-beacon'
import './globals.css'

// The title template, plus defaults for pages that set nothing (404s). Public pages set their own canonical
// URL and share tags with pageMetadata(), and poll pages in generateMetadata, so none inherits the home page's.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: 'website', siteName: SITE_NAME, title: HOME_TITLE, description: SITE_DESCRIPTION },
  twitter: { card: 'summary_large_image', title: HOME_TITLE, description: SITE_DESCRIPTION },
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }} />
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
        <VisitBeacon />
        <footer className="site-footer">
          <p className="guide-links">
            {GUIDES.map((g, i) => (
              <span key={g.path}>
                {i > 0 && ' · '}
                <Link href={g.path}>{g.label}</Link>
              </span>
            ))}
            {' · '}
            <Link href={ETSY_PHOTO_TEST_PATH}>Etsy listing photo tester</Link>
          </p>
          <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms &amp; refunds</Link>
        </footer>
      </body>
    </html>
  )
}
