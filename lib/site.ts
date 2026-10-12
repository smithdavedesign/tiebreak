// Where the site lives, for canonical URLs, the sitemap and share cards. NEXT_PUBLIC_SITE_URL wins (set it
// when there's a custom domain); otherwise Vercel's production domain; otherwise the current one.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
  'https://tiebreak-phi.vercel.app'
).replace(/\/+$/, '')

export const SITE_NAME = 'tiebreak'
export const SITE_DESCRIPTION =
  "Can't choose? Post 2–4 options, share the link, and let people swipe to pick one. The poll closes at your vote target or deadline."

/** The public pages search engines should list (poll pages are people's own links, so they're left out). */
export const PUBLIC_PAGES = ['/', '/feed', '/pro', '/privacy', '/terms'] as const

/** RepoHQ's visit counter for idea products (anonymous: no cookies, an hourly-limited IP hash). */
export const SIGNAL_URL = 'https://repohq.vercel.app/api/ideas/signal'
