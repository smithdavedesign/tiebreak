// The free thumbnail preview tools (GROWTH.md, 2026-10-21): three search-landing pages, each with its own
// title, description and h1, listed in the sitemap; the preview mocks each tool draws (Etsy: three crops;
// book covers: about 160 and 80 px tall; YouTube: 16:9 in a desktop grid and a phone feed); the hand-off to
// the new-poll form (options A–C prefilled with the uploaded photos); and the visit beacon's path, so the
// tools' visitors are counted apart from the search pages'. The same things in a real browser, uploads and
// the posted poll included, are in tests/thumbnail-tools-browser.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import { sendSignal } from '@/lib/beacon'
import { GUIDES } from '@/lib/guides'
import { PUBLIC_PAGES, SITE_URL } from '@/lib/site'
import { TOOLS, toolBySlug, type Tool } from '@/lib/tools'
import { useTestDb } from './helpers'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const toolPage = await import('@/app/tools/[tool]/page')
const { PreviewMocks } = await import('@/app/tools/[tool]/thumbnail-preview')
const home = await import('@/app/page')
const { default: RootLayout } = await import('@/app/layout')
const { default: PrivacyPage } = await import('@/app/privacy/page')
const guidePages = [
  await import('@/app/pickfu-alternative/page'),
  await import('@/app/which-etsy-photo-is-best/page'),
  await import('@/app/choose-a-thumbnail-or-book-cover/page'),
]

useTestDb()

const PATHS = ['/tools/etsy-thumbnail-preview', '/tools/book-cover-thumbnail-test', '/tools/youtube-thumbnail-preview']
const params = (tool: string) => ({ params: Promise.resolve({ tool }) })
const tool = (slug: string) => toolBySlug(slug) as Tool
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim()
const renderTool = async (slug: string) => renderToString(await toolPage.default(params(slug)))

describe('the three tool pages', () => {
  it('are the Etsy, book cover and YouTube tools, at /tools/<slug>, and only those three are built', async () => {
    expect(TOOLS.map((t) => t.path)).toEqual(PATHS)
    for (const t of TOOLS) expect(t.path).toBe(`/tools/${t.slug}`)
    expect(await toolPage.generateStaticParams()).toEqual(TOOLS.map((t) => ({ tool: t.slug })))
    // Any other /tools/<slug> is a 404, not a page rendered on demand.
    expect(toolPage.dynamicParams).toBe(false)
    await expect(renderTool('instagram-thumbnail-preview')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(toolPage.generateMetadata(params('instagram-thumbnail-preview'))).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('are all in PUBLIC_PAGES and the sitemap, and open to search engines', async () => {
    const urls = sitemap().map((e) => e.url)
    const robots = (await import('@/app/robots')).default()
    for (const path of PATHS) {
      expect(PUBLIC_PAGES).toContain(path)
      expect(urls).toContain(`${SITE_URL}${path}`)
      expect((robots.rules as { disallow: string[] }).disallow.some((prefix) => path.startsWith(prefix))).toBe(false)
    }
  })

  it.each(TOOLS.map((t) => t.slug))('%s has its own canonical URL, title, description and share tags', async (slug) => {
    const t = tool(slug)
    const meta = await toolPage.generateMetadata(params(slug))
    expect(meta.alternates?.canonical).toBe(t.path)
    expect(meta.title).toBe(t.title)
    expect(meta.description).toBe(t.description)
    expect(meta.openGraph).toMatchObject({ url: t.path, title: `${t.title} · tiebreak`, description: t.description })
    // The title names the tool, so a search result says what the page is.
    expect(t.title.toLowerCase()).toContain(t.name.toLowerCase())
    expect(t.description.length).toBeGreaterThan(80)
    expect(t.description.length).toBeLessThan(200)
  })

  it('titles and descriptions are unique, among the tools and against every other public page', async () => {
    const titles = TOOLS.map((t) => t.title)
    const descriptions = TOOLS.map((t) => t.description)
    expect(new Set(titles).size).toBe(3)
    expect(new Set(descriptions).size).toBe(3)
    // The other pages' titles and descriptions (tests/launch.test.ts checks all of them together too).
    for (const m of [home, ...guidePages].map((page) => page.metadata)) {
      expect(titles).not.toContain(m.title)
      expect(descriptions).not.toContain(m.description)
    }
  })

  it.each(TOOLS.map((t) => t.slug))('%s has one h1, and it names the tool', async (slug) => {
    const html = await renderTool(slug)
    const h1s = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => text(m[1]))
    expect(h1s).toEqual([tool(slug).name])
    expect(h1s[0]).toMatch(/^(Etsy|Book cover|YouTube) thumbnail (preview|test)$/)
  })

  it.each(TOOLS.map((t) => t.slug))('%s starts empty, with a picker for 2–4 images and the "Let strangers pick" button', async (slug) => {
    const html = await renderTool(slug)
    const picker = html.match(/<input[^>]*type="file"[^>]*>/g) ?? []
    expect(picker).toHaveLength(1)
    for (const attr of ['multiple=""', 'accept="image/jpeg,image/png,image/webp"', 'aria-label="Add images"']) expect(picker[0]).toContain(attr)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Let strangers pick<\/button>/)
    // Nothing to preview yet, and no image is on the page until the visitor adds one.
    expect(html).not.toContain('data-view=')
    expect(text(html)).toContain('stay on your device until you ask for a poll')
  })

  it('the footer links every tool, so crawlers and visitors find them from any page', () => {
    const footer = renderToString(RootLayout({ children: null })).match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    for (const t of TOOLS) expect(footer).toContain(`href="${t.path}">${t.name}</a>`)
  })

  it('each tool page links the other two', async () => {
    for (const t of TOOLS) {
      const html = await renderTool(t.slug)
      for (const other of TOOLS.filter((o) => o !== t)) expect(html).toContain(`href="${other.path}"`)
    }
  })

  it('make no claim the product cannot back: no user counts, testimonials or statistics', async () => {
    for (const t of TOOLS) {
      const body = text(await renderTool(t.slug))
      expect(body).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|creators|customers|authors|people)\b/i)
      expect(body).not.toMatch(/testimonial|trusted by|\d+\s?%|guarantee|increase your|boost your/i)
    }
  })
})

