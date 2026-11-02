// Vote from your newsletter (growth, 2026-11-02). A poll's creator gets two copyable blocks, one link per option:
// an email HTML block (a table with inline styles) and a Substack/Markdown block. Each link is
// /polls/<id>?pick=<letter>&src=newsletter. Opening it votes for nothing (inbox link scanners and prefetchers open
// links too): it lands on the poll page with that option picked and one "Confirm vote" button. The landing counts
// a visit with the poll's path and source "newsletter". The same flow in Chromium, at desktop size and 390 px:
// tests/newsletter-browser.test.ts.
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as pollRoute } from '@/app/polls/[id]/route'
import PrivacyPage from '@/app/privacy/page'
import { sendSignal, sourceFor } from '@/lib/beacon'
import { emailHtml, pickLink, pickedOption, postHtml, postMarkdown } from '@/lib/newsletter'
import { SIGNAL_URL, SITE_URL } from '@/lib/site'
import { ORIGIN, accountIdOf, createPoll, getPoll, useTestDb, vote, voter } from './helpers'

let cookie: string | undefined
let voterHeader: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookie && name === 'tb_voter' ? { name, value: cookie } : undefined),
  }),
  headers: async () => new Headers(voterHeader === undefined ? {} : { 'x-tiebreak-voter': voterHeader }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: PollPage } = await import('@/app/p/[id]/page')
const { countVisit } = await import('@/app/visit-beacon')

const db = useTestDb()

const CREATOR = voter(1)
const READER = voter(2)

/** Three book covers, as image links (the API takes any https image link; nothing is fetched here). */
const COVERS = ['https://images.example/covers/salt-road-teal.jpg', 'https://images.example/covers/salt-road-red.jpg', 'https://images.example/covers/salt-road-ink.jpg']
const coverPoll = {
  question: 'Which cover for The Salt Road?',
  options: [
    { text: 'Teal waves', imageUrl: COVERS[0] },
    { text: 'Red sun', imageUrl: COVERS[1] },
    { imageUrl: COVERS[2] },
  ],
  target: 50,
  durationHours: 72,
}

async function newCoverPoll(overrides: Record<string, unknown> = {}) {
  const { res, body } = await createPoll({ ...coverPoll, ...overrides }, CREATOR)
  expect(res.status).toBe(201)
  return body.id as string
}

/** Renders a poll page as a browser cookie (`tb_voter=…`), the native app's header (an id), or nobody. */
async function render(id: string, { as, header, search = {} }: { as?: string; header?: string; search?: Record<string, string> } = {}) {
  cookie = as === undefined ? undefined : accountIdOf(as)
  voterHeader = header
  const page = await PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) })
  return renderToString(page as ReactElement)
}

const unescapeHtml = (text: string) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** A textarea's text in rendered HTML, by its aria-label. */
function textarea(html: string, label: string): string {
  const match = html.match(new RegExp(`<textarea[^>]*aria-label="${label.replace(/[()]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</textarea>`))
  if (!match) throw new Error(`no textarea labelled ${label}`)
  return unescapeHtml(match[1])
}

/** Each <a> in an HTML block: its href (entities decoded) and what it wraps. */
function anchors(html: string) {
  return [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: unescapeHtml(m[1]), inner: m[2] }))
}

const PANEL = 'Get votes from your newsletter'
const EMAIL_LABEL = 'Email block (HTML)'
const POST_LABEL = 'Substack block (Markdown)'
const CONFIRM = /<button[^>]*>Confirm vote<\/button>/g
const linkFor = (id: string, letter: string) => `${SITE_URL}/polls/${id}?pick=${letter}&src=newsletter`

async function voteCount(id: string) {
  const { rows } = await db().query<{ n: number }>('SELECT count(*)::int AS n FROM votes WHERE poll_id = $1', [id])
  return rows[0].n
}

