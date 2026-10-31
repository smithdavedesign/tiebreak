// Launch readiness (idea-factory's go-live audit): robots.txt, the sitemap, privacy and terms pages,
// search and share metadata, and the visit beacon the privacy page discloses.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { metadata } from '@/app/layout'
import PrivacyPage from '@/app/privacy/page'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import TermsPage from '@/app/terms/page'
import { PUBLIC_PAGES, SIGNAL_URL, SITE_URL } from '@/lib/site'

describe('robots.txt and sitemap.xml', () => {
  it('robots allows indexing, keeps the API out and points at the sitemap', () => {
    const r = robots()
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`)
    expect(r.rules).toMatchObject({ userAgent: '*', allow: '/' })
    expect((r.rules as { disallow: string[] }).disallow).toContain('/polls')
  })
  it('the sitemap lists every public page, and no poll pages', () => {
    const urls = sitemap().map((e) => e.url)
    expect(urls).toEqual(PUBLIC_PAGES.map((p) => `${SITE_URL}${p === '/' ? '' : p}`))
    expect(urls.some((u) => u.includes('/p/'))).toBe(false)
  })
})

describe('privacy and terms', () => {
  it('the privacy page says what is stored, discloses the visit counter, and names no third-party analytics', () => {
    const html = renderToString(PrivacyPage())
    expect(html).toContain('random id')
    expect(html).toContain('Visit counting')
    expect(html).toMatch(/no third-party analytics/i)
  })
  it('the terms link to privacy and include the refund and no-warranty lines', () => {
    const html = renderToString(TermsPage())
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('14 days')
    expect(html).toContain('without warranty')
  })
})

describe('search and share metadata', () => {
  // Canonical URLs are per page (each sets its own; see tests/launch.test.ts), so the layout sets none.
  it('has a title, description, Open Graph and a large Twitter card, and no site-wide canonical', () => {
    expect(metadata.metadataBase?.toString()).toBe(`${SITE_URL}/`)
    expect(metadata.description).toBeTruthy()
    expect(metadata.alternates).toBeUndefined()
    expect(metadata.openGraph).toMatchObject({ siteName: 'tiebreak' })
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' })
  })
  it('the beacon goes to RepoHQ over https', () => {
    expect(SIGNAL_URL).toBe('https://idea-factory.1426davejobs.workers.dev/api/ideas/signal')
  })
})