/** Three candidates as the tool holds them: drawn from the device (blob: URLs), never fetched. */
const picked = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: i, src: `blob:http://localhost:3000/photo-${i}`, name: `photo-${i}.jpg` }))

type Tile = { view: string; option: string; style: string; src: string; layout: string }

/** The preview tiles a tool draws for these candidates, read from the server-rendered HTML. */
function tiles(slug: string, n: number): Tile[] {
  const html = renderToString(createElement(PreviewMocks, { tool: tool(slug), candidates: picked(n) }))
  const out: Tile[] = []
  for (const section of html.matchAll(/<section class="mock mock-(\w+)"[^>]*>(.*?)<\/section>/gs)) {
    for (const img of section[2].matchAll(/<img [^>]*>/g)) {
      const attr = (name: string) => img[0].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
      out.push({ view: attr('data-view'), option: attr('data-option'), style: attr('style'), src: attr('src'), layout: section[1] })
    }
  }
  return out
}

describe('the preview mocks (criteria 2 and 3)', () => {
  it('Etsy: 3 images make 9 tiles in a search-grid mock, each image at the 1:1, 4:3 and 5:4 crops', () => {
    const all = tiles('etsy-thumbnail-preview', 3)
    expect(all).toHaveLength(9)
    const crops = { '1:1': 'aspect-ratio:1 / 1', '4:3': 'aspect-ratio:4 / 3', '5:4': 'aspect-ratio:5 / 4' }
    for (const [view, style] of Object.entries(crops)) {
      const these = all.filter((t) => t.view === view)
      expect(these.map((t) => t.option)).toEqual(['A', 'B', 'C'])
      for (const t of these) {
        expect(t.style).toContain(style)
        expect(t.layout).toBe('grid')
      }
    }
  })

  it('book covers: each cover at about 160 px and about 80 px tall, uncropped, in a row with the others', () => {
    const all = tiles('book-cover-thumbnail-test', 3)
    expect(all).toHaveLength(6)
    for (const [view, px] of [['160', 160], ['80', 80]] as const) {
      const these = all.filter((t) => t.view === view)
      expect(these.map((t) => t.option)).toEqual(['A', 'B', 'C'])
      for (const t of these) {
        expect(t.style).toContain(`height:${px}px`)
        expect(t.style).not.toContain('aspect-ratio')
        expect(t.layout).toBe('shelf')
      }
    }
  })

  it('YouTube: each candidate at 16:9 in a desktop-grid tile and a phone-feed tile', () => {
    const all = tiles('youtube-thumbnail-preview', 3)
    expect(all).toHaveLength(6)
    for (const [view, layout] of [['desktop', 'grid'], ['phone', 'feed']]) {
      const these = all.filter((t) => t.view === view)
      expect(these.map((t) => t.option)).toEqual(['A', 'B', 'C'])
      for (const t of these) {
        expect(t.style).toContain('aspect-ratio:16 / 9')
        expect(t.layout).toBe(layout)
      }
    }
  })

  it('draws from the files on the device: every tile is a blob: URL, so nothing is fetched or uploaded', () => {
    for (const t of TOOLS) for (const tile of tiles(t.slug, 4)) expect(tile.src).toMatch(/^blob:/)
  })

  it('takes 2–4 candidates side by side: 2 and 4 make 2 and 4 tiles per view, lettered like poll options', () => {
    for (const t of TOOLS) {
      for (const n of [2, 4]) {
        const all = tiles(t.slug, n)
        expect(all).toHaveLength(n * t.views.length)
        for (const view of t.views) {
          expect(all.filter((x) => x.view === view.key).map((x) => x.option)).toEqual([...'ABCD'.slice(0, n)])
        }
      }
    }
  })
})

