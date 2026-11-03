// Vote from your newsletter (growth, 2026-11-03). A poll's creator gets a "Get votes from your
// newsletter" panel with two blocks to paste: email HTML (a table, inline styles only) and
// Markdown, each with one link per option, /polls/<id>?pick=<letter>&src=newsletter. Opening a
// link records nothing (it's a 303 to the poll page with that option preselected), so email link
// scanners and prefetchers can't vote; the vote counts when the reader taps "Confirm vote".
// Landing there sends a visit with the poll page's path and source "newsletter".
// The same flow in Chromium, at desktop size and 390 px: tests/newsletter-browser.test.ts.
import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PrivacyPage from '@/app/privacy/page'
import { GET as getPollRoute } from '@/app/polls/[id]/route'
import { sendSignal } from '@/lib/beacon'
import {
  NEWSLETTER_SOURCE,
  landingPage,
  newsletterBlocks,
  optionLink,
  pickedOption,
  visitSource,
} from '@/lib/newsletter'
import { SIGNAL_URL, SITE_URL } from '@/lib/site'
import { HOUR, ORIGIN, accountIdOf, basicPoll, createPoll, getPoll, uploadImage, useTestDb, vote, voter } from './helpers'
import { png } from './image-bytes'

let cookie: string | undefined
let requestHeaders: Record<string, string> = {}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookie && name === 'tb_voter' ? { name, value: cookie } : undefined),
  }),
  headers: async () => new Headers(requestHeaders),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: PollPage } = await import('@/app/p/[id]/page')
const { countVisit } = await import('@/app/visit-beacon')

useTestDb()

/** The site the rendered pages are asked for (the Host header), so the blocks' links are on it. */
const SITE = 'https://tiebreak.test'

/**
 * Renders a poll page. `as` is a `tb_voter=…` cookie string, `header` an account id sent the
 * way the native app sends it (x-tiebreak-voter), `query` the page address's query.
 */
async function render(id: string, { as, header, query = {} }: { as?: string; header?: string; query?: Record<string, string> } = {}) {
  cookie = as ? accountIdOf(as) : undefined
  requestHeaders = { host: 'tiebreak.test', 'x-forwarded-proto': 'https', ...(header ? { 'x-tiebreak-voter': header } : {}) }
  return renderToString((await PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) })) as ReactElement)
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** The text of the rendered page's read-only <textarea> with this label (the block a copy button copies). */
function textarea(html: string, label: string): string {
  const match = html.match(new RegExp(`<textarea[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</textarea>`))
  if (!match) throw new Error(`no textarea labelled ${label}`)
  return unescape(match[1])
}

/** Every <a …>…</a> in an HTML block: its href (entities decoded) and what it wraps. */
function anchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: unescape(attrs.match(/href="([^"]*)"/)?.[1] ?? ''),
    inner,
  }))
}

/**
 * What's left of an HTML block once its allowed tags (each with only allowed, quoted attributes) are removed:
 * anything but plain text means the poll's own words became markup.
 */
