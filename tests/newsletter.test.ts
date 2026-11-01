// Vote from your newsletter (growth, 2026-11-01). A poll's creator gets a "Get votes from your newsletter" panel
// with two copyable blocks: an email-safe HTML table and Markdown for Substack and similar editors. Each option links
// to /polls/<id>?pick=<letter>&src=newsletter. Opening that link never votes (email link scanners and prefetchers
// open links too): it lands on the poll page with the option preselected and one "Confirm vote" button, and a visit
// from it is counted as a newsletter visit. The clicks in Chromium: tests/newsletter-browser.test.ts.
import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PrivacyPage from '@/app/privacy/page'
import { GET as pollRoute } from '@/app/polls/[id]/route'
import { countVisit } from '@/app/visit-beacon'
import { sendSignal, sourceFor } from '@/lib/beacon'
import { newsletterHtml, newsletterMarkdown, voteLink } from '@/lib/newsletter'
import { SIGNAL_URL, SITE_URL } from '@/lib/site'
import { HOUR, ORIGIN, accountIdOf, basicPoll, createPoll, getPoll, useTestDb, vote, voter } from './helpers'

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

const pg = useTestDb()

/** Renders a poll page as a browser (cookie) or the native app (header) would ask for it, with a query. */
async function render(id: string, as: { cookie?: string; header?: string; query?: Record<string, string> } = {}) {
  cookie = as.cookie?.split('=')[1]
  voterHeader = as.header
  const page = await PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(as.query ?? {}) })
  return renderToString(page as ReactElement)
}

const votesInDb = async () => (await pg().query<{ n: number }>('SELECT count(*)::int AS n FROM votes')).rows[0].n
const voteCount = async (id: string) => (await getPoll(id)).body.poll.voteCount as number

/** The vote link a block carries, as GET /polls/:id receives it. */
const openLink = (path: string) => pollRoute(new Request(ORIGIN + path), { params: Promise.resolve({ id: path.split('/')[2].split('?')[0] }) })

const decode = (html: string) =>
  html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')

/** Every <a …>…</a> in an HTML string: its decoded href and what it wraps. */
const anchorsOf = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: decode(attrs.match(/\bhref="([^"]*)"/)?.[1] ?? ''),
    attrs,
    inner,
  }))

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length

// A cover vote from an author's list: three photos, one with only a letter (no text).
const COVERS = [
  { text: 'Sunset orange', imageUrl: 'https://images.example.com/cover-orange.jpg' },
  { text: 'Deep teal', imageUrl: 'https://images.example.com/cover-teal.jpg' },
  { imageUrl: 'https://images.example.com/cover-black.jpg' },
]
const coverPoll = { question: 'Which cover should my novel get?', options: COVERS, target: 20, durationHours: 72 }

