// Public result pages (GROWTH.md, 2026-11-04): a creator ticks "Publish the result when it closes", and once the
// poll closes /results/<slug> is a page titled with its question, listed in the sitemap. Open, un-opted, private
// and reported polls get a 404 and stay out of the sitemap. The page sends the visit beacon with its own path.
// The same against the dev server and in Chromium: tests/public-results-browser.test.ts.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Metadata } from 'next'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendSignal } from '@/lib/beacon'
import { REPORTS_TO_HIDE } from '@/lib/limits'
import { resultIdOf, resultPath, resultSlug } from '@/lib/results'
import { SIGNAL_URL, SITE_URL } from '@/lib/site'
import { HOUR, basicPoll, createPoll, getPoll, makePro, report, useFakeStripe, useTestDb, vote, voter } from './helpers'

let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookie && name === 'tb_voter' ? { name, value: cookie } : undefined),
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  permanentRedirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${path}`)
  },
}))

const results = await import('@/app/results/[slug]/page')
const { default: HomePage } = await import('@/app/page')
const { default: PollPage } = await import('@/app/p/[id]/page')
const { default: PrivacyPage } = await import('@/app/privacy/page')
const { PathVisit, countVisit } = await import('@/app/visit-beacon')
const sitemap = (await import('@/app/sitemap')).default
const robots = (await import('@/app/robots')).default

const db = useTestDb()
useFakeStripe() // for the Pro account that tries a private, published poll

const textOf = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const QUESTION = 'Which cover for my cozy mystery novel?'
const COVERS = ['The Lighthouse Recipe', 'Murder at the Bakehouse', 'Tea, Toast and Trouble']

/**
 * A poll that closes at `votes.length` votes, each from a different stranger; voter(1) creates it.
 * `extra` overrides the create body (publishResult, visibility, …).
 */
async function closedPoll(votes: number[], extra: Record<string, unknown> = { publishResult: true }) {
  const { res, body } = await createPoll(
    { question: QUESTION, options: COVERS, target: Math.max(1, votes.length), durationHours: 24, ...extra },
    voter(1),
  )
  expect(res.status).toBe(201)
  for (const [i, option] of votes.entries()) expect((await vote(body.id, option, voter(100 + i))).res.status).toBe(201)
  return body.poll as { id: string; question: string }
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

/** The result page as the server renders it, or the error notFound()/permanentRedirect() threw. */
async function renderResult(slug: string) {
  return renderToString((await results.default(params(slug))) as ReactElement)
}

async function metadataOf(slug: string): Promise<Metadata> {
  return results.generateMetadata(params(slug))
}

async function sitemapUrls() {
  return (await sitemap()).map((e) => e.url)
}

describe('1. the create-poll form and the API', () => {
  it("has a 'Publish the result when it closes' checkbox, off by default", async () => {
    cookie = undefined
    const html = renderToString(await HomePage())
    const label = html.match(/<label class="check">((?:(?!<\/label>).)*Publish the result when it closes(?:(?!<\/label>).)*)<\/label>/s)?.[1]
    expect(label).toBeDefined()
    const box = label!.match(/<input[^>]*>/)?.[0] ?? ''
    expect(box).toContain('type="checkbox"')
    expect(box).not.toMatch(/checked/)
    expect(box).not.toMatch(/disabled/)
    expect(textOf(label!)).toContain('search engines') // says what publishing means
  })

  it('a private (Pro) poll that asks to publish its result gets 400, and no poll is created', async () => {
    const pro = voter(7)
    await makePro(pro)
    const { res, body } = await createPoll({ ...basicPoll, visibility: 'private', publishResult: true }, pro)
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/private/i)
    // A free account gets the same 400, before the Pro check.
    expect((await createPoll({ ...basicPoll, visibility: 'private', publishResult: true }, voter(8))).res.status).toBe(400)
    expect((await db().query('SELECT count(*)::int AS n FROM polls')).rows).toEqual([{ n: 0 }])
    // Each on its own is fine.
    expect((await createPoll({ ...basicPoll, visibility: 'private' }, pro)).res.status).toBe(201)
    expect((await createPoll({ ...basicPoll, publishResult: true }, pro)).res.status).toBe(201)
  })

  it('stores the choice: off unless asked for, on for unlisted and public polls', async () => {
    const off = await createPoll(basicPoll, voter(1))
    expect(off.res.status).toBe(201)
    expect(off.body.poll.publishResult).toBe(false)
    const on = await createPoll({ ...basicPoll, publishResult: true }, voter(1))
    expect(on.body.poll.publishResult).toBe(true)
    expect((await getPoll(on.body.id)).body.poll.publishResult).toBe(true)
    expect((await createPoll({ ...basicPoll, publishResult: false }, voter(1))).body.poll.publishResult).toBe(false)
  })

  it('refuses a publishResult that is not true or false, and publishing a poll with no question (it is the page title)', async () => {
    for (const publishResult of ['yes', 1, null, {}]) {
      const { res, body } = await createPoll({ ...basicPoll, publishResult }, voter(1))
      expect(res.status).toBe(400)
      expect(body.error).toMatch(/publishResult/)
    }
    for (const question of ['', '   ']) {
      const { res, body } = await createPoll({ ...basicPoll, question, publishResult: true }, voter(1))
      expect(res.status).toBe(400)
      expect(body.error).toMatch(/question/i)
    }
    expect((await createPoll({ ...basicPoll, question: '' }, voter(1))).res.status).toBe(201) // unpublished: still optional
  })
})

describe('2. the result page of an opted-in poll that closed', () => {
  it('has the question as its <title> and <h1>, a description with the winner and the vote count, and its own canonical URL', async () => {
    const poll = await closedPoll([1, 1, 0]) // B, B, A: closes at 3
    const slug = resultSlug(poll)
    const meta = await metadataOf(slug)
    expect(meta.title).toEqual({ absolute: QUESTION }) // not "… · tiebreak"
    expect(meta.description).toContain('Winner: Murder at the Bakehouse')
    expect(meta.description).toContain('2 of 3 votes (67%)')
    expect(meta.alternates?.canonical).toBe(`/results/${slug}`)
    expect(meta.robots).toBeUndefined() // indexable, unlike the poll's own /p/ page
    const card = { url: `/p/${poll.id}/card?v=closed`, width: 1200, height: 630 }
    expect(meta.openGraph).toMatchObject({ type: 'website', siteName: 'tiebreak', url: `/results/${slug}`, title: QUESTION, images: [card] })
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: QUESTION, images: [card] })

    const html = await renderResult(slug)
    const h1s = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => textOf(m[1]))
    expect(h1s).toEqual([QUESTION])
  })

  it('shows every option with its vote split, the winner marked', async () => {
    const poll = await closedPoll([1, 1, 0, 1, 2]) // A 1, B 3, C 1
    const html = await renderResult(resultSlug(poll))
    const rows = [...html.matchAll(/<li( class="win")?>(.*?)<\/li>/gs)].map((m) => ({ win: Boolean(m[1]), text: textOf(m[2]) }))
    expect(rows).toEqual([
      { win: false, text: 'A · The Lighthouse Recipe 1 vote (20%)' },
      { win: true, text: 'B · Murder at the Bakehouse 3 votes (60%)' },
      { win: false, text: 'C · Tea, Toast and Trouble 1 vote (20%)' },
    ])
    expect(html).toContain('style="width:60%"')
    expect(textOf(html)).toContain('Winner: Murder at the Bakehouse, with 3 of 5 votes (60%).')
  })

  it("links to the new-poll form with 'Make your own tiebreak' (tagged ref=result for the visit counter)", async () => {
    const html = await renderResult(resultSlug(await closedPoll([0])))
    expect(html).toMatch(/<a class="button" href="\/\?ref=result">Make your own tiebreak<\/a>/)
  })

  it('shows each photo option’s picture, and says who voted without claiming more', async () => {
    const { body } = await createPoll(
      {
        question: 'Which photo for my mug listing?',
        options: [{ text: 'Blue mug', imageUrl: 'https://example.com/blue.jpg' }, { imageUrl: 'https://example.com/white.jpg' }],
        target: 1,
        durationHours: 24,
        visibility: 'unlisted',
        publishResult: true,
      },
      voter(1),
    )
    await vote(body.id, 1, voter(2))
    const html = await renderResult(resultSlug(body.poll))
    expect(html).toContain('src="https://example.com/blue.jpg"')
    expect(html).toContain('src="https://example.com/white.jpg"')
    expect(textOf(html)).toContain('Winner: Option B, with 1 of 1 vote (100%).')
    const text = textOf(html)
    expect(text).toMatch(/anonymous/)
    expect(text).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|creators|authors|customers)\b/i)
    expect(text).not.toMatch(/testimonial|trusted by|guarantee|panel/i)
  })

  it('says so on a tie, with the vote count', async () => {
    const poll = await closedPoll([0, 1])
    const meta = await metadataOf(resultSlug(poll))
    expect(meta.description).toContain("It's a tie between The Lighthouse Recipe and Murder at the Bakehouse, with 1 vote each out of 2.")
    expect(textOf(await renderResult(resultSlug(poll)))).not.toContain('Winner:')
  })

  it('appears once an opted-in poll passes its deadline with votes, even if nobody has opened it since', async () => {
    const created = await createPoll({ question: QUESTION, options: COVERS, target: 10, durationHours: 1, publishResult: true }, voter(1))
    await vote(created.body.id, 2, voter(2))
    const slug = resultSlug(created.body.poll)
    await expect(renderResult(slug)).rejects.toThrow('NEXT_NOT_FOUND') // still open
    await db().query(`UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1`, [created.body.id])
    expect(await sitemapUrls()).toContain(`${SITE_URL}/results/${slug}`) // listed before anyone reads it
    expect(textOf(await renderResult(slug))).toContain('Winner: Tea, Toast and Trouble, with 1 of 1 vote (100%).')
    expect((await getPoll(created.body.id)).body.poll.status).toBe('closed') // reading the page closed it
  })

  it('sends any other address of the same poll to the one canonical page (308)', async () => {
    const poll = await closedPoll([0])
    const canonical = resultPath(poll)
    for (const slug of [poll.id, `old-words-${poll.id}`, `${resultSlug(poll).toUpperCase().slice(0, -12)}${poll.id}`]) {
      await expect(renderResult(slug)).rejects.toThrow(`NEXT_REDIRECT 308 ${canonical}`)
    }
  })

  it("the poll's own page links to its public result page once it closes, and says it will when it's created", async () => {
    const poll = await closedPoll([0])
    cookie = undefined
    const html = renderToString((await PollPage({ params: Promise.resolve({ id: poll.id }), searchParams: Promise.resolve({}) })) as ReactElement)
    expect(html).toContain(`href="${resultPath(poll)}"`)

    const { body } = await createPoll({ ...basicPoll, publishResult: true }, voter(1))
    cookie = voter(1).split('=')[1]
    const fresh = renderToString((await PollPage({ params: Promise.resolve({ id: body.id }), searchParams: Promise.resolve({ new: '1' }) })) as ReactElement)
    expect(textOf(fresh)).toContain('When it closes, its result gets a public page')
    expect(fresh).not.toContain('href="/results/') // not before it closes
    cookie = undefined
  })
})

describe('3. what stays off: 404s and the sitemap', () => {
  it('404s for an open poll, an un-opted poll, a poll hidden by 3 reports, a poll nobody voted on, and an unknown address', async () => {
    const open = await createPoll({ ...basicPoll, publishResult: true }, voter(1))
    await vote(open.body.id, 0, voter(2))
    const unopted = await closedPoll([0], { publishResult: false })
    const reported = await closedPoll([1])
    const noVotes = await createPoll({ ...basicPoll, durationHours: 1, publishResult: true }, voter(1))
    await db().query(`UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1`, [noVotes.body.id])
    expect((await getPoll(noVotes.body.id)).body.poll.status).toBe('no_result')

    for (let i = 0; i < REPORTS_TO_HIDE - 1; i++) await report(reported.id, voter(200 + i))
    expect(await renderResult(resultSlug(reported))).toContain('<h1') // 2 reports: still up
    await report(reported.id, voter(300))

    for (const slug of [
      resultSlug(open.body.poll),
      resultSlug(unopted),
      resultSlug(reported),
      resultSlug(noVotes.body.poll),
      'AAAAAAAAAAAA',
      'which-cover-AAAAAAAAAAAA',
      'short',
      '',
    ]) {
      await expect(renderResult(slug), slug).rejects.toThrow('NEXT_NOT_FOUND')
      await expect(metadataOf(slug), slug).rejects.toThrow('NEXT_NOT_FOUND')
    }
  })

  it('never publishes a private poll, even one stored with the flag set', async () => {
    const pro = voter(9)
    await makePro(pro)
    const { body } = await createPoll({ question: QUESTION, options: COVERS, target: 1, durationHours: 24, visibility: 'private' }, pro)
    await vote(body.id, 0, voter(2))
    await db().query('UPDATE polls SET publish_result = true WHERE id = $1', [body.id])
    await expect(renderResult(resultSlug(body.poll))).rejects.toThrow('NEXT_NOT_FOUND')
    expect((await sitemapUrls()).filter((u) => u.includes('/results/'))).toEqual([])
  })

  it('/sitemap.xml lists only opted-in, closed, unhidden polls, next to the public pages', async () => {
    const published = await closedPoll([0, 1, 1])
    const alsoPublished = await closedPoll([2], { publishResult: true, question: 'Thumbnail for my sourdough video: A or B?' })
    const unopted = await closedPoll([0], { publishResult: false })
    const open = await createPoll({ ...basicPoll, publishResult: true }, voter(1))
    const hidden = await closedPoll([0])
    for (let i = 0; i < REPORTS_TO_HIDE; i++) await report(hidden.id, voter(400 + i))

    const urls = await sitemapUrls()
    const listed = urls.filter((u) => u.includes('/results/'))
    expect(listed.sort()).toEqual([`${SITE_URL}${resultPath(published)}`, `${SITE_URL}${resultPath(alsoPublished)}`].sort())
    for (const id of [unopted.id, open.body.id, hidden.id]) expect(urls.join(' ')).not.toContain(id)
    expect(urls).toContain(SITE_URL) // the home page and the rest are still there
    expect(urls).toContain(`${SITE_URL}/pickfu-alternative`)
    const entry = (await sitemap()).find((e) => e.url.endsWith(resultPath(published)))
    expect(new Date(String(entry?.lastModified)).getTime()).toBeGreaterThan(Date.now() - HOUR)
  })

  it('still lists the public pages if the database is down', async () => {
    const lib = await import('@/lib/polls')
    const spy = vi.spyOn(lib, 'listPublishedResults').mockRejectedValueOnce(new Error('connection refused'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const urls = await sitemapUrls()
      expect(urls).toContain(SITE_URL)
      expect(urls.some((u) => u.includes('/results/'))).toBe(false)
    } finally {
      spy.mockRestore()
      quiet.mockRestore()
    }
  })

  it('result pages are open to search engines (robots.txt)', () => {
    const disallowed = (robots().rules as { disallow: string[] }).disallow
    expect(disallowed.some((prefix) => '/results/which-cover-AAAAAAAAAAAA'.startsWith(prefix))).toBe(false)
  })
})

describe('the address', () => {
  it('is the question’s words then the poll id, and the id comes back out of it', () => {
    expect(resultSlug({ id: 'AbC_dEf-1234', question: 'Which cover: Café Noir or Tea & Toast?' })).toBe('which-cover-cafe-noir-or-tea-toast-AbC_dEf-1234')
    expect(resultSlug({ id: '-bC_dEf-1234', question: '???' })).toBe('-bC_dEf-1234')
    expect(resultIdOf('which-cover-cafe-noir-or-tea-toast-AbC_dEf-1234')).toBe('AbC_dEf-1234')
    expect(resultIdOf('-bC_dEf-1234')).toBe('-bC_dEf-1234')
    expect(resultIdOf('which-cover--bC_dEf-1234')).toBe('-bC_dEf-1234')
    expect(resultIdOf('short')).toBeNull()
    expect(resultIdOf('whichAbC_dEf-1234')).toBeNull() // words must end in a dash before the id
  })

  it('keeps long questions to a short address, cut at a word', () => {
    const slug = resultSlug({ id: 'AAAAAAAAAAAA', question: 'Which of these two hand-thrown speckled stoneware mugs should be the main photo for my Etsy listing this spring?' })
    const words = slug.slice(0, -13)
    expect(words.length).toBeLessThanOrEqual(60)
    expect(words).toMatch(/^which-of-these-two-hand-thrown-speckled-stoneware-mugs/)
    expect(words).not.toMatch(/-$/)
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

/** Every element in a server-rendered tree, server components already resolved by the page itself. */
function elementsOf(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf)
  if (!isValidElement(node)) return []
  const children = (node.props as { children?: ReactNode }).children
  return [node, ...elementsOf(children)]
}

describe('4. the visit beacon on the result page', () => {
  it('the page mounts the beacon with its own path, /results/<slug>', async () => {
    const poll = await closedPoll([0])
    const tree = await results.default(params(resultSlug(poll)))
    const beacons = elementsOf(tree).filter((e) => e.type === PathVisit)
    expect(beacons.map((e) => (e.props as { path: string }).path)).toEqual([resultPath(poll)])
  })
})

describe('4. what the beacon sends', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', { webdriver: false })
    vi.stubGlobal('location', { origin: 'https://tiebreak-phi.vercel.app', search: '' })
    vi.stubGlobal('document', { referrer: 'https://www.google.com/' })
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

  it('a result page’s path goes out with the visit, once per session per result page', () => {
    const path = '/results/which-cover-for-my-cozy-mystery-novel-AbC_dEf-1234'
    sendSignal('visit', path)
    sendSignal('visit', path) // a reload
    sendSignal('visit') // then the home page: this session is already counted
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/', path }])
  })

  it("the layout's beacon leaves result pages to the page, so a landing there counts once, with its path", () => {
    const path = '/results/which-cover-for-my-cozy-mystery-novel-AbC_dEf-1234'
    countVisit(path)
    expect(sent()).toEqual([])
    sendSignal('visit', path)
    countVisit('/') // and the layout on the next page sends nothing more
    expect(sent().map((b) => b.path)).toEqual([path])
    countVisit('/p/AbC_dEf-1234') // poll pages are unchanged: a plain visit, no path
    vi.stubGlobal('sessionStorage', memoryStorage())
    countVisit('/p/AbC_dEf-1234')
    expect(sent().at(-1)).toEqual({ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/' })
  })

  it('the privacy page says what publishing shows, and that a result page visit names its page', () => {
    const text = textOf(renderToString(PrivacyPage()))
    expect(text).toContain('Publish the result when it closes')
    expect(text).toMatch(/result page/)
  })
})

describe('5. the native app is unchanged', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  /** Where this branch left main, when main is here (CI's shallow checkout has no main, so the check skips there). */
  const forkPoint = (() => {
    for (const ref of ['main', 'origin/main']) {
      try {
        return git('merge-base', 'HEAD', ref)
      } catch {}
    }
    return null
  })()

  it('its create request (no publishResult) still posts a poll, unpublished', async () => {
    const { res, body } = await createPoll({ question: 'Name for my sourdough starter?', options: ['Clint Yeastwood', 'Bread Pitt'], target: 3, durationHours: 24, visibility: 'unlisted' }, voter(1))
    expect(res.status).toBe(201)
    expect(body.poll.publishResult).toBe(false)
  })

  it.skipIf(forkPoint === null)('no file under mobile/ differs from where this branch left main', () => {
    expect(git('diff', '--name-only', forkPoint!, '--', 'mobile')).toBe('')
    expect(git('ls-files', '--others', '--exclude-standard', '--', 'mobile')).toBe('')
  })
})