function leftoverMarkup(html: string): string[] {
  const tag = /<\/?(table|tr|td|a|img|span|p|strong)((?:\s+(?:role|width|cellpadding|cellspacing|border|style|colspan|href|src|alt)="[^"<>]*")*)\s*>/g
  const text = html.replace(tag, '')
  return text.match(/[<>"]/g) ?? []
}

const attrValues = (html: string, name: string) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => unescape(m[1]))

const voteCount = async (id: string) => (await getPoll(id)).body.poll.voteCount as number

const PANEL = 'Get votes from your newsletter'
const CONFIRM = />Confirm vote</g

/** A three-option poll as an author would post it: two cover images and a text option. */
const coverPoll = {
  question: 'Which cover for my novel?',
  options: [
    { text: 'Salt house', imageUrl: 'https://images.example/covers/salt-house.jpg' },
    { text: 'Night ferry', imageUrl: 'https://images.example/covers/night-ferry.jpg' },
    'Keep the old one',
  ],
  target: 50,
  durationHours: 72,
}

const LETTER_LINK = /^https:\/\/tiebreak\.test\/polls\/[A-Za-z0-9_-]{12}\?pick=[ABCD]&src=newsletter$/

describe('the "Get votes from your newsletter" panel', () => {
  it("is on the poll page for the poll's creator (by cookie), with two copy buttons", async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const html = await render(body.id, { as: voter(1) })
    expect(html).toContain(PANEL)
    expect(html).toContain('>Copy email HTML</button>')
    expect(html).toContain('>Copy Markdown</button>')
  })

  it('is there for the creator identified by the native app’s x-tiebreak-voter header', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    expect(await render(body.id, { header: accountIdOf(voter(1)) })).toContain(PANEL)
  })

  it('is never shown to anyone else: another account, by cookie or header, or a visitor with no account', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    expect(await render(body.id, { as: voter(2) })).not.toContain(PANEL)
    expect(await render(body.id, { header: accountIdOf(voter(2)) })).not.toContain(PANEL)
    expect(await render(body.id)).not.toContain(PANEL)
    // The app's header wins over a cookie, as in the API: someone else's header shows nothing.
    expect(await render(body.id, { as: voter(1), header: accountIdOf(voter(2)) })).not.toContain(PANEL)
  })

  it('goes once the poll has closed: its links would only show the result', async () => {
    const { body } = await createPoll({ ...coverPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))
    const html = await render(body.id, { as: voter(1) })
    expect(html).toContain('Winner: ')
    expect(html).not.toContain(PANEL)
  })

  it('carries an HTML block: one <table> with inline styles, no <script> or <style>, one absolute <a href> per option around its image or text', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const block = textarea(await render(body.id, { as: voter(1) }), 'Email HTML')

    expect(block.startsWith('<table')).toBe(true)
    expect(block.trimEnd().endsWith('</table>')).toBe(true)
    expect(block.match(/<table\b/g)).toHaveLength(1)
    expect(block).toMatch(/<table[^>]*style="[^"]+"/)
    expect(block).not.toMatch(/<script/i)
    expect(block).not.toMatch(/<style/i)
    expect(block).not.toMatch(/\sclass=/) // inline styles only: email clients drop stylesheets
    expect(block).not.toMatch(/\son[a-z]+=/i)
    expect(leftoverMarkup(block)).toEqual([]) // only table, tr, td, a, img and span, with plain attributes

    const links = anchors(block)
    expect(links).toHaveLength(3)
    expect(block.match(/<a\b/g)).toHaveLength(3) // and no other link
    expect(links.map((a) => a.href)).toEqual(['A', 'B', 'C'].map((l) => `${SITE}/polls/${body.id}?pick=${l}&src=newsletter`))
    for (const { href } of links) expect(href).toMatch(LETTER_LINK)
    // A and B wrap their cover image; C, a text option, wraps its text.
    expect(links[0].inner).toMatch(/<img [^>]*src="https:\/\/images\.example\/covers\/salt-house\.jpg"/)
    expect(links[1].inner).toMatch(/<img [^>]*src="https:\/\/images\.example\/covers\/night-ferry\.jpg"/)
    expect(links[2].inner).not.toContain('<img')
    expect(links[2].inner).toContain('Keep the old one')
    expect(block).toContain('Which cover for my novel?')
    // Every address in it is absolute.
    for (const url of [...attrValues(block, 'href'), ...attrValues(block, 'src')]) expect(url).toMatch(/^https:\/\//)
  })

  it('carries a Markdown block: an image line and a link line per option, in order, for Substack and similar editors', async () => {
    const photos = {
      ...coverPoll,
      options: [...coverPoll.options.slice(0, 2), { text: 'Lighthouse', imageUrl: 'https://images.example/covers/lighthouse.png' }],
    }
    const { body } = await createPoll(photos, voter(1))
    const markdown = textarea(await render(body.id, { as: voter(1) }), 'Markdown')
    const lines = markdown.split('\n').filter((line) => line.trim() !== '')

    const imageLine = /^\[!\[([^\]]+)\]\((https:\/\/[^)\s]+)\)\]\((https:\/\/[^)\s]+)\)$/
    const linkLine = /^\[(Vote [^\]]+)\]\((https:\/\/[^)\s]+)\)$/
    expect(lines.filter((l) => imageLine.test(l))).toHaveLength(3)
    expect(lines.filter((l) => linkLine.test(l))).toHaveLength(3)
    expect(lines.some((l) => /<[a-z]/i.test(l))).toBe(false) // Markdown, not HTML

    const images = ['salt-house.jpg', 'night-ferry.jpg', 'lighthouse.png']
    const names = ['Salt house', 'Night ferry', 'Lighthouse']
    ;['A', 'B', 'C'].forEach((letter, i) => {
      const at = lines.findIndex((l) => imageLine.test(l) && l.includes(`pick=${letter}&`))
      const [, alt, src, imageHref] = lines[at].match(imageLine)!
      const [, text, href] = lines[at + 1].match(linkLine)! // the link line follows its image line
      const link = `${SITE}/polls/${body.id}?pick=${letter}&src=newsletter`
      expect(alt).toBe(`${letter} · ${names[i]}`)
      expect(src).toBe(`https://images.example/covers/${images[i]}`)
      expect(imageHref).toBe(link)
      expect(href).toBe(link)
      expect(text).toBe(`Vote ${letter} · ${names[i]}`)
    })
  })

  it('a text option gets only its link line in Markdown (it has no image)', () => {
    const blocks = newsletterBlocks({ id: 'AAAAAAAAAAAA', question: 'Tea or coffee?', options: [{ text: 'Tea', imageUrl: null }, { text: 'Coffee', imageUrl: null }] }, SITE)
    expect(blocks.markdown).not.toContain('![')
    expect(blocks.markdown).toContain(`[Vote A · Tea](${SITE}/polls/AAAAAAAAAAAA?pick=A&src=newsletter)`)
    expect(blocks.markdown).toContain(`[Vote B · Coffee](${SITE}/polls/AAAAAAAAAAAA?pick=B&src=newsletter)`)
  })

  it('pastes into rich editors too: the Markdown copy carries its own HTML, the same images and links, still with no script or style', () => {
    const blocks = newsletterBlocks(
      { id: 'AAAAAAAAAAAA', question: 'Which cover?', options: [{ text: 'Salt house', imageUrl: 'https://images.example/a.jpg' }, { text: null, imageUrl: 'https://images.example/b.jpg' }] },
      SITE,
    )
    expect(blocks.markdownHtml).not.toMatch(/<script|<style|<table/i)
    const links = anchors(blocks.markdownHtml)
    expect(links.map((a) => a.href)).toEqual([0, 0, 1, 1].map((i) => optionLink(SITE, 'AAAAAAAAAAAA', i)))
    expect(links[0].inner).toMatch(/<img [^>]*src="https:\/\/images\.example\/a\.jpg"/)
    expect(links[1].inner).toBe('Vote A · Salt house')
    expect(links[3].inner).toBe('Vote B')
  })

  it("escapes the poll's own text, so a question or option can't add markup to either block", () => {
    const blocks = newsletterBlocks(
      {
        id: 'AAAAAAAAAAAA',
        question: 'Pick one <script>alert(1)</script> "now"',
        options: [
          { text: '<img src=x onerror=alert(1)>', imageUrl: 'https://images.example/a.jpg?x="><script>' },
          { text: 'Brackets ](javascript:alert(1)) *bold*', imageUrl: 'https://images.example/b (1).jpg' },
        ],
      },
      SITE,
    )
    for (const html of [blocks.emailHtml, blocks.markdownHtml]) {
      expect(leftoverMarkup(html)).toEqual([])
      expect(html).toContain('&lt;script&gt;')
      expect(anchors(html).every((a) => a.href.startsWith(`${SITE}/polls/AAAAAAAAAAAA?pick=`))).toBe(true)
    }
    expect(anchors(blocks.emailHtml)).toHaveLength(2)
    // In Markdown, brackets and emphasis in text are escaped, and a URL can't end its own link early.
    expect(blocks.markdown).toContain('Brackets \\](javascript:alert(1)) \\*bold\\*')
    expect(blocks.markdown).toContain('https://images.example/b%20%281%29.jpg')
    expect(blocks.markdown).not.toMatch(/(?<!\\)\]\(javascript:/)
  })

  it('lays four options out two by two, and two or three side by side', () => {
    const poll = (n: number) => ({
      id: 'AAAAAAAAAAAA',
      question: '',
      options: Array.from({ length: n }, (_, i) => ({ text: `Option ${i + 1}`, imageUrl: null })),
    })
    const optionRows = (html: string) => (html.match(/<tr>/g) ?? []).length - 2 // minus the question and the note
    expect(optionRows(newsletterBlocks(poll(2), SITE).emailHtml)).toBe(1)
    expect(optionRows(newsletterBlocks(poll(3), SITE).emailHtml)).toBe(1)
    expect(optionRows(newsletterBlocks(poll(4), SITE).emailHtml)).toBe(2)
    expect(anchors(newsletterBlocks(poll(4), SITE).emailHtml).map((a) => a.href.split('pick=')[1])).toEqual([
      'A&src=newsletter',
      'B&src=newsletter',
      'C&src=newsletter',
      'D&src=newsletter',
    ])
  })

  it('uses uploaded photos at their absolute tiebreak address', async () => {
    const { body: upload } = await uploadImage(png(), 'image/png', voter(1))
    const { body } = await createPoll({ ...coverPoll, options: [{ text: 'Photo', imageUrl: upload.url }, 'Text'] }, voter(1))
    const block = textarea(await render(body.id, { as: voter(1) }), 'Email HTML')
    expect(attrValues(block, 'src')).toEqual([upload.url])
    expect(upload.url.startsWith(`${ORIGIN}/images/`)).toBe(true)
  })

  it("falls back to the site's address when the request names no host", async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    cookie = accountIdOf(voter(1))
    requestHeaders = {}
    const html = renderToString((await PollPage({ params: Promise.resolve({ id: body.id }), searchParams: Promise.resolve({}) })) as ReactElement)
    expect(anchors(textarea(html, 'Email HTML'))[0].href).toBe(`${SITE_URL}/polls/${body.id}?pick=A&src=newsletter`)
  })
})