describe('the newsletter blocks (lib/newsletter.ts)', () => {
  const origin = 'https://tiebreak.example'
  const poll = {
    id: 'AbCdEfGhIjKl',
    question: coverPoll.question,
    options: COVERS.map((o) => ({ text: o.text ?? null, imageUrl: o.imageUrl })),
  }

  it('links each option to /polls/<id>?pick=<letter>&src=newsletter, absolute', () => {
    expect(voteLink(origin, poll.id, 0)).toBe('https://tiebreak.example/polls/AbCdEfGhIjKl?pick=A&src=newsletter')
    expect(voteLink(origin, poll.id, 3)).toBe('https://tiebreak.example/polls/AbCdEfGhIjKl?pick=D&src=newsletter')
  })

  it('HTML: one inline-styled <table>, no <script> or <style>, one <a href> per option wrapping its image', () => {
    const html = newsletterHtml(poll, origin)
    expect(html.trimStart().startsWith('<table')).toBe(true)
    expect(html.trimEnd().endsWith('</table>')).toBe(true)
    expect(count(html, /<table\b/g)).toBe(1)
    expect(html).not.toMatch(/<script|<style|<link|<iframe/i)
    expect(html).not.toMatch(/\son\w+=/i) // no event handlers
    expect(html).not.toMatch(/\sclass=/) // email clients drop stylesheets, so every style is inline
    for (const tag of ['table', 'td', 'a', 'img']) {
      for (const [open] of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))) expect(open).toMatch(/\sstyle="[^"]+"/)
    }

    const anchors = anchorsOf(html)
    expect(anchors.map((a) => a.href)).toEqual(['A', 'B', 'C'].map((l) => `${origin}/polls/${poll.id}?pick=${l}&src=newsletter`))
    anchors.forEach((a, i) => {
      expect(a.inner).toContain(`<img src="${poll.options[i].imageUrl}"`)
      expect(a.inner).toContain(`Vote ${'ABC'[i]}`)
    })
    expect(anchors[0].inner).toContain('Sunset orange')
    expect(anchors[1].inner).toContain('Deep teal')
    expect(html).toContain('Which cover should my novel get?')
  })

  it('HTML: every link and image is an absolute URL', () => {
    const html = newsletterHtml(poll, origin)
    const urls = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map(([, u]) => decode(u))
    expect(urls).toHaveLength(6)
    for (const url of urls) expect(url).toMatch(/^https:\/\/[^/]+\//)
  })

  it('HTML: a text option is a link wrapping its text', () => {
    const html = newsletterHtml({ id: poll.id, question: '', options: [{ text: 'Keep the title', imageUrl: null }, { text: 'Change it', imageUrl: null }] }, origin)
    const anchors = anchorsOf(html)
    expect(anchors).toHaveLength(2)
    expect(anchors[0].inner).toContain('Keep the title')
    expect(anchors[1].inner).toContain('Change it')
    expect(html).not.toContain('<img')
    expect(html).toContain('Which one?') // an empty question reads as the poll page does
  })

  it('HTML: user text is escaped, so a question or option can never add markup', () => {
    const nasty = '<script>alert(1)</script> "quoted" & <b>bold</b>'
    const html = newsletterHtml(
      { id: poll.id, question: nasty, options: [{ text: nasty, imageUrl: 'https://img.example.com/a.jpg?x=1&y="2"' }, { text: 'Plain', imageUrl: null }] },
      origin,
    )
    expect(html).not.toMatch(/<script|<b>bold/)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;')
    expect(anchorsOf(html)).toHaveLength(2)
    // The image link stays one attribute value: its quote is encoded, not closing the attribute.
    expect(html).toContain('src="https://img.example.com/a.jpg?x=1&amp;y=%222%22"')
  })

  it('HTML: 2 and 4 options sit 2 to a row, 3 in one row', () => {
    const rowsOf = (n: number) => {
      const options = Array.from({ length: n }, (_, i) => ({ text: `Option ${i}`, imageUrl: null }))
      const html = newsletterHtml({ id: poll.id, question: 'Q', options }, origin)
      return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) => count(row, /<a\b/g)).filter((n) => n > 0)
    }
    expect(rowsOf(2)).toEqual([2])
    expect(rowsOf(3)).toEqual([3])
    expect(rowsOf(4)).toEqual([2, 2])
  })

  it('Markdown: one image line and one link line per option', () => {
    const md = newsletterMarkdown(poll, origin)
    const lines = md.split('\n')
    const images = lines.filter((l) => l.startsWith('!['))
    const links = lines.filter((l) => l.startsWith('['))
    expect(images).toEqual([
      `![A: Sunset orange](${COVERS[0].imageUrl})`,
      `![B: Deep teal](${COVERS[1].imageUrl})`,
      `![Option C](${COVERS[2].imageUrl})`,
    ])
    expect(links).toEqual([
      `[Vote A: Sunset orange](${origin}/polls/${poll.id}?pick=A&src=newsletter)`,
      `[Vote B: Deep teal](${origin}/polls/${poll.id}?pick=B&src=newsletter)`,
      `[Vote C](${origin}/polls/${poll.id}?pick=C&src=newsletter)`,
    ])
    expect(md).toContain('**Which cover should my novel get?**')
    expect(md).not.toMatch(/<[a-z]/i)
  })

  it('Markdown: a text option has its link line only, and brackets in text can’t break a link', () => {
    const md = newsletterMarkdown(
      { id: poll.id, question: 'Pick [one]', options: [{ text: 'Title [draft] *new*', imageUrl: null }, { text: 'Cover (v2)', imageUrl: 'https://img.example.com/c (2).jpg' }] },
      origin,
    )
    const lines = md.split('\n').filter((l) => l.startsWith('[') || l.startsWith('!['))
    expect(lines).toEqual([
      `[Vote A: Title \\[draft\\] \\*new\\*](${origin}/polls/${poll.id}?pick=A&src=newsletter)`,
      '![B: Cover (v2)](https://img.example.com/c%20%282%29.jpg)',
      `[Vote B: Cover (v2)](${origin}/polls/${poll.id}?pick=B&src=newsletter)`,
    ])
    expect(md).toContain('**Pick \\[one\\]**')
  })
})

