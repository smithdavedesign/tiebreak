// The free thumbnail preview tools (GROWTH.md, 2026-10-20): three search-landing pages under /tools/ that
// preview 2–4 local images side by side and hand them to a poll. These checks need no browser: each page's
// title, description and h1, the sitemap, the tiles each preview draws, the hand-off to the new-poll form,
// and the visit beacon's path. tests/thumbnail-tools-browser.test.ts drives the same pages in Chromium.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import { COVER_HEIGHTS, CoverPreview, ETSY_CROPS, EtsyPreview, YouTubePreview, type Candidate } from '@/app/tools/previews'
import { pagePath, sendSignal } from '@/lib/beacon'
import { creditsFrom } from '@/lib/credits'
import { clearPollDraft, offerPollDraft, peekPollDraft, type PollDraft } from '@/lib/poll-draft'
import { PUBLIC_PAGES, SITE_URL } from '@/lib/site'
import { TOOLS } from '@/lib/tools'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: RootLayout } = await import('@/app/layout')
const { CreatePollForm } = await import('@/app/create-poll-form')
const { ThumbnailTool } = await import('@/app/tools/thumbnail-tool')
const pages = {
  '/tools/etsy-thumbnail-preview': await import('@/app/tools/etsy-thumbnail-preview/page'),
  '/tools/book-cover-thumbnail-test': await import('@/app/tools/book-cover-thumbnail-test/page'),
  '/tools/youtube-thumbnail-preview': await import('@/app/tools/youtube-thumbnail-preview/page'),
}
const paths = Object.keys(pages) as (keyof typeof pages)[]
const NAMES = {
  '/tools/etsy-thumbnail-preview': 'Etsy thumbnail preview',
  '/tools/book-cover-thumbnail-test': 'Book cover thumbnail test',
  '/tools/youtube-thumbnail-preview': 'YouTube thumbnail preview',
}
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '')
const h1Of = (html: string) => textOf(html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1] ?? '')
/** Every element carrying data-tile, as its attributes. */
const tiles = (html: string) =>
  [...html.matchAll(/<[a-z]+ [^>]*data-tile="[^"]*"[^>]*>/g)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
  )
/** The declarations of one CSS rule, by its exact selector. */
const ruleFor = (selector: string) =>
  css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

/** Three local images as the tool holds them: object URLs, never uploaded. */
const three: Candidate[] = ['A', 'B', 'C'].map((letter, i) => ({
  id: i,
  letter,
  name: `mug-${letter.toLowerCase()}.jpg`,
  src: `blob:http://tiebreak.test/0000000${i}`,
}))

describe('the tool pages', () => {
  it('are the TOOLS list, and each is in PUBLIC_PAGES and /sitemap.xml', () => {
    expect(TOOLS.map((t) => t.path).sort()).toEqual([...paths].sort())
    const urls = sitemap().map((e) => e.url)
    for (const path of paths) {
      expect(PUBLIC_PAGES).toContain(path)
      expect(urls).toContain(`${SITE_URL}${path}`)
    }
  })

  it.each(paths)('%s has its own canonical URL, a title naming the tool and a description', (path) => {
    const { metadata } = pages[path]
    expect(metadata.alternates?.canonical).toBe(path)
    expect(String(metadata.title)).toContain(NAMES[path])
    expect(metadata.description?.length).toBeGreaterThan(80)
    expect(metadata.description?.length).toBeLessThan(200)
  })

  it('have a title and a description no other tool page shares', () => {
    const titles = paths.map((p) => String(pages[p].metadata.title))
    const descriptions = paths.map((p) => pages[p].metadata.description)
    expect(new Set(titles).size).toBe(3)
    expect(new Set(descriptions).size).toBe(3)
  })

  it.each(paths)('%s has one h1, naming the tool, and the tool itself', (path) => {
    const html = renderToString(pages[path].default())
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    expect(h1Of(html)).toBe(NAMES[path])
    const tool = TOOLS.find((t) => t.path === path)!
    expect(html).toContain(`data-tool="${tool.kind}"`)
    expect(html).toMatch(/<input type="file" multiple=""[^>]*accept="image\/jpeg,image\/png,image\/webp"/)
  })

  it.each(paths)('%s links to the other two tools', (path) => {
    const html = renderToString(pages[path].default())
    for (const other of paths) {
      if (other !== path) expect(html).toContain(`href="${other}"`)
    }
  })

  it('the footer links to every tool', () => {
    const footer = renderToString(RootLayout({ children: null })).match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    for (const path of paths) expect(footer).toContain(`href="${path}"`)
  })

  it('make no claim of testimonials, user counts or results the product can’t back', () => {
    for (const path of paths) {
      const text = textOf(renderToString(pages[path].default()))
      expect(text).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|authors|creators|customers)\b/i)
      expect(text).not.toMatch(/testimonial|trusted by|\d+% (more|of)|guarantee/i)
    }
  })
})

