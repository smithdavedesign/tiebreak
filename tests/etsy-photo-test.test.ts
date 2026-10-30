// The free Etsy listing photo test (GROWTH.md, 2026-10-30): its page and place in the sitemap, the photos it
// takes, the hand-off that opens the new-poll form with them as options A–D, its visit beacon with a path,
// the honest copy, and that the native app is left alone. The browser half is etsy-photo-test-browser.test.ts.
import { execFileSync } from 'node:child_process'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import type { AccountView } from '@/lib/credits'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_OPTIONS } from '@/lib/limits'
import { clearPendingPoll, handOffPoll, pendingPoll } from '@/lib/poll-handoff'
import { sendSignal, visitPath } from '@/lib/beacon'
import { ETSY_PHOTO_TEST_PATH, PUBLIC_PAGES, SIGNAL_URL, SITE_URL } from '@/lib/site'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}))

const tool = await import('@/app/tools/etsy-listing-photo-test/page')
const { POLL_QUESTION, takePhotos } = await import('@/app/tools/etsy-listing-photo-test/photo-test')
const { CreatePollForm } = await import('@/app/create-poll-form')
const { default: RootLayout } = await import('@/app/layout')
const { default: PrivacyPage } = await import('@/app/privacy/page')

const PATH = '/tools/etsy-listing-photo-test'
const html = () => renderToString(tool.default())
const text = () => html().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const photo = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type })

describe('the page', () => {
  it('lives at /tools/etsy-listing-photo-test, is a public page and is in the sitemap', () => {
    expect(ETSY_PHOTO_TEST_PATH).toBe(PATH)
    expect(PUBLIC_PAGES).toContain(PATH)
    expect(sitemap().map((e) => e.url)).toContain(`${SITE_URL}${PATH}`)
  })

  it('has its own title, description and canonical URL, naming the tool', () => {
    const { metadata } = tool
    expect(String(metadata.title)).toMatch(/Etsy listing photo test/i)
    expect(metadata.alternates?.canonical).toBe(PATH)
    expect(metadata.description).toMatch(/Etsy/)
    expect(metadata.description?.length).toBeGreaterThan(80)
    expect(metadata.description?.length).toBeLessThan(200)
  })

  it('has one h1, and it names the tool', () => {
    const h1s = html().match(/<h1[^>]*>.*?<\/h1>/g) ?? []
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toMatch(/Etsy listing photo test/i)
  })

  it('offers a picker for several JPEG, PNG or WebP photos, the mock search grid and a disabled "Let strangers pick"', () => {
    const page = html()
    const input = page.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? ''
    expect(input).toContain(`accept="${IMAGE_TYPES.join(',')}"`)
    expect(input).toContain('multiple')
    expect(input).toContain('aria-label="Add photos"')
    expect(page).toContain('aria-label="Mock Etsy search results"')
    expect(page).toMatch(/<button[^>]*disabled=""[^>]*>Let strangers pick<\/button>/)
  })

  it('is linked from the footer of every page', () => {
    const footer = renderToString(RootLayout({ children: null })).match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    expect(footer).toContain(`href="${PATH}"`)
  })
})

describe('honest copy', () => {
  it('says photos stay on the device until a poll is posted, and that the grid is a mock', () => {
    expect(text()).toMatch(/nothing is uploaded until you create the poll/i)
    expect(text()).toMatch(/not Etsy/i)
  })

  it("doesn't claim one Etsy thumbnail shape (sources disagree), and points to Etsy's own crop check", () => {
    expect(text()).not.toMatch(/Etsy (crops|shows|displays)[^.]*square/i)
    expect(text()).toMatch(/check the crop in Etsy/i)
  })

  it('makes no promise of testimonials, user counts, statistics or demographic targeting', () => {
    expect(text()).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|creators|customers|shoppers)\b/i)
    expect(text()).not.toMatch(/testimonial|trusted by|\d+% (more|of)|demographic/i)
  })
})