describe('the new-poll form after "Let strangers pick" (criterion 4, server side)', () => {
  const ids = ['AAAAbbbbCCCCdddd', 'eeeeFFFFgggg_-12', 'Z9y8X7w6V5u4T3s2']
  const renderHome = async (query: Record<string, string | string[]>) =>
    renderToString(await home.default({ searchParams: Promise.resolve(query) }))
  const optionGroups = (html: string) => [...html.matchAll(/<legend>Option (?:<!-- -->)?([A-D])<\/legend>/g)].map((m) => m[1])

  it('prefills options A–C with the three uploaded photos and the tool’s question', async () => {
    const html = await renderHome({ tool: 'etsy-thumbnail-preview', photo: ids })
    expect(optionGroups(html)).toEqual(['A', 'B', 'C'])
    expect(html).toContain(`value="${tool('etsy-thumbnail-preview').question}"`)
    // Each option holds its photo (named, until the thumbnail is drawn from the file in the browser).
    expect(html.match(/<span class="photo-name">Uploaded photo<\/span>/g)).toHaveLength(3)
    expect(html.match(/>Remove photo</g)).toHaveLength(3)
    // The photos replace the image-link inputs.
    expect(html).not.toContain('image URL"')
    expect(text(html)).toContain('Your 3 images from the Etsy thumbnail preview are options A–C')
  })

  it.each(TOOLS.map((t) => t.slug))('starts the poll with %s’s own question', async (slug) => {
    const html = await renderHome({ tool: slug, photo: ids.slice(0, 2) })
    expect(html).toContain(`value="${tool(slug).question.replace(/'/g, '&#x27;')}"`)
    expect(optionGroups(html)).toEqual(['A', 'B'])
    expect(text(html)).toContain(`from the ${tool(slug).name} are options A and B`)
  })

  it('keeps only real photo ids, each once, and at most four', async () => {
    const bad = ['../../polls', 'short', 'AAAAbbbbCCCCdddd?x', 'AAAAbbbbCCCCdddd/', '']
    let html = await renderHome({ photo: [...bad, ids[0], ids[0]] })
    expect(optionGroups(html)).toEqual(['A', 'B'])
    expect(html.match(/Uploaded photo/g)).toHaveLength(1)
    const five = [...ids, 'qqqqQQQQwwwwWWWW', 'rrrrRRRRttttTTTT']
    html = await renderHome({ tool: 'youtube-thumbnail-preview', photo: five })
    expect(optionGroups(html)).toEqual(['A', 'B', 'C', 'D'])
    // A single photo param arrives as a string, not a list.
    html = await renderHome({ photo: ids[1] })
    expect(html.match(/Uploaded photo/g)).toHaveLength(1)
  })

  it('without photos, or for an unknown tool, the start page is the usual blank form', async () => {
    const blank = await renderHome({})
    expect(optionGroups(blank)).toEqual(['A', 'B'])
    expect(blank).not.toContain('Uploaded photo')
    expect(blank).not.toMatch(/class="notice"/)
    const unknown = await renderHome({ tool: 'not-a-tool' })
    expect(unknown).toBe(blank)
  })
})

describe('the visit beacon on the tool pages (criterion 5)', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  const visitOn = (pathname: string, search = '') => {
    vi.stubGlobal('sessionStorage', memory())
    vi.stubGlobal('location', { origin: 'https://tiebreak-phi.vercel.app', pathname, search, href: `https://tiebreak-phi.vercel.app${pathname}${search}` })
  }
  const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memory())
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('document', { referrer: 'https://www.google.com/' })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('each tool page sends its visit with its own path', () => {
    for (const path of PATHS) {
      visitOn(path)
      sendSignal('visit')
    }
    expect(bodies()).toEqual(
      PATHS.map((path) => ({ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/', path })),
    )
  })

  it('so they count apart from the search pages, which send theirs', () => {
    for (const path of [...PATHS, ...GUIDES.map((g) => g.path)]) {
      visitOn(path)
      sendSignal('visit')
    }
    const paths = bodies().map((b) => b.path)
    expect(paths.filter((p) => p.startsWith('/tools/'))).toEqual(PATHS)
    expect(new Set(paths).size).toBe(PATHS.length + GUIDES.length)
  })

  it('sends the path only, never the query string (the new-poll form’s carries photo ids)', () => {
    visitOn('/', '?tool=etsy-thumbnail-preview&photo=AAAAbbbbCCCCdddd')
    sendSignal('visit')
    expect(bodies()[0].path).toBe('/')
    expect(JSON.stringify(bodies()[0])).not.toContain('photo')
  })

  it('still counts a visit once per session, and activate and checkout carry no path', () => {
    visitOn('/tools/youtube-thumbnail-preview')
    sendSignal('visit')
    sendSignal('visit')
    sendSignal('activate')
    sendSignal('checkout')
    expect(bodies().map((b) => [b.kind, b.path])).toEqual([
      ['visit', '/tools/youtube-thumbnail-preview'],
      ['activate', undefined],
      ['checkout', undefined],
    ])
  })

  it('the privacy page says a visit carries its page’s path, and that tool images stay on the device', () => {
    const html = text(renderToString(PrivacyPage()))
    expect(html).toContain('the path of the page you opened')
    expect(html).toMatch(/preview tools?.*stay on your device/is)
  })
})