describe('the tool before any image is added', () => {
  it.each(TOOLS.map((t) => t.kind))('%s: draws no tiles, uploads nothing and keeps the poll button off', (kind) => {
    const html = renderToString(createElement(ThumbnailTool, { kind }))
    expect(tiles(html)).toEqual([])
    expect(html).toMatch(/<button type="button" disabled="">Let strangers pick<\/button>/)
    expect(textOf(html)).toContain('stay on this device until you')
  })
})

describe('the Etsy preview', () => {
  it('shows 3 images in a search grid at the 1:1, 4:3 and 5:4 crops: 9 tiles', () => {
    const found = tiles(renderToString(createElement(EtsyPreview, { candidates: three })))
    expect(found).toHaveLength(9)
    expect(ETSY_CROPS.map((c) => c.ratio)).toEqual(['1:1', '4:3', '5:4'])
    for (const crop of ETSY_CROPS) {
      const inCrop = found.filter((t) => t['data-crop'] === crop.ratio)
      expect(inCrop.map((t) => t['data-option'])).toEqual(['A', 'B', 'C'])
      for (const t of inCrop) {
        expect(t['data-tile']).toBe('etsy')
        expect(t.class).toContain(crop.className)
      }
    }
  })

  it('draws each tile from the local image (its object URL)', () => {
    const html = renderToString(createElement(EtsyPreview, { candidates: three }))
    for (const c of three) expect(html.split(`src="${c.src}"`)).toHaveLength(4) // once per crop
  })

  it('crops each tile to its ratio in CSS, filling it', () => {
    expect(ruleFor('.crop-1x1')).toMatch(/aspect-ratio:\s*1 \/ 1/)
    expect(ruleFor('.crop-4x3')).toMatch(/aspect-ratio:\s*4 \/ 3/)
    expect(ruleFor('.crop-5x4')).toMatch(/aspect-ratio:\s*5 \/ 4/)
    expect(ruleFor('.tile img')).toMatch(/object-fit:\s*cover/)
  })
})

describe('the book cover preview', () => {
  it('shows every cover about 160 px and about 80 px tall, next to the others', () => {
    const html = renderToString(createElement(CoverPreview, { candidates: three }))
    const found = tiles(html)
    expect(COVER_HEIGHTS).toEqual([160, 80])
    for (const height of COVER_HEIGHTS) {
      const row = found.filter((t) => t['data-height'] === String(height))
      expect(row.map((t) => t['data-option'])).toEqual(['A', 'B', 'C'])
      for (const t of row) expect(t.class).toContain(`cover-${height}`)
      expect(ruleFor(`.cover-${height}`)).toMatch(new RegExp(`height:\\s*${height}px`))
    }
    // Each size is one row: covers sit side by side, keeping their own shape.
    expect(ruleFor('.cover-row')).toMatch(/display:\s*flex/)
    expect(ruleFor('.cover-row img')).toMatch(/width:\s*auto/)
  })
})

