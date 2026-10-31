// The free Etsy listing photo tester (GROWTH.md, 2026-10-31): one public page, in the sitemap, with its own
// title, description and h1; an empty mock Etsy search grid and a picker for 2–4 photos; a new-poll form that
// takes the picked photos as its options; and a visit beacon that carries the page's path, so its visitors
// count apart from the search pages. The browser half is tests/etsy-photo-test-browser.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import type { AccountView } from '@/lib/credits'
import { PATHS_COUNTED_APART, sendSignal } from '@/lib/beacon'
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '@/lib/limits'
import { ETSY_PHOTO_TEST_PATH, HOME_TITLE, PUBLIC_PAGES, SITE_URL } from '@/lib/site'
import { useTestDb } from './helpers'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const tester = await import('@/app/tools/etsy-listing-photo-test/page')
const { default: RootLayout } = await import('@/app/layout')
const etsyGuide = await import('@/app/which-etsy-photo-is-best/page')
const { CreatePollForm } = await import('@/app/create-poll-form')
const { refusal } = await import('@/app/tools/etsy-listing-photo-test/photo-tester')

useTestDb()

const renderTester = async () => renderToString(await tester.default())
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ')

describe('the Etsy listing photo tester page', () => {
  it('lives at /tools/etsy-listing-photo-test, a public page the sitemap lists', () => {
    expect(ETSY_PHOTO_TEST_PATH).toBe('/tools/etsy-listing-photo-test')
    expect(PUBLIC_PAGES).toContain(ETSY_PHOTO_TEST_PATH)
    expect(sitemap().map((e) => e.url)).toContain(`${SITE_URL}${ETSY_PHOTO_TEST_PATH}`)
  })

  it('has its own canonical URL, a title naming the tool and a meta description', () => {
    const { metadata } = tester
    expect(metadata.alternates?.canonical).toBe(ETSY_PHOTO_TEST_PATH)
    expect(metadata.title).toBe('Free Etsy listing photo tester: compare main photos in a search grid')
    expect(metadata.title).not.toBe(HOME_TITLE)
    expect(metadata.description).toMatch(/Etsy/)
    expect(metadata.description?.length).toBeGreaterThan(80)
    expect(metadata.description?.length).toBeLessThan(200)
  })

  it('has one h1, and it names the tool', async () => {
    const html = await renderTester()
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*>Free Etsy listing photo tester<\/h1>/)
  })

  it('starts with an empty mock Etsy search grid, a picker for several photos and "Let strangers pick" off', async () => {
    const html = await renderTester()
    expect(html).toMatch(/<section[^>]*aria-label="Mock Etsy search results"/)
    const picker = html.match(/<input[^>]*aria-label="Add photos"[^>]*>/)?.[0] ?? ''
    expect(picker).toContain('type="file"')
    expect(picker).toContain('multiple=""')
    expect(picker).toContain('accept="image/jpeg,image/png,image/webp"')
    expect(html).not.toMatch(/<img[^>]*class="etsy-img"/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Let strangers pick<\/button>/)
    // The new-poll form opens only once there are photos to put in it.
    expect(html).not.toContain('<form')
  })

  it('says the photos stay on the device until a poll is posted', async () => {
    expect(textOf(await renderTester())).toMatch(/stay on (this|your) device until you post/i)
  })

  it('is linked from the footer and from the Etsy photo guide', () => {
    const footer = renderToString(RootLayout({ children: null })).match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    expect(footer).toContain(`href="${ETSY_PHOTO_TEST_PATH}"`)
    expect(renderToString(etsyGuide.default())).toContain(`href="${ETSY_PHOTO_TEST_PATH}"`)
  })

  it('makes no claim the product can’t back: no user counts, testimonials or percentages', async () => {
    const text = textOf(await renderTester())
    expect(text).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|shops|creators|customers|votes)\b/i)
    expect(text).not.toMatch(/testimonial|trusted by|\d+%/i)
  })
})