describe('takePhotos: the photos a poll can take, and why the rest were skipped', () => {
  const jpeg = photo('blue-mug.jpg', 'image/jpeg')
  const png = photo('white-mug.png', 'image/png')
  const webp = photo('green-mug.webp', 'image/webp')

  it('takes JPEG, PNG and WebP photos, in order', () => {
    expect(takePhotos(0, [jpeg, png, webp])).toEqual({ taken: [jpeg, png, webp], skipped: [] })
  })

  it('skips other types, HEIC and an unlabelled file included', () => {
    const heic = photo('IMG_0001.heic', 'image/heic')
    const gif = photo('spin.gif', 'image/gif')
    const unknown = photo('mystery', '')
    const { taken, skipped } = takePhotos(0, [heic, jpeg, gif, unknown])
    expect(taken).toEqual([jpeg])
    expect(skipped).toEqual([
      { name: 'IMG_0001.heic', reason: 'not a JPEG, PNG or WebP' },
      { name: 'spin.gif', reason: 'not a JPEG, PNG or WebP' },
      { name: 'mystery', reason: 'not a JPEG, PNG or WebP' },
    ])
  })

  it('takes a photo of exactly 5 MB and skips one a byte over', () => {
    const atLimit = photo('at-limit.jpg', 'image/jpeg', MAX_IMAGE_BYTES)
    const over = photo('over.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1)
    expect(takePhotos(0, [atLimit, over])).toEqual({ taken: [atLimit], skipped: [{ name: 'over.jpg', reason: 'over 5 MB' }] })
  })

  it(`stops at ${MAX_OPTIONS}, the most options a poll takes`, () => {
    const extra = photo('fifth.jpg', 'image/jpeg')
    expect(takePhotos(3, [jpeg, extra])).toEqual({
      taken: [jpeg],
      skipped: [{ name: 'fifth.jpg', reason: `a poll takes ${MAX_OPTIONS} photos at most` }],
    })
    expect(takePhotos(MAX_OPTIONS, [jpeg]).taken).toEqual([])
  })
})

describe('the hand-off to the new-poll form', () => {
  const account: AccountView = { credits: 0, countedVotes: 0, publicPolls: 0, votesToNextCredit: 5 }
  // Without React's <!-- --> markers between adjacent text pieces.
  const form = () => renderToString(createElement(CreatePollForm, { account, plan: 'free' })).replace(/<!-- -->/g, '')
  const files = [photo('blue-mug.jpg', 'image/jpeg'), photo('white-mug.png', 'image/png'), photo('green-mug.webp', 'image/webp')]

  afterEach(() => clearPendingPoll())

  it('opens the form with the photos as options A–C and the question filled in, uploading nothing yet', () => {
    handOffPoll({ question: POLL_QUESTION, photos: files })
    const page = form()
    for (const letter of ['A', 'B', 'C']) expect(page).toContain(`<legend>Option ${letter}</legend>`)
    expect(page).not.toContain('<legend>Option D</legend>')
    for (const file of files) expect(page).toContain(file.name)
    expect(page.match(/Change photo/g)).toHaveLength(3)
    expect(page).toContain(`value="${POLL_QUESTION}"`)
    expect(page).toContain('Your 3 photos are options A–C below. They upload when you create the poll.')
  })

  it('is taken once: after it is cleared, the form opens blank with two options', () => {
    handOffPoll({ question: POLL_QUESTION, photos: files })
    expect(pendingPoll()?.photos).toEqual(files)
    clearPendingPoll()
    expect(pendingPoll()).toBeNull()
    const page = form()
    expect(page.match(/<legend>Option [A-D]<\/legend>/g)).toEqual(['<legend>Option A</legend>', '<legend>Option B</legend>'])
    expect(page).not.toContain('Change photo')
    expect(page).not.toContain('They upload when you create the poll')
  })

  it('asks the question the way the buyer would', () => {
    expect(POLL_QUESTION).toBe('Which photo would you click in Etsy search?')
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('the visit beacon', () => {
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
  const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))

  it('names the photo test as the page a visit landed on, and no other page', () => {
    expect(visitPath(PATH)).toBe(PATH)
    for (const other of ['/', '/which-etsy-photo-is-best', '/pickfu-alternative', '/feed', '/p/AAAAAAAAAAAA', '/tools']) {
      expect(visitPath(other)).toBeUndefined()
    }
  })

  it('sends the path with the visit, to the same endpoint, still once per session', () => {
    sendSignal('visit', PATH)
    sendSignal('visit', PATH)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(SIGNAL_URL)
    expect(bodies()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/', path: PATH }])
  })

  it('leaves other visits as they were: no path field', () => {
    sendSignal('visit', visitPath('/which-etsy-photo-is-best'))
    expect(bodies()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/' }])
  })

  it('the privacy page says a visit that starts on the photo test names that page', () => {
    const privacy = renderToString(PrivacyPage())
    expect(privacy).toContain(PATH)
    expect(privacy).toMatch(/Etsy listing photo test/)
  })
})

/** Files under mobile/ that differ from main (committed or not), or null where main can't be found (CI's shallow clone). */
function mobileChanges(): string[] | null {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let base: string
  try {
    base = git('merge-base', 'HEAD', 'main')
  } catch {
    try {
      base = git('merge-base', 'HEAD', 'origin/main')
    } catch {
      return null
    }
  }
  const changed = git('diff', '--name-only', base, '--', 'mobile')
  const added = git('ls-files', '--others', '--exclude-standard', '--', 'mobile')
  return [changed, added].join('\n').split('\n').filter(Boolean)
}

describe('the native app', () => {
  const changes = mobileChanges()
  it.skipIf(changes === null)('is untouched: no file under mobile/ differs from main', () => {
    expect(changes).toEqual([])
  })
})