describe('the YouTube preview', () => {
  it('shows every candidate at 16:9 in a desktop-grid tile and a phone-feed tile', () => {
    const found = tiles(renderToString(createElement(YouTubePreview, { candidates: three })))
    for (const place of ['youtube-desktop', 'youtube-phone']) {
      const inPlace = found.filter((t) => t['data-tile'] === place)
      expect(inPlace.map((t) => t['data-option'])).toEqual(['A', 'B', 'C'])
      for (const t of inPlace) expect(t.class).toContain('crop-16x9')
    }
    expect(ruleFor('.crop-16x9')).toMatch(/aspect-ratio:\s*16 \/ 9/)
  })
})

describe('handing the images to a poll', () => {
  const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
  const photo = (n: number) => ({ file: file(`cover-${n}.png`), url: `${SITE_URL}/images/AAAAAAAAAAAAAAA${n}` })
  const draft = (count: number): PollDraft => ({
    question: 'Which cover would you pick up?',
    photos: Array.from({ length: count }, (_, i) => photo(i)),
  })
  const renderForm = () =>
    renderToString(createElement(CreatePollForm, { account: creditsFrom(0, 0), plan: 'free' as const }))

  afterEach(() => clearPollDraft())

  it('holds one draft until it is cleared', () => {
    expect(peekPollDraft()).toBeNull()
    const d = draft(3)
    offerPollDraft(d)
    expect(peekPollDraft()).toBe(d)
    clearPollDraft()
    expect(peekPollDraft()).toBeNull()
  })

  it('opens the new-poll form with the uploaded images as options A–C and the tool’s question', () => {
    offerPollDraft(draft(3))
    const html = renderForm()
    const legends = [...html.matchAll(/<legend>Option (?:<!-- -->)?([A-D])<\/legend>/g)].map((m) => m[1])
    expect(legends).toEqual(['A', 'B', 'C'])
    expect(html.split('>Remove photo</button>')).toHaveLength(4)
    for (const n of [0, 1, 2]) expect(html).toContain(`cover-${n}.png`)
    expect(html).toContain('value="Which cover would you pick up?"')
    expect(textOf(html)).toContain('Your 3 images from the preview are options A–C')
  })

  it('takes 2 to 4 images: a 5th is left out, and a lone image gets a blank option B', () => {
    offerPollDraft(draft(5))
    expect([...renderForm().matchAll(/<legend>/g)]).toHaveLength(4)
    offerPollDraft(draft(1))
    const html = renderForm()
    expect([...html.matchAll(/<legend>/g)]).toHaveLength(2)
    expect(html.split('>Remove photo</button>')).toHaveLength(2)
  })

  it('is a blank form without a draft', () => {
    const html = renderForm()
    expect([...html.matchAll(/<legend>/g)]).toHaveLength(2)
    expect(html).not.toContain('Remove photo')
    expect(html).not.toContain('from the preview')
  })
})

describe('the visit beacon on the tool pages', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
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

  it('names each tool page as itself, apart from the search pages', () => {
    for (const path of paths) expect(pagePath(path)).toBe(path)
    expect(pagePath('/which-etsy-photo-is-best')).toBe('/which-etsy-photo-is-best')
    expect(pagePath('/')).toBe('/')
  })

  it('never sends a poll’s own link, or a page that isn’t public', () => {
    expect(pagePath('/p/AbCdEfGhIjKl')).toBe('/p/[id]')
    expect(pagePath('/tools/etsy-thumbnail-preview/extra')).toBeNull()
    expect(pagePath('/account')).toBeNull()
  })

  it.each(paths)('a visit landing on %s carries its path', (path) => {
    vi.stubGlobal('sessionStorage', memory())
    vi.stubGlobal('location', { origin: 'https://tiebreak-phi.vercel.app', pathname: path })
    sendSignal('visit')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      slug: 'tiebreak',
      kind: 'visit',
      referrer: 'https://www.google.com/',
      path,
    })
  })
})