describe('the new-poll form, opened from the tester', () => {
  const account: AccountView = { credits: 0, countedVotes: 0, publicPolls: 0, votesToNextCredit: 5 }
  const photo = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type })

  it('takes the picked photos as options A–C, in order, with the question filled in', () => {
    const photos = [photo('shelf.jpg', 'image/jpeg'), photo('in-hand.png', 'image/png'), photo('flat-lay.webp', 'image/webp')]
    const html = renderToString(
      createElement(CreatePollForm, {
        account,
        plan: 'free',
        initialQuestion: 'Which picture do you think is best for my Etsy listing?',
        initialPhotos: photos,
      }),
    )
    const legends = [...html.matchAll(/<legend>Option <!-- -->([A-D])<\/legend>/g)].map((m) => m[1])
    expect(legends).toEqual(['A', 'B', 'C'])
    const names = [...html.matchAll(/<span class="photo-name">([^<]+)<\/span>/g)].map((m) => m[1])
    expect(names).toEqual(['shelf.jpg', 'in-hand.png', 'flat-lay.webp'])
    expect(html.match(/>Change photo</g)).toHaveLength(3)
    expect(html).toContain('value="Which picture do you think is best for my Etsy listing?"')
  })

  it('is the usual two empty options without photos', () => {
    const html = renderToString(createElement(CreatePollForm, { account, plan: 'free' }))
    expect([...html.matchAll(/<legend>Option <!-- -->([A-D])<\/legend>/g)].map((m) => m[1])).toEqual(['A', 'B'])
    expect(html).not.toContain('class="photo-name"')
  })
})

describe('which files the tester takes', () => {
  const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type })

  it('takes a JPEG, PNG or WebP of up to 5 MB', () => {
    for (const type of IMAGE_TYPES) expect(refusal(file('photo', type, MAX_IMAGE_BYTES))).toBeNull()
  })

  it('leaves out anything else, or anything over 5 MB, and says which file and why', () => {
    expect(refusal(file('notes.txt', 'text/plain', 10))).toBe('notes.txt: only JPEG, PNG or WebP, up to 5 MB.')
    expect(refusal(file('IMG_0001.heic', 'image/heic', 10))).toMatch(/^IMG_0001\.heic: only JPEG, PNG or WebP/)
    expect(refusal(file('huge.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1))).toBe('huge.jpg is over 5 MB. Try a smaller copy of it.')
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('the visit beacon on the tester', () => {
  const ORIGIN = 'https://tiebreak-phi.vercel.app'
  const GOOGLE = 'https://www.google.com/'
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  const at = (pathname: string) => vi.stubGlobal('location', { origin: ORIGIN, pathname })
  const sent = () => fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('document', { referrer: GOOGLE })
    at('/')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('counts the tester apart, and only the tester', () => {
    expect(PATHS_COUNTED_APART).toEqual([ETSY_PHOTO_TEST_PATH])
  })

  it('a visit that lands on the tester carries its path', () => {
    at(ETSY_PHOTO_TEST_PATH)
    sendSignal('visit')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: GOOGLE, path: ETSY_PHOTO_TEST_PATH }])
  })

  it('a visit that lands on a search page or the home page carries no path', () => {
    at('/which-etsy-photo-is-best')
    sendSignal('visit')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: GOOGLE }])
  })

  it('still counts the tester when the session started on another page, once, without that landing referrer', () => {
    sendSignal('visit') // landed on the home page from Google
    // A link to the tester: the address doesn't change before the page mounts, so it names its own path.
    sendSignal('visit', ETSY_PHOTO_TEST_PATH)
    sendSignal('visit', ETSY_PHOTO_TEST_PATH)
    at(ETSY_PHOTO_TEST_PATH)
    sendSignal('visit') // a reload of the tester in the same session
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'visit', referrer: GOOGLE },
      { slug: 'tiebreak', kind: 'visit', referrer: null, path: ETSY_PHOTO_TEST_PATH },
    ])
  })

  it('landing on the tester is the session’s visit too: the next page sends no second one', () => {
    at(ETSY_PHOTO_TEST_PATH)
    sendSignal('visit')
    at('/')
    sendSignal('visit')
    expect(sent()).toHaveLength(1)
  })

  it('activate and checkout carry no path, even from the tester', () => {
    at(ETSY_PHOTO_TEST_PATH)
    sendSignal('activate')
    sendSignal('checkout')
    for (const body of sent()) expect(body).not.toHaveProperty('path')
  })

  it('sends nothing from the tester on a preview deployment or from an automated browser', () => {
    at(ETSY_PHOTO_TEST_PATH)
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    sendSignal('visit')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('navigator', { webdriver: true })
    sendSignal('visit', ETSY_PHOTO_TEST_PATH)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