describe("the 'Get votes from your newsletter' panel", () => {
  it("shows to the poll's creator by their cookie, with two copy buttons", async () => {
    const id = await newCoverPoll()
    const html = await render(id, { as: CREATOR })
    expect(html).toContain(PANEL)
    expect(html).toMatch(/<button[^>]*>Copy email block \(HTML\)<\/button>/)
    expect(html).toMatch(/<button[^>]*>Copy Substack block \(Markdown\)<\/button>/)
  })

  it("shows to the creator by the native app's x-tiebreak-voter header too", async () => {
    const id = await newCoverPoll()
    expect(await render(id, { header: accountIdOf(CREATOR) })).toContain(PANEL)
  })

  it('shows to nobody else: another voter, a header of another account, or no account at all', async () => {
    const id = await newCoverPoll()
    expect(await render(id, { as: READER })).not.toContain(PANEL)
    expect(await render(id, { header: accountIdOf(READER) })).not.toContain(PANEL)
    expect(await render(id)).not.toContain(PANEL)
    expect(await render(id, { as: READER, search: { pick: 'A', src: 'newsletter' } })).not.toContain(PANEL)
  })

  it('is gone once the poll has closed (there are no votes left to get)', async () => {
    const id = await newCoverPoll({ target: 1 })
    await vote(id, 0, READER)
    const html = await render(id, { as: CREATOR })
    expect(html).toContain('Winner: ')
    expect(html).not.toContain(PANEL)
  })

  it("the email block is a <table> with inline styles, no <script> or <style>, and one absolute <a href> per option wrapping that option's image", async () => {
    const id = await newCoverPoll()
    const block = textarea(await render(id, { as: CREATOR }), EMAIL_LABEL)
    expect(block.trim()).toMatch(/^<table[\s>]/)
    expect(block.trim()).toMatch(/<\/table>$/)
    expect(block).toMatch(/<table[^>]* style="[^"]+"/)
    expect(block).not.toMatch(/<script/i)
    expect(block).not.toMatch(/<style/i)
    expect(block).not.toMatch(/ class="/)

    const links = anchors(block)
    expect(links.map((a) => a.href)).toEqual(['A', 'B', 'C'].map((l) => linkFor(id, l)))
    links.forEach((a, i) => expect(a.inner).toMatch(new RegExp(`<img [^>]*src="${COVERS[i].replace(/[.]/g, '\\.')}"`)))
    for (const [, url] of block.matchAll(/(?:href|src)="([^"]*)"/g)) {
      expect(new URL(unescapeHtml(url)).protocol).toBe('https:') // absolute: parses with no base
    }
    expect(block).toBe(emailHtml({ id, question: coverPoll.question, options: (await getPoll(id)).body.poll.options }, SITE_URL))
  })

  it("an option without a photo is linked by its text", async () => {
    const id = await newCoverPoll({ options: ['Keep the title', { text: 'Shorter title', imageUrl: COVERS[1] }, 'Subtitle too'] })
    const links = anchors(textarea(await render(id, { as: CREATOR }), EMAIL_LABEL))
    expect(links).toHaveLength(3)
    expect(links[0].inner).toContain('Keep the title')
    expect(links[0].inner).not.toContain('<img')
    expect(links[1].inner).toContain(`src="${COVERS[1]}"`)
    expect(links[2].inner).toContain('Subtitle too')
  })

  it('the Markdown block has one image line and one link line per option, all absolute', async () => {
    const id = await newCoverPoll()
    const block = textarea(await render(id, { as: CREATOR }), POST_LABEL)
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    const images = lines.filter((line) => line.startsWith('!['))
    const links = lines.filter((line) => line.startsWith('['))
    expect(images).toHaveLength(3)
    expect(links).toHaveLength(3)
    images.forEach((line, i) => expect(line).toMatch(new RegExp(`^!\\[[^\\]]*\\]\\(${COVERS[i].replace(/[.]/g, '\\.')}\\)$`)))
    links.forEach((line, i) => {
      const href = line.match(/^\[[^\]]*\]\(([^)]+)\)$/)?.[1]
      expect(href).toBe(linkFor(id, 'ABC'[i]))
    })
    // Each option's image line comes right before its link line.
    for (let i = 0; i < 3; i++) expect(lines.indexOf(links[i])).toBe(lines.indexOf(images[i]) + 1)
    expect(block).toBe(postMarkdown({ id, question: coverPoll.question, options: (await getPoll(id)).body.poll.options }, SITE_URL))
  })

  it("the Substack block's rich version (what Substack's editor takes on paste) has the same image and link per option, and no table", () => {
    const poll = { id: 'AAAAAAAAAAAA', question: 'Which cover?', options: coverPoll.options.map((o) => ({ text: o.text ?? null, imageUrl: o.imageUrl })) }
    const html = postHtml(poll, SITE_URL)
    expect(html).not.toMatch(/<table|<script|<style/i)
    expect(anchors(html).map((a) => a.href)).toEqual(['A', 'B', 'C'].map((l) => linkFor('AAAAAAAAAAAA', l)))
    expect([...html.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1])).toEqual(COVERS)
  })

  it("escapes the creator's text in both blocks, so it reads as written and can't add markup", () => {
    const poll = {
      id: 'AAAAAAAAAAAA',
      question: `Tom & Jerry's "best" <b>cover</b>?`,
      options: [
        { text: '<img src=x onerror=alert(1)>', imageUrl: null },
        { text: 'Red [sun] *bold*', imageUrl: 'https://images.example/a (1).jpg' },
      ],
    }
    const html = emailHtml(poll, SITE_URL)
    expect(html).toContain('Tom &amp; Jerry&#39;s &quot;best&quot; &lt;b&gt;cover&lt;/b&gt;?')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(anchors(html)).toHaveLength(2)
    const md = postMarkdown(poll, SITE_URL)
    expect(md).toContain('Red \\[sun\\] \\*bold\\*')
    expect(md).toContain('(https://images.example/a%20%281%29.jpg)')
    expect(md).toContain('\\<img src=x onerror=alert(1)\\>') // a backslash keeps Markdown from reading it as HTML
    expect(postHtml(poll, SITE_URL)).not.toContain('<img src=x')
  })
})