describe('"Get votes from your newsletter" on the poll page', () => {
  const PANEL = 'Get votes from your newsletter'

  it("shows the creator (by cookie) two copy buttons, holding the HTML and Markdown blocks for the poll's 3 options", async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const html = await render(body.id, { cookie: voter(1) })
    expect(html).toContain(PANEL)
    expect(count(html, />Copy HTML block<\/button>/g)).toBe(1)
    expect(count(html, />Copy Markdown<\/button>/g)).toBe(1)
    expect(count(html, />Copy (HTML block|Markdown)<\/button>/g)).toBe(2)

    // The blocks are also there to select by hand (and are what the buttons copy), for this site's address.
    const areas = [...html.matchAll(/<textarea[^>]*>([\s\S]*?)<\/textarea>/g)].map(([, text]) => decode(text).trim())
    const poll = body.poll
    expect(areas).toEqual([newsletterHtml(poll, SITE_URL), newsletterMarkdown(poll, SITE_URL)])
    expect(anchorsOf(areas[0]).map((a) => a.href)).toEqual(
      ['A', 'B', 'C'].map((l) => `${SITE_URL}/polls/${body.id}?pick=${l}&src=newsletter`),
    )
  })

  it('shows the creator by the native app’s x-tiebreak-voter header too', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    expect(await render(body.id, { header: accountIdOf(voter(1)) })).toContain(PANEL)
  })

  it('is never shown to anyone else: another account, a visitor with no id, or a header that isn’t the creator’s', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    expect(await render(body.id, { cookie: voter(2) })).not.toContain(PANEL)
    expect(await render(body.id)).not.toContain(PANEL)
    expect(await render(body.id, { header: accountIdOf(voter(2)) })).not.toContain(PANEL)
    // The header wins over the cookie, as in the API (lib/http.ts voterOf).
    expect(await render(body.id, { cookie: voter(1), header: accountIdOf(voter(2)) })).not.toContain(PANEL)
    expect(await render(body.id, { cookie: voter(2), query: { pick: 'A', src: 'newsletter' } })).not.toContain('Copy HTML block')
  })

  it('goes once the poll has closed, since nobody can vote any more', async () => {
    const { body } = await createPoll({ ...coverPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))
    const html = await render(body.id, { cookie: voter(1) })
    expect(html).toContain('Winner: ')
    expect(html).not.toContain(PANEL)
  })
})

describe('a vote link: GET /polls/<id>?pick=…&src=newsletter', () => {
  it('records no vote: it sends the reader on to the poll page with the pick, and the count stays 0', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const res = await openLink(`/polls/${body.id}?pick=B&src=newsletter`)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`/p/${body.id}?pick=B&src=newsletter`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toBeNull() // no account is made for a link checker
    expect(await voteCount(body.id)).toBe(0)
    expect(await votesInDb()).toBe(0)
  })

  it('a scanner or prefetcher opening every link, again and again, still casts no vote', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    for (const letter of ['A', 'B', 'C', 'A', 'B', 'C']) {
      expect((await openLink(`/polls/${body.id}?pick=${letter}&src=newsletter`)).status).toBe(307)
    }
    for (const as of [voter(2), voter(3)]) {
      await render(body.id, { cookie: as, query: { pick: 'A', src: 'newsletter' } })
    }
    expect(await voteCount(body.id)).toBe(0)
    expect(await votesInDb()).toBe(0)
  })

  it('passes on only a letter A–D and a known source; anything else is dropped', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    expect((await openLink(`/polls/${body.id}?pick=c&src=newsletter`)).headers.get('location')).toBe(`/p/${body.id}?pick=C&src=newsletter`)
    expect((await openLink(`/polls/${body.id}?pick=Z&src=https%3A%2F%2Fevil.example`)).headers.get('location')).toBe(`/p/${body.id}`)
    expect((await openLink(`/polls/${body.id}?src=newsletter`)).headers.get('location')).toBe(`/p/${body.id}?src=newsletter`)
  })

  it('an id that is not a poll id gets the API’s 404', async () => {
    const res = await pollRoute(new Request(`${ORIGIN}/polls/..%2Fevil?pick=A&src=newsletter`), { params: Promise.resolve({ id: '../evil' }) })
    expect(res.status).toBe(404)
  })

  it('without pick or src, GET /polls/:id is the JSON API it always was', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const { res, body: read } = await getPoll(body.id, voter(1))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(read.poll.id).toBe(body.id)
  })
})

