// The thumbnail preview tools (GROWTH.md, 2026-10-22): three search-landing pages, each with its own title,
// description and h1 and listed in the sitemap; their preview mocks (tile counts, crops and sizes); and the visit
// beacon carrying each tool page's own path. Pixel sizes, the upload and the hand-off to the new-poll form run in
// Chromium: tests/thumbnail-tools-browser.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import { sendSignal } from '@/lib/beacon'
import { GUIDES } from '@/lib/guides'
import { PUBLIC_PAGES, SIGNAL_URL, SITE_URL } from '@/lib/site'
import { COVER_HEIGHTS, ETSY_CROPS, TOOLS, isToolPath } from '@/lib/tools'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: RootLayout } = await import('@/app/layout')
const { Previews } = await import('@/app/tools/thumbnail-tool')
const { countVisit } = await import('@/app/visit-beacon')
const pages = {
  '/tools/etsy-thumbnail-preview': await import('@/app/tools/etsy-thumbnail-preview/page'),
  '/tools/book-cover-thumbnail-test': await import('@/app/tools/book-cover-thumbnail-test/page'),
  '/tools/youtube-thumbnail-preview': await import('@/app/tools/youtube-thumbnail-preview/page'),
}
const paths = Object.keys(pages) as (keyof typeof pages)[]
const toolOf = (path: string) => TOOLS.find((t) => t.path === path)!

/** The <title> a page ends up with, through the layout's "%s · tiebreak" template. */
const titleOf = (path: keyof typeof pages) => `${String(pages[path].metadata.title)} · tiebreak`
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0

/** Three candidates as the tool hands them to the mocks: a letter, the image's local (blob:) URL and its name. */
const three = ['A', 'B', 'C'].map((letter, i) => ({ letter, src: `blob:http://localhost/${i}`, name: `mug-${i}.jpg` }))

describe('the tool pages', () => {
  it('are the TOOLS list, and all in PUBLIC_PAGES and the sitemap', () => {
    expect(TOOLS.map((t) => t.path).sort()).toEqual([...paths].sort())
    const urls = sitemap().map((e) => e.url)
    for (const path of paths) {
      expect(PUBLIC_PAGES).toContain(path)
      expect(urls).toContain(`${SITE_URL}${path}`)
    }
  })

  it('each have a <title> and a description no other public page has', () => {
    const titles = paths.map(titleOf)
    const descriptions = paths.map((p) => pages[p].metadata.description)
    expect(new Set(titles).size).toBe(3)
    expect(new Set(descriptions).size).toBe(3)
    // Not the home page's or a search page's either (tests/launch.test.ts checks every public page together).
    for (const title of titles) expect(title).not.toMatch(/^tiebreak — /)
    for (const guide of GUIDES) expect(titles.some((t) => t.startsWith(guide.label))).toBe(false)
  })

  it.each(paths)('%s has its own canonical URL, and a title and description that name the tool', (path) => {
    const { metadata } = pages[path]
    const { name } = toolOf(path)
    expect(metadata.alternates?.canonical).toBe(path)
    expect(String(metadata.title)).toContain(name)
    expect(metadata.description?.toLowerCase()).toContain(name.toLowerCase())
    expect(metadata.description?.length).toBeGreaterThan(80)
    expect(metadata.description?.length).toBeLessThan(200)
  })

  it.each(paths)('%s has one h1, naming the tool', (path) => {
    const html = renderToString(pages[path].default())
    const h1s = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => m[1])
    expect(h1s).toHaveLength(1)
    expect(textOf(h1s[0]).trim()).toBe(toolOf(path).name)
  })

  it.each(paths)('%s has the image picker (2–4 JPEG, PNG or WebP) and the Let strangers pick button', (path) => {
    const html = renderToString(pages[path].default())
    const picker = html.match(/<input[^>]*type="file"[^>]*>/g) ?? []
    expect(picker).toHaveLength(1)
    expect(picker[0]).toContain('multiple=""')
    expect(picker[0]).toContain('accept="image/jpeg,image/png,image/webp"')
    expect(picker[0]).toContain('aria-label="Add images"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Let strangers pick<\/button>/) // until 2 images are in
    expect(count(html, /class="preview-tile/g)).toBe(0)
  })

  it.each(paths)('%s says the images stay on the device until a poll is asked for, and claims nothing it can’t back', (path) => {
    const text = textOf(renderToString(pages[path].default()))
    expect(text).toMatch(/stay on your device/)
    expect(text).toMatch(/uploaded only when you press Let strangers pick/)
    expect(text).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|creators|authors|customers|people)\b/i)
    expect(text).not.toMatch(/testimonial|trusted by|\d+% (more|of)|guarantee/i)
  })

  it('the footer links to all three', () => {
    const footer = renderToString(RootLayout({ children: null })).match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    for (const path of paths) expect(footer).toContain(`href="${path}"`)
  })
})