describe('the option links', () => {
  it('have the form /polls/<id>?pick=<A|B|C|D>&src=newsletter', () => {
    for (const [i, letter] of [...'ABCD'].entries()) {
      expect(pickLink('https://tiebreak.example', 'AbCdEfGhIjKl', i)).toBe(`https://tiebreak.example/polls/AbCdEfGhIjKl?pick=${letter}&src=newsletter`)
    }
  })

  it('a GET records no vote (link scanners and prefetchers open links): it redirects to the poll page with the pick', async () => {
    const id = await newCoverPoll()
    const link = pickLink(ORIGIN, id, 1)
    for (const as of [undefined, READER, CREATOR]) {
      const headers: Record<string, string> = as ? { cookie: as } : {}
      const res = await pollRoute(new Request(link, { headers }), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(`/p/${id}?pick=B&src=newsletter`)
      expect(res.headers.get('set-cookie')).toBeNull()
    }
    expect(await voteCount(id)).toBe(0)
    expect((await getPoll(id)).body.poll.voteCount).toBe(0)
  })

  it('the page opens with that option picked and one Confirm vote button, and still no vote; confirming records exactly one', async () => {
    const id = await newCoverPoll()
    const html = await render(id, { as: READER, search: { pick: 'B', src: 'newsletter' } })
    expect(html.match(CONFIRM)).toHaveLength(1)
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0])
    expect(radios).toHaveLength(3)
    expect(radios.map((r) => / checked=""/.test(r))).toEqual([false, true, false])
    expect(html).not.toMatch(/<button[^>]*class="face-button"/) // not the one-tap picker
    expect(await voteCount(id)).toBe(0)

    const confirmed = await vote(id, 1, READER) // what "Confirm vote" sends
    expect(confirmed.res.status).toBe(201)
    expect(confirmed.body.poll.myVote).toBe(1)
    expect(await voteCount(id)).toBe(1)
    const after = await render(id, { as: READER, search: { pick: 'B', src: 'newsletter' } })
    expect(after).toContain('You picked')
    expect(after).not.toMatch(CONFIRM)
  })

  it('a second confirm by the same voter is a 409 and the count stays the same', async () => {
    const id = await newCoverPoll()
    expect((await vote(id, 1, READER)).res.status).toBe(201)
    const again = await vote(id, 2, READER) // a second tab, or another option's link
    expect(again.res.status).toBe(409)
    expect(await voteCount(id)).toBe(1)
    expect((await getPoll(id, READER)).body.poll.myVote).toBe(1)
  })

  it('a ?pick= link to a closed poll shows the result, not a vote button', async () => {
    const id = await newCoverPoll({ target: 1 })
    await vote(id, 2, voter(3))
    const html = await render(id, { as: READER, search: { pick: 'A', src: 'newsletter' } })
    expect(html).toContain('Winner: C')
    expect(html).not.toMatch(CONFIRM)
    expect(html).not.toContain('type="radio"')
  })

  it("a letter the poll doesn't have opens the usual picker, with no option picked", async () => {
    const id = await newCoverPoll()
    for (const pick of ['D', 'Z', 'AB', '']) {
      const html = await render(id, { as: READER, search: { pick, src: 'newsletter' } })
      expect(html).not.toMatch(CONFIRM)
      expect(html).toMatch(/<button[^>]*class="face-button"/)
    }
  })

  it('reads the pick letter in either case, and nothing else', () => {
    expect(pickedOption('A', 2)).toBe(0)
    expect(pickedOption('b', 3)).toBe(1)
    expect(pickedOption('D', 4)).toBe(3)
    expect(pickedOption('C', 2)).toBeNull()
    expect(pickedOption('E', 4)).toBeNull()
    expect(pickedOption('', 4)).toBeNull()
    expect(pickedOption(undefined, 4)).toBeNull()
    expect(pickedOption(['A', 'B'], 4)).toBeNull()
  })

  it("leaves the native app's GET /polls/:id as it was: JSON, by header, no redirect", async () => {
    const id = await newCoverPoll()
    const res = await pollRoute(new Request(`${ORIGIN}/polls/${id}`, { headers: { 'x-tiebreak-voter': accountIdOf(CREATOR) } }), {
      params: Promise.resolve({ id }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).poll).toMatchObject({ id, mine: true, voteCount: 0 })
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('a newsletter landing: the visit beacon', () => {
  const SITE = 'https://tiebreak-phi.vercel.app'
  const POLL = '/p/AbCdEfGhIjKl'
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  let here: { origin: string; pathname: string; search: string }
  let doc: { referrer: string }

  beforeEach(() => {
    fetchMock.mockClear()
    here = { origin: SITE, pathname: '/', search: '' }
    doc = { referrer: '' }
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('location', here)
    vi.stubGlobal('document', doc)
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

  /** A full page load of `pathname` + `search`, coming from `referrer` (the layout's beacon). */
  function land(pathname: string, search: string, referrer = '') {
    here.pathname = pathname
    here.search = search
    doc.referrer = referrer
    countVisit(pathname, search)
  }

  it("sends a visit with the poll's path and source 'newsletter'", () => {
    land(POLL, '?pick=B&src=newsletter', 'https://mail.google.com/')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://mail.google.com/', path: POLL, source: 'newsletter' }])
  })

  it('counts apart from a shared-link visit to the same poll earlier in the session, and stands in for later plain ones', () => {
    land(POLL, '') // the shared link
    land(POLL, '?pick=A&src=newsletter')
    land(POLL, '?pick=C&src=newsletter') // another option's link of the same poll
    land('/', '')
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'visit', referrer: null },
      { slug: 'tiebreak', kind: 'visit', referrer: null, path: POLL, source: 'newsletter' },
    ])
  })

  it("counts each poll's newsletter once per session", () => {
    land(POLL, '?pick=A&src=newsletter')
    land('/p/ZZZZZZZZZZZZ', '?pick=B&src=newsletter')
    expect(sent().map((s) => s.path)).toEqual([POLL, '/p/ZZZZZZZZZZZZ'])
  })

  it('passes on no other source, and no source from pages other than a poll', () => {
    expect(sourceFor('?src=newsletter')).toBe('newsletter')
    expect(sourceFor('?pick=A&src=Newsletter')).toBe('newsletter')
    expect(sourceFor('?src=jane%40example.com')).toBeNull()
    expect(sourceFor('?src=')).toBeNull()
    expect(sourceFor('')).toBeNull()
    land(POLL, '?src=jane%40example.com')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null }])
    fetchMock.mockClear()
    vi.stubGlobal('sessionStorage', memoryStorage())
    land('/pro', '?src=newsletter')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: null }])
  })

  it('sends nothing off production or from automated browsers', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    land(POLL, '?pick=A&src=newsletter')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('navigator', { webdriver: true })
    land(POLL, '?pick=A&src=newsletter')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves activate and checkout as they were on a newsletter landing', () => {
    here.pathname = POLL
    here.search = '?pick=A&src=newsletter'
    sendSignal('activate')
    sendSignal('checkout')
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'activate', referrer: null },
      { slug: 'tiebreak', kind: 'checkout', referrer: null },
    ])
  })
})

describe('the privacy page', () => {
  it("says a visit from a poll's newsletter link names that poll's page and the newsletter", () => {
    const html = renderToString(PrivacyPage())
    expect(html).toContain('newsletter')
  })
})
