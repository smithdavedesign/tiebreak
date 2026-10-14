// The search pages (GROWTH.md, 2026-10-14): each is listed in the sitemap, linked from the home page and
// the footer, ends in a link to post a poll, and makes no claim the product can't back.
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import { GUIDES } from '@/lib/guides'
import { PUBLIC_PAGES, SITE_URL } from '@/lib/site'
import { useTestDb } from './helpers'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: RootLayout } = await import('@/app/layout')
const home = await import('@/app/page')
const pages = {
  '/pickfu-alternative': await import('@/app/pickfu-alternative/page'),
  '/which-etsy-photo-is-best': await import('@/app/which-etsy-photo-is-best/page'),
  '/choose-a-thumbnail-or-book-cover': await import('@/app/choose-a-thumbnail-or-book-cover/page'),
}
const paths = Object.keys(pages) as (keyof typeof pages)[]

useTestDb()

describe('the search pages', () => {
  it('are the GUIDES list, and all in PUBLIC_PAGES and the sitemap', () => {
    expect(GUIDES.map((g) => g.path).sort()).toEqual([...paths].sort())
    const urls = sitemap().map((e) => e.url)
    for (const path of paths) {
      expect(PUBLIC_PAGES).toContain(path)
      expect(urls).toContain(`${SITE_URL}${path}`)
    }
  })

  it.each(paths)('%s has its own canonical URL and a descriptive title and description', (path) => {
    const { metadata } = pages[path]
    expect(metadata.alternates?.canonical).toBe(path)
    expect(String(metadata.title).length).toBeGreaterThan(20)
    expect(metadata.description?.length).toBeGreaterThan(80)
    expect(metadata.description?.length).toBeLessThan(200)
  })

  it.each(paths)('%s has one h1 and a link to post a poll', (path) => {
    const html = renderToString(pages[path].default())
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    expect(html).toMatch(/<a class="button" href="\/">Post your poll<\/a>/)
  })

  it.each(paths)('%s labels its worked example as made up', (path) => {
    expect(renderToString(pages[path].default())).toContain('made up for illustration')
  })

  it('the home page and the footer link to every one of them', async () => {
    const homeHtml = renderToString(await home.default())
    const footer = renderToString(RootLayout({ children: null })).match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    for (const path of paths) {
      expect(homeHtml).toContain(`href="${path}"`)
      expect(footer).toContain(`href="${path}"`)
    }
    expect(footer).toContain('href="/privacy"')
  })

  it('make no promise of testimonials, user counts or demographic targeting', () => {
    for (const path of paths) {
      const text = renderToString(pages[path].default()).replace(/<[^>]+>/g, ' ')
      expect(text).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|creators|customers)\b/i)
      expect(text).not.toMatch(/testimonial|trusted by|\d+% (more|of)/i)
    }
  })
})
