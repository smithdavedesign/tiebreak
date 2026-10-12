import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  // Index the public pages; the API and checkout have nothing for search.
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/polls', '/account', '/checkout', '/stripe'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
