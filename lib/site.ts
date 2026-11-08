import type { Metadata } from 'next'

/** The live site: the Workers deploy of main (GROWTH.md 2026-11-08; the old Vercel address only redirects here). */
export const WORKERS_URL = 'https://tiebreak.1426davejobs.workers.dev'

// Where the site lives, for canonical URLs, the sitemap and share cards: the Workers site, which is what a plain
// `npm run cf:build` bakes in. NEXT_PUBLIC_SITE_URL wins (set it when there's a custom domain). Vercel's production
// domain is no longer a fallback: it answers every request with a redirect to Workers.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || WORKERS_URL).replace(/\/+$/, '')

export const SITE_NAME = 'tiebreak'
export const HOME_TITLE = 'tiebreak — let strangers break the tie'
export const SITE_DESCRIPTION =
  "Can't choose? Post 2–4 options, share the link, and let people swipe to pick one. The poll closes at your vote target or deadline."

/**
 * The public pages search engines should list (poll pages are people's own links, so they're left out: noindex,
 * though each still names its own address as canonical, and every 404 names the home page; app/not-found.tsx).
 */
export const PUBLIC_PAGES = [
  '/',
  '/feed',
  '/pro',
  '/privacy',
  '/terms',
  '/pickfu-alternative',
  '/which-etsy-photo-is-best',
  '/choose-a-thumbnail-or-book-cover',
  '/tools/etsy-thumbnail-preview',
  '/tools/book-cover-thumbnail-test',
  '/tools/youtube-thumbnail-preview',
] as const

/**
 * The idea pipeline's visit counter (anonymous: no cookies, an hourly-limited IP hash): the idea-factory
 * Worker on Cloudflare since 2026-10-31, writing to RepoHQ's idea_signals (RepoHQ's own endpoint moved
 * behind Tailscale). idea-factory policy.json signalUrl.
 */
export const SIGNAL_URL = 'https://idea-factory.1426davejobs.workers.dev/api/ideas/signal'

/** Where people reach us (privacy and terms pages): the repo's public issue tracker. */
export const ISSUES_URL = 'https://github.com/smithdavedesign/tiebreak/issues'

/**
 * Pro's price, decided in REVENUE.md: $5, paid once (a Stripe payment link, no subscription). The terms
 * and the structured data state it; change them together with the payment link.
 */
export const PRICE = { amount: '5.00', currency: 'USD', label: '$5' } as const

/**
 * The share card, drawn by app/opengraph-image.tsx. Next adds that file's tags only where no page replaces
 * the layout's openGraph, so every page that sets openGraph lists the image itself (Twitter copies it).
 */
export const SHARE_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'tiebreak: post two options, let people swipe to pick one',
}

/**
 * One public page's title, description, canonical URL and share-card tags. Pages set all of them: a page
 * without its own openGraph would inherit the layout's, home page URL and title included. `title` null is
 * the home page.
 */
export function pageMetadata(path: string, title: string | null, description: string): Metadata {
  const fullTitle = title === null ? HOME_TITLE : `${title} · ${SITE_NAME}`
  return {
    title: title === null ? { absolute: HOME_TITLE } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE_NAME, url: path, title: fullTitle, description, images: [SHARE_IMAGE] },
    twitter: { card: 'summary_large_image', title: fullTitle, description },
  }
}

/** Structured data for search: what tiebreak is, and Pro as an Offer at the REVENUE.md price. */
export const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: 'LifestyleApplication',
  operatingSystem: 'Web, iOS, Android',
  description: SITE_DESCRIPTION,
  offers: {
    '@type': 'Offer',
    name: 'tiebreak Pro',
    description: 'Private polls and CSV export of your votes. Paid once, no subscription.',
    price: PRICE.amount,
    priceCurrency: PRICE.currency,
    url: `${SITE_URL}/pro`,
  },
}
