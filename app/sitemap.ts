import type { MetadataRoute } from 'next'
import { listPublishedResults } from '@/lib/polls'
import { resultPath } from '@/lib/results'
import { PUBLIC_PAGES, SITE_URL } from '@/lib/site'

// Read on each request, never at build time: the result pages come from the database (and `next build` has none).
export const dynamic = 'force-dynamic'

/** The public pages, then every published poll result (lib/results.ts), newest first. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_PAGES.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency: path === '/feed' ? 'hourly' : 'monthly',
    priority: path === '/' ? 1 : 0.5,
  }))
  // If the database is down, the public pages are still worth listing; the results come back next time.
  const results = await listPublishedResults().catch((error: unknown) => {
    console.error('Sitemap: the published results could not be read.', error)
    return []
  })
  return [
    ...pages,
    ...results.map((result) => ({
      url: `${SITE_URL}${resultPath(result)}`,
      lastModified: result.publishedAt,
      changeFrequency: 'yearly' as const, // a closed poll's result never changes
      priority: 0.5,
    })),
  ]
}