describe('a newsletter link: /polls/<id>?pick=<letter>&src=newsletter', () => {
  const linkGet = (id: string, query: string, headers: Record<string, string> = {}) =>
    getPollRoute(new Request(`${ORIGIN}/polls/${id}${query}`, { headers }), { params: Promise.resolve({ id }) })

  it('has that form for each option letter', () => {
    expect([0, 1, 2, 3].map((i) => optionLink(SITE, 'AbCdEfGh_-12', i))).toEqual([
      `${SITE}/polls/AbCdEfGh_-12?pick=A&src=${NEWSLETTER_SOURCE}`,
      `${SITE}/polls/AbCdEfGh_-12?pick=B&src=newsletter`,
      `${SITE}/polls/AbCdEfGh_-12?pick=C&src=newsletter`,
      `${SITE}/polls/AbCdEfGh_-12?pick=D&src=newsletter`,
    ])
  })

  it('a GET records no vote: it sends the reader to the poll page with that option picked, and mints no account', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const res = await linkGet(body.id, '?pick=B&src=newsletter')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/p/${body.id}?pick=B&src=newsletter`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(await voteCount(body.id)).toBe(0)
  })

  it('a link scanner or prefetcher that GETs every link, again and again, still records nothing', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    await vote(body.id, 2, voter(3))
    for (const letter of ['A', 'B', 'C', 'A', 'B', 'C']) {
      await linkGet(body.id, `?pick=${letter}&src=newsletter`, { cookie: voter(2) })
      await render(body.id, { as: voter(2), query: { pick: letter, src: 'newsletter' } })
    }
    expect(await voteCount(body.id)).toBe(1)
    expect((await getPoll(body.id, voter(2))).body.poll.myVote).toBeNull()
  })

  it('leaves GET /polls/:id without a query as it was: the poll as JSON, which the native app reads', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const res = await linkGet(body.id, '', { 'x-tiebreak-voter': accountIdOf(voter(1)) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.poll.id).toBe(body.id)
    expect(json.poll.mine).toBe(true)
    // The app asks for exactly /polls/<id>, so a newsletter link's redirect never reaches it.
    const api = readFileSync(new URL('../mobile/src/lib/api.ts', import.meta.url), 'utf8')
    expect(api).toContain("request<{ poll: Poll }>('GET', `/polls/${encodeURIComponent(id)}`)")
  })

  it('keeps only pick and src on the way to the page', () => {
    expect(landingPage('AAAAAAAAAAAA', new URLSearchParams('pick=C&src=newsletter&utm_source=x'))).toBe('/p/AAAAAAAAAAAA?pick=C&src=newsletter')
    expect(landingPage('AAAAAAAAAAAA', new URLSearchParams('src=newsletter'))).toBe('/p/AAAAAAAAAAAA?src=newsletter')
    expect(landingPage('AAAAAAAAAAAA', new URLSearchParams(''))).toBeNull()
    expect(landingPage('AAAAAAAAAAAA', new URLSearchParams('utm_source=x'))).toBeNull()
  })

  it('opens the page with that option preselected and one Confirm vote button, in place of the swipe card', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const html = await render(body.id, { as: voter(2), query: { pick: 'B', src: 'newsletter' } })
    expect(html.match(CONFIRM)).toHaveLength(1)
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []
    expect(radios).toHaveLength(3)
    expect(radios.map((r) => r.includes('checked=""'))).toEqual([false, true, false])
    expect(radios[1]).toContain('aria-label="B · Night ferry"')
    expect(html).not.toMatch(/>Pick (<!-- -->)?A</)
    expect(await voteCount(body.id)).toBe(0)
  })

  it('works on a two-option poll too, and for a visitor with no account yet', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    const html = await render(body.id, { query: { pick: 'A', src: 'newsletter' } })
    expect(html.match(CONFIRM)).toHaveLength(1)
    expect((html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).map((r) => r.includes('checked=""'))).toEqual([true, false])
    expect(html).not.toContain('swipe-card')
  })

  it('reads the letter in either case, and ignores one the poll has no option for', async () => {
    expect(pickedOption('b', 3)).toBe(1)
    expect(pickedOption('C', 3)).toBe(2)
    expect(pickedOption('D', 3)).toBeNull()
    expect(pickedOption('E', 4)).toBeNull()
    expect(pickedOption('AB', 3)).toBeNull()
    expect(pickedOption(['A', 'B'], 3)).toBeNull()
    expect(pickedOption(undefined, 3)).toBeNull()
    const { body } = await createPoll(coverPoll, voter(1))
    const html = await render(body.id, { as: voter(2), query: { pick: 'D', src: 'newsletter' } })
    expect(html).not.toMatch(CONFIRM) // no such option: the usual picker
    expect(html).toContain('face-button')
  })

  it('shows a reader who already voted what they picked, not a second Confirm vote', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    await vote(body.id, 0, voter(2))
    const html = await render(body.id, { as: voter(2), query: { pick: 'B', src: 'newsletter' } })
    expect(html).toContain('You picked')
    expect(html).not.toMatch(CONFIRM)
  })

  it('confirming is the usual vote: exactly one; a second confirm by the same voter is a 409 and the count stays', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const first = await vote(body.id, 1, voter(2))
    expect(first.res.status).toBe(201)
    expect(first.body.poll.voteCount).toBe(1)
    expect(first.body.poll.myVote).toBe(1)
    const second = await vote(body.id, 1, voter(2))
    expect(second.res.status).toBe(409)
    expect(await voteCount(body.id)).toBe(1)
    const other = await vote(body.id, 0, voter(2)) // changing their mind doesn't count either
    expect(other.res.status).toBe(409)
    expect(await voteCount(body.id)).toBe(1)
  })

  it('on a closed poll, shows the result page, not a vote button', async () => {
    const { body } = await createPoll({ ...coverPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(3))
    for (const as of [voter(2), undefined]) {
      const html = await render(body.id, { as, query: { pick: 'B', src: 'newsletter' } })
      expect(html).toContain('Winner: ')
      expect(html).not.toMatch(CONFIRM)
      expect(html).not.toContain('type="radio"')
    }
    // The link itself still only redirects, to that result.
    expect((await linkGet(body.id, '?pick=B&src=newsletter')).status).toBe(303)
    expect(await voteCount(body.id)).toBe(1)
  })

  it('on a poll past its deadline with no votes, shows that it closed, not a vote button', async () => {
    const { body } = await createPoll({ ...coverPoll, durationHours: 1 }, voter(1))
    vi.useFakeTimers({ now: Date.now() + 2 * HOUR, toFake: ['Date'] })
    try {
      const html = await render(body.id, { as: voter(2), query: { pick: 'A', src: 'newsletter' } })
      expect(html).toContain('No votes came in')
      expect(html).not.toMatch(CONFIRM)
    } finally {
      vi.useRealTimers()
    }
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('the visit beacon on a newsletter landing', () => {
  const POLL = '/p/AbCdEfGh_-12'
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  let here: { origin: string; pathname: string; search: string }

  beforeEach(() => {
    fetchMock.mockClear()
    here = { origin: SITE, pathname: '/', search: '' }
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('location', here)
    vi.stubGlobal('document', { referrer: '' })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const sent = () =>
    fetchMock.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit]
      expect(url).toBe(SIGNAL_URL)
      return JSON.parse(init.body as string)
    })

  /** A full page load, as the layout's beacon sees it. */
  function land(pathname: string, search = '') {
    here.pathname = pathname
    here.search = search
    countVisit(pathname, search)
  }

  it("sends the visit with the poll page's path and source newsletter", () => {
    land(POLL, '?pick=B&src=newsletter')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null, path: POLL, source: 'newsletter' }])
  })

  it('counts it once per session for each poll, even after a plain visit, and it stands in for the plain one', () => {
    land('/') // the session's plain visit
    land(POLL, '?pick=B&src=newsletter')
    land(POLL, '?pick=A&src=newsletter') // the same reader taps another option of the same poll
    land('/p/ZZZZZZZZZZZZ', '?pick=A&src=newsletter') // another poll in the same email
    land('/feed')
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'visit', referrer: null },
      { slug: 'tiebreak', kind: 'visit', referrer: null, path: POLL, source: 'newsletter' },
      { slug: 'tiebreak', kind: 'visit', referrer: null, path: '/p/ZZZZZZZZZZZZ', source: 'newsletter' },
    ])
  })

  it('a newsletter landing is the session’s visit: no plain visit follows it', () => {
    land(POLL, '?pick=B&src=newsletter')
    land(POLL)
    land('/')
    expect(sent()).toHaveLength(1)
  })

  it("leaves visits without it as they were: a poll page's own link, other pages, other src values", () => {
    land(POLL, '?src=elsewhere')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null }])
    expect(visitSource(POLL, '')).toBeNull()
    expect(visitSource(POLL, '?pick=B')).toBeNull()
    expect(visitSource(POLL, '?src=Newsletter')).toBeNull()
    expect(visitSource('/', '?src=newsletter')).toBeNull()
    expect(visitSource('/p/AAAAAAAAAAAA/card', '?src=newsletter')).toBeNull()
    expect(visitSource('/p/too-short', '?src=newsletter')).toBeNull()
    expect(visitSource(POLL, '?pick=B&src=newsletter')).toBe('newsletter')
  })

  it('keeps tool visits, activate and checkout as they were', () => {
    here.search = '?src=newsletter'
    sendSignal('activate')
    sendSignal('checkout')
    sendSignal('visit', '/tools/etsy-thumbnail-preview')
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'activate', referrer: null },
      { slug: 'tiebreak', kind: 'checkout', referrer: null },
      { slug: 'tiebreak', kind: 'visit', referrer: null, path: '/tools/etsy-thumbnail-preview' },
    ])
  })

  it('sends nothing off production or from automated browsers', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    land(POLL, '?pick=B&src=newsletter')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('navigator', { webdriver: true })
    land(POLL, '?pick=B&src=newsletter')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the privacy page says a newsletter link’s visit names its poll page and the source', () => {
    const html = renderToString(PrivacyPage())
    expect(html).toContain('src=newsletter')
    expect(html).toMatch(/newsletter/)
  })
})
