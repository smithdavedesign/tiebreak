import type { MetadataRoute } from 'next'
import { listPublishedResults } from '@/lib/polls'
import { resultPath } from '@/lib/results'
import { PUBLIC_PAGES, SITE_URL } from '@/lib/site'

// Read per request: published results come and go with the database (and nothing is queried at build time).
export const dynamic = 'force-dynamic'

/** The public pages, then every published poll result (/results/<slug>, newest first). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_PAGES.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency: path === '/feed' ? 'hourly' : 'monthly',
    priority: path === '/' ? 1 : 0.5,
  }))
  try {
    const results = await listPublishedResults()
    return [
      ...pages,
      ...results.map((poll) => ({
        url: `${SITE_URL}${resultPath(poll)}`,
        lastModified: poll.closedAt,
        changeFrequency: 'yearly' as const, // a closed poll's result never changes
        priority: 0.4,
      })),
    ]
  } catch (error) {
    // The site's own pages stay listed while the database is unreachable.
    console.error(`sitemap: published results left out: ${error instanceof Error ? error.message : String(error)}`)
    return pages
  }
}