describe('the poll page opened from a vote link', () => {
  it('opens with that option preselected and one "Confirm vote" button, and no vote yet', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const html = await render(body.id, { cookie: voter(2), query: { pick: 'B', src: 'newsletter' } })
    expect(count(html, />Confirm vote<\/button>/g)).toBe(1)
    const pressed = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"/g)].map(([, p]) => p)
    expect(pressed).toEqual(['false', 'true', 'false'])
    expect(html).toContain('Deep teal')
    expect(html).not.toContain('You picked')
    expect(await voteCount(body.id)).toBe(0)
  })

  it('a two-option poll shows the same confirm step, not the swipe card that votes on a tap', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    const html = await render(body.id, { cookie: voter(2), query: { pick: 'A', src: 'newsletter' } })
    expect(count(html, />Confirm vote<\/button>/g)).toBe(1)
    expect(html).not.toContain('swipe-card')
    expect(html).not.toMatch(/>Pick (<!-- -->)?A</)
    expect([...html.matchAll(/aria-pressed="(true|false)"/g)].map(([, p]) => p)).toEqual(['true', 'false'])
  })

  it("a letter the poll doesn't have, or none, shows the usual picker", async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const queries: Record<string, string>[] = [{ pick: 'D', src: 'newsletter' }, { pick: 'x' }, { src: 'newsletter' }, {}]
    for (const query of queries) {
      const html = await render(body.id, { cookie: voter(2), query })
      expect(html).not.toContain('Confirm vote')
      expect(html).not.toContain('aria-pressed')
      expect(html).toContain('face-button')
    }
  })

  it('confirming creates exactly one vote, for the reader’s account', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    await openLink(`/polls/${body.id}?pick=B&src=newsletter`)
    await render(body.id, { cookie: voter(2), query: { pick: 'B', src: 'newsletter' } })
    const confirmed = await vote(body.id, 1, voter(2)) // what "Confirm vote" sends
    expect(confirmed.res.status).toBe(201)
    expect(confirmed.body.poll.myVote).toBe(1)
    expect(await voteCount(body.id)).toBe(1)
    expect(await votesInDb()).toBe(1)
  })

  it('a second confirm by the same voter is a 409 and the count stays 1', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    expect((await vote(body.id, 1, voter(2))).res.status).toBe(201)
    const again = await vote(body.id, 2, voter(2)) // a second tab, a second link
    expect(again.res.status).toBe(409)
    expect(await voteCount(body.id)).toBe(1)
    expect(await votesInDb()).toBe(1)
  })

  it('someone who already voted sees their pick, not a second confirm button', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    await vote(body.id, 0, voter(2))
    const html = await render(body.id, { cookie: voter(2), query: { pick: 'B', src: 'newsletter' } })
    expect(html).toContain('You picked')
    expect(html).not.toContain('Confirm vote')
  })

  it('a link to a closed poll shows the result page, not a vote button', async () => {
    const { body } = await createPoll({ ...coverPoll, target: 1 }, voter(1))
    await vote(body.id, 1, voter(2))
    expect((await openLink(`/polls/${body.id}?pick=A&src=newsletter`)).status).toBe(307)
    const html = await render(body.id, { cookie: voter(3), query: { pick: 'A', src: 'newsletter' } })
    expect(html).toContain('Winner: B · Deep teal')
    expect(html).not.toContain('Confirm vote')
    expect(html).not.toContain('aria-pressed')
    expect(html).not.toContain('face-button')
  })

  it('a link to a poll past its deadline shows the result too (the page closes it first)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { body } = await createPoll(coverPoll, voter(1))
      await vote(body.id, 2, voter(2))
      vi.setSystemTime(Date.now() + 73 * HOUR)
      const html = await render(body.id, { query: { pick: 'A', src: 'newsletter' } })
      expect(html).toContain('Winner: C · Option C')
      expect(html).not.toContain('Confirm vote')
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

describe('landing from a newsletter link: the visit beacon', () => {
  const SITE = 'https://tiebreak-phi.vercel.app'
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
    vi.stubGlobal('document', { referrer: 'https://mail.google.com/' })
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

  /** A full page load, as the layout's beacon sees it (app/visit-beacon.tsx). */
  function land(pathname: string, search: string) {
    here.pathname = pathname
    here.search = search
    countVisit(pathname, search)
  }

  it("sends a visit with the poll's path and source 'newsletter'", () => {
    land('/p/AbCdEfGhIjKl', '?pick=B&src=newsletter')
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'visit', referrer: 'https://mail.google.com/', path: '/p/AbCdEfGhIjKl', source: 'newsletter' },
    ])
  })

  it('counts apart from the session’s other visits: once per poll per session, even after a plain visit', () => {
    land('/', '') // a plain visit (search, a shared link) first
    land('/p/AbCdEfGhIjKl', '?pick=A&src=newsletter')
    land('/p/AbCdEfGhIjKl', '?pick=C&src=newsletter') // back to the email, another option
    land('/p/ZyXwVuTsRqPo', '?pick=A&src=newsletter') // another poll's link
    land('/feed', '') // on around the site
    expect(sent().map((b) => [b.path ?? null, b.source ?? null])).toEqual([
      [null, null],
      ['/p/AbCdEfGhIjKl', 'newsletter'],
      ['/p/ZyXwVuTsRqPo', 'newsletter'],
    ])
  })

  it('a newsletter visit stands in for the session’s first visit', () => {
    land('/p/AbCdEfGhIjKl', '?pick=A&src=newsletter')
    land('/', '')
    expect(sent()).toHaveLength(1)
  })

  it('shared links and other sources stay plain visits, with no path or source', () => {
    land('/p/AbCdEfGhIjKl', '') // the share link
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://mail.google.com/' }])
    expect(sourceFor('?src=newsletter')).toBe('newsletter')
    expect(sourceFor('?pick=A&src=NEWSLETTER')).toBeNull()
    expect(sourceFor('?src=jane%40example.com')).toBeNull()
    expect(sourceFor('?src=')).toBeNull()
    expect(sourceFor('')).toBeNull()
  })

  it('activate and checkout send what they did before, wherever they are fired', () => {
    here.search = '?pick=A&src=newsletter'
    sendSignal('activate')
    sendSignal('checkout')
    expect(sent()).toEqual([
      { slug: 'tiebreak', kind: 'activate', referrer: 'https://mail.google.com/' },
      { slug: 'tiebreak', kind: 'checkout', referrer: 'https://mail.google.com/' },
    ])
  })

  it('sends nothing off production or from automated browsers', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    land('/p/AbCdEfGhIjKl', '?pick=A&src=newsletter')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('navigator', { webdriver: true })
    land('/p/AbCdEfGhIjKl', '?pick=A&src=newsletter')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the privacy page says a newsletter visit names its poll page', () => {
    const html = renderToString(PrivacyPage())
    expect(html).toContain('src=newsletter')
    expect(html).toContain('poll page')
  })
})

describe('the native app (mobile/) is unaffected', () => {
  it("its API client asks for a poll with no query, so it never meets the vote link's redirect", () => {
    const api = readFileSync(new URL('../mobile/src/lib/api.ts', import.meta.url), 'utf8')
    const gets = api.match(/'GET', `\/polls\/[^`]*`/g) ?? []
    expect(gets).toHaveLength(1)
    for (const get of gets) expect(get).not.toContain('?')
  })

  it('GET /polls/:id by the app’s header still answers 200 JSON with the poll', async () => {
    const { body } = await createPoll(coverPoll, voter(1))
    const res = await pollRoute(new Request(`${ORIGIN}/polls/${body.id}`, { headers: { 'x-tiebreak-voter': accountIdOf(voter(1)) } }), {
      params: Promise.resolve({ id: body.id }),
    })
    expect(res.status).toBe(200)
    const { poll } = await res.json()
    expect(poll.mine).toBe(true)
    expect(poll.voteCount).toBe(0)
  })
})