describe('the preview mocks', () => {
  const render = (kind: (typeof TOOLS)[number]['kind'], candidates = three) =>
    renderToString(createElement(Previews, { kind, candidates }))

  it('Etsy: each image in a search-grid mock at the 1:1, 4:3 and 5:4 crops, so 3 images make 9 tiles', () => {
    expect(ETSY_CROPS.map((c) => c.label)).toEqual(['1:1', '4:3', '5:4'])
    const html = render('etsy')
    expect(count(html, /class="preview-tile/g)).toBe(9)
    for (const crop of ETSY_CROPS) {
      const grid = html.match(new RegExp(`<section[^>]*data-crop="${crop.label}"[^>]*>(.*?)</section>`, 's'))?.[1] ?? ''
      expect(count(grid, /class="preview-tile/g)).toBe(3)
      expect(count(grid, new RegExp(`class="crop ${crop.className}"`, 'g'))).toBe(3)
      // Every candidate, in order, from its local URL: nothing to fetch.
      expect([...grid.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1])).toEqual(three.map((c) => c.src))
    }
  })

  it('Book covers: each cover on a 160 px shelf and an 80 px shelf, next to the others', () => {
    expect(COVER_HEIGHTS).toEqual([160, 80])
    const html = render('book-cover')
    for (const height of COVER_HEIGHTS) {
      const shelf = html.match(new RegExp(`<section[^>]*data-height="${height}"[^>]*>(.*?)</section>`, 's'))?.[1] ?? ''
      expect(count(shelf, /class="preview-tile cover"/g)).toBe(3)
      expect([...shelf.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1])).toEqual(three.map((c) => c.src))
    }
    expect(count(html, /class="preview-tile/g)).toBe(6)
  })

  it('YouTube: each candidate at 16:9 in a desktop-grid tile and a phone-feed tile', () => {
    const html = render('youtube')
    for (const mock of ['yt-desktop', 'yt-phone']) {
      const section = html.match(new RegExp(`<section class="mock ${mock}"[^>]*>(.*?)</section>`, 's'))?.[1] ?? ''
      expect(count(section, /class="preview-tile yt-tile"/g)).toBe(3)
      expect(count(section, /class="crop ratio-16-9"/g)).toBe(3)
    }
  })

  it('labels every tile with its option letter, and shows nothing without images', () => {
    const html = render('etsy')
    for (const { letter } of three) expect(count(html, new RegExp(`alt="${letter}, `, 'g'))).toBe(3)
    for (const kind of ['etsy', 'book-cover', 'youtube'] as const) expect(count(render(kind, []), /preview-tile/g)).toBe(0)
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('the visit beacon on the tool pages', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('location', { origin: 'https://tiebreak-phi.vercel.app' })
    vi.stubGlobal('document', { referrer: 'https://www.google.com/' })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const sent = () =>
    fetchMock.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit]
      return { url, body: JSON.parse(init.body as string) }
    })

  it.each(paths)('a visit to %s carries its own path', (path) => {
    sendSignal('visit', path)
    expect(sent()).toEqual([{ url: SIGNAL_URL, body: { slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/', path } }])
  })

  it('counts each tool page once per session, apart from the session’s other visit', () => {
    sendSignal('visit', paths[0])
    sendSignal('visit', paths[0])
    sendSignal('visit') // e.g. the home page next: this session is already counted
    sendSignal('visit', paths[1])
    expect(sent().map((c) => c.body.path)).toEqual([paths[0], paths[1]])
  })

  it('still counts a tool page the session reached from another page', () => {
    sendSignal('visit') // landed on the home page or a search page
    sendSignal('visit', paths[2])
    expect(sent().map((c) => c.body)).toEqual([
      { slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/' },
      { slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/', path: paths[2] },
    ])
  })

  it('a landing on a tool page sends one visit, with its path, even if the layout’s beacon runs first', () => {
    countVisit(paths[0]) // the layout's beacon leaves tool pages to the tool
    sendSignal('visit', paths[0]) // the tool's own
    expect(sent().map((c) => c.body.path)).toEqual([paths[0]])
  })

  it('the layout’s beacon counts every other page, the search pages included, without a path', () => {
    countVisit(GUIDES[0].path)
    expect(sent().map((c) => c.body)).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/' }])
  })

  it('isToolPath picks out the tool pages only, not the search pages of the SEO experiment', () => {
    for (const path of paths) expect(isToolPath(path)).toBe(true)
    for (const path of ['/', '/feed', '/p/AAAAAAAAAAAA', '/tools', ...GUIDES.map((g) => g.path)]) expect(isToolPath(path)).toBe(false)
  })
})
