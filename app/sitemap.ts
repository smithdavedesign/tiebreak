import type { MetadataRoute } from 'next'
import { listPublishedResults, type PublishedResult } from '@/lib/polls'
import { resultPath } from '@/lib/results'
import { PUBLIC_PAGES, SITE_URL } from '@/lib/site'

// Built per request, not at build time: it lists the published poll results (lib/results.ts) from the database.
export const dynamic = 'force-dynamic'

/** The public pages, then every published result (opted in, closed with votes, not hidden by reports), newest first. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_PAGES.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency: path === '/feed' ? 'hourly' : 'monthly',
    priority: path === '/' ? 1 : 0.5,
  }))
  // If the database can't be read, the public pages are still listed; the results come back on the next fetch.
  const results = await listPublishedResults().catch((error: Error): PublishedResult[] => {
    console.error(`sitemap: published results unavailable: ${error.message}`)
    return []
  })
  return [
    ...pages,
    ...results.map((result) => ({
      url: `${SITE_URL}${resultPath(result)}`,
      lastModified: result.closedAt,
      changeFrequency: 'yearly' as const,
      priority: 0.5,
    })),
  ]
}
