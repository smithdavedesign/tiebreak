// Public result pages (GROWTH.md, 2026-11-06): a creator ticks "Publish the result when it closes", and once the
// poll closes, /results/<slug> shows it to anyone, titled with its question, and /sitemap.xml lists it. A private
// poll can't be published, and a page 404s while its poll is open, if it wasn't opted in, if it closed with no votes
// or once 3 reports hide it. Loading one counts a visit with its path. The same pages over HTTP and in Chromium:
// tests/result-pages-browser.test.ts.
import { execFileSync } from 'node:child_process'
import type { Metadata } from 'next'
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap, { dynamic as sitemapDynamic } from '@/app/sitemap'
import { sendSignal } from '@/lib/beacon'
import { REPORTS_TO_HIDE } from '@/lib/limits'
import { isResultPath, pollIdOfSlug, resultPath, resultSlug } from '@/lib/results'
import { PUBLIC_PAGES, SIGNAL_URL, SITE_URL } from '@/lib/site'
import {
  basicPoll,
  createPoll,
  getPoll,
  makePro,
  postPublicPoll,
  rawCreate,
  report,
  useFakeStripe,
  useTestDb,
  vote,
  voter,
} from './helpers'

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
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${to}`)
  },
}))

const { default: HomePage } = await import('@/app/page')
const { default: PollPage } = await import('@/app/p/[id]/page')
const resultPage = await import('@/app/results/[slug]/page')
const { default: PrivacyPage } = await import('@/app/privacy/page')
const { countVisit } = await import('@/app/visit-beacon')

const db = useTestDb()
useFakeStripe() // Pro comes through the (fake) Checkout and webhook, as for a buyer

const QUESTION = 'Which photo for my ceramic mug listing?'

/** Renders a page as the given account (a `tb_voter=…` cookie string, or nobody). */
async function render(page: () => Promise<ReactElement> | ReactElement, as?: string) {
  cookie = as?.split('=')[1]
  return renderToString(await page())
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) })
const renderResult = (slug: string) => render(() => resultPage.default(params(slug)) as Promise<ReactElement>)
const metadataOf = (slug: string): Promise<Metadata> => resultPage.generateMetadata(params(slug))

/** Text as a reader sees it: tags and React's text separators dropped, entities decoded. */
const textOf = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const h1sOf = (html: string) => [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => textOf(m[1]))

/** The checkbox in the label whose text starts with `label` on a rendered form. */
const checkboxOf = (html: string, label: string) =>
  html.match(new RegExp(`<label class="check"><input type="checkbox"([^>]*)/?><span>${label}`))?.[1]

/**
 * A poll created by voter(1) with `body` (published unless it says otherwise), then voted on by strangers, one
 * vote per entry of `votes`. With as many votes as its target (the default), it closes on the last one.
 */
async function pollWithVotes(votes: number[], body: Record<string, unknown> = {}) {
  const created = await createPoll(
    { ...basicPoll, question: QUESTION, publishResult: true, target: Math.max(1, votes.length), ...body },
    voter(1),
  )
  expect(created.res.status).toBe(201)
  for (const [i, option] of votes.entries()) expect((await vote(created.body.id, option, voter(100 + i))).res.status).toBe(201)
  return (await getPoll(created.body.id)).body.poll as { id: string; question: string; status: string; publishResult: boolean }
}

/** Throws what the page throws (a 404 or a redirect), or returns the HTML. */
async function outcome(slug: string) {
  try {
    return await renderResult(slug)
  } catch (error) {
    return (error as Error).message
  }
}

const sitemapUrls = async () => (await sitemap()).map((e) => e.url)
const resultUrls = async () => (await sitemapUrls()).filter((url) => url.startsWith(`${SITE_URL}/results/`))

describe('1. the "Publish the result when it closes" checkbox and the API', () => {
  it('is on the new-poll form, off by default', async () => {
    const html = await render(HomePage, voter(1))
    const box = checkboxOf(html, 'Publish the result when it closes')
    expect(box).toBeDefined()
    expect(box).not.toContain('checked')
    expect(box).not.toContain('disabled')
    expect(await render(HomePage)).toContain('Publish the result when it closes')
  })

  it('is there, off, for a Pro account too, next to the private-result box', async () => {
    await makePro(voter(1))
    const html = await render(HomePage, voter(1))
    expect(checkboxOf(html, 'Publish the result when it closes')).not.toContain('checked')
    expect(checkboxOf(html, 'Keep the result private')).toBeDefined()
  })

  it('says what publishing means: a public page search engines can list', async () => {
    const text = textOf(await render(HomePage, voter(1)))
    expect(text).toMatch(/Publish the result when it closes \(a public page .*search engines can list/)
  })

  it('an API call that leaves it out creates an unpublished poll, as before (the native app sends none)', async () => {
    const { res, body } = await createPoll(basicPoll, voter(1))
    expect(res.status).toBe(201)
    expect(body.poll.publishResult).toBe(false)
  })

  it('publishResult: true on a link-only or a public poll is kept', async () => {
    const unlisted = await createPoll({ ...basicPoll, publishResult: true }, voter(1))
    expect(unlisted.res.status).toBe(201)
    expect(unlisted.body.poll).toMatchObject({ visibility: 'unlisted', publishResult: true })
    const id = await postPublicPoll(voter(2), { publishResult: true })
    expect((await getPoll(id)).body.poll).toMatchObject({ visibility: 'public', publishResult: true })
  })

  it('a private poll can’t be published: 400 when both are set, even for Pro, and nothing is created', async () => {
    await makePro(voter(1))
    const both = { ...basicPoll, visibility: 'private', publishResult: true }
    for (const as of [voter(1), voter(2), undefined]) {
      const { res, body } = await createPoll(both, as)
      expect(res.status).toBe(400)
      expect(body.error).toMatch(/private/i)
    }
    expect((await db().query('SELECT count(*)::int AS n FROM polls')).rows).toEqual([{ n: 0 }])
    // Each on its own is fine for Pro.
    expect((await createPoll({ ...basicPoll, visibility: 'private' }, voter(1))).res.status).toBe(201)
    expect((await createPoll({ ...basicPoll, visibility: 'private', publishResult: false }, voter(1))).res.status).toBe(201)
  })

  it('the database refuses a private published poll too', async () => {
    await makePro(voter(1))
    const { body } = await createPoll({ ...basicPoll, visibility: 'private' }, voter(1))
    await expect(db().query('UPDATE polls SET publish_result = true WHERE id = $1', [body.id])).rejects.toThrow(
      /polls_publish_result_check/,
    )
  })

  it('publishing needs a question, since it is the page’s title', async () => {
    for (const question of ['', '   ']) {
      const { res, body } = await createPoll({ ...basicPoll, question, publishResult: true }, voter(1))
      expect(res.status).toBe(400)
      expect(body.error).toMatch(/question/i)
    }
    const { body } = await createPoll({ ...basicPoll, question: undefined, publishResult: true }, voter(1))
    expect(body.error).toMatch(/question/i)
  })

  it.each([['yes'], [1], [null], [{}]])('publishResult must be true or false, not %j (400)', async (value) => {
    const { res, body } = await createPoll({ ...basicPoll, publishResult: value }, voter(1))
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/publishResult/)
  })

  it('works from the native app’s header identity, like any other field', async () => {
    const res = await rawCreate({
      headers: { 'content-type': 'application/json', 'x-tiebreak-voter': voter(7).split('=')[1] },
      body: JSON.stringify({ ...basicPoll, publishResult: true }),
    })
    expect(res.status).toBe(201)
    expect((await res.json()).poll.publishResult).toBe(true)
  })
})

describe('2. the result page of a closed, published poll', () => {
  it('has <title> and <h1> equal to the question, and is open to search engines', async () => {
    const poll = await pollWithVotes([1, 1, 0])
    expect(poll.status).toBe('closed')
    const slug = resultSlug(poll)
    const html = await renderResult(slug)
    expect(h1sOf(html)).toEqual([QUESTION])
    const meta = await metadataOf(slug)
    expect(meta.title).toEqual({ absolute: QUESTION }) // no " · tiebreak" after it
    expect(meta.robots).toBeUndefined()
    expect(meta.alternates?.canonical).toBe(`/results/${slug}`)
  })

  it('a meta description stating the winner and the vote count', async () => {
    const poll = await pollWithVotes([1, 1, 0])
    const { description } = await metadataOf(resultSlug(poll))
    expect(description).toMatch(/^“Blue mug” won with 2 of 3 votes \(67%\)\./)
    expect(description!.length).toBeLessThanOrEqual(160)
  })

  it('every option with its vote split, and the winner', async () => {
    const poll = await pollWithVotes([1, 1, 0])
    const text = textOf(await renderResult(resultSlug(poll)))
    expect(text).toContain('Winner: B · Blue mug')
    expect(text).toContain('A · Red mug 1 vote (33%)')
    expect(text).toContain('B · Blue mug 2 votes (67%)')
    expect(text).toContain('Closed with 3 votes')
  })

  it('every option of a 4-option poll, with the ones nobody picked at 0%', async () => {
    const options = ['Linen', 'Walnut', 'Slate', 'Marble']
    const poll = await pollWithVotes([2, 2, 0, 2], { options })
    const text = textOf(await renderResult(resultSlug(poll)))
    expect(text).toContain('A · Linen 1 vote (25%)')
    expect(text).toContain('B · Walnut 0 votes (0%)')
    expect(text).toContain('C · Slate 3 votes (75%)')
    expect(text).toContain('D · Marble 0 votes (0%)')
  })

  it('a "Make your own tiebreak" link to the new-poll form, tagged so the visit counter can tell', async () => {
    const poll = await pollWithVotes([0])
    const html = await renderResult(resultSlug(poll))
    expect(html).toMatch(/<a class="button" href="\/\?ref=result">Make your own tiebreak<\/a>/)
  })

  it('a tie says so, in the page and the description', async () => {
    const poll = await pollWithVotes([0, 1])
    const slug = resultSlug(poll)
    expect(textOf(await renderResult(slug))).toContain("It's a tie.")
    expect((await metadataOf(slug)).description).toMatch(/^“Red mug” and “Blue mug” tied with 1 vote each, out of 2\./)
  })

  it('a photo option shows its photo; the description names a photo-only option by its letter', async () => {
    const image = 'https://images.example.com/cover-b.jpg'
    const poll = await pollWithVotes([1], { options: ['Plain cover', { imageUrl: image }] })
    const html = await renderResult(resultSlug(poll))
    expect(html).toContain(`src="${image}"`)
    expect(html).toContain('alt="Option B"')
    expect((await metadataOf(resultSlug(poll))).description).toMatch(/^Option B won with 1 of 1 vote \(100%\)\./)
  })

  it('share tags carry the question and the poll’s result card', async () => {
    const poll = await pollWithVotes([1, 1, 0])
    const meta = await metadataOf(resultSlug(poll))
    const card = { url: `/p/${poll.id}/card?v=closed`, width: 1200, height: 630 }
    expect(meta.openGraph).toMatchObject({ siteName: 'tiebreak', url: resultPath(poll), title: QUESTION, images: [card] })
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: QUESTION, images: [card] })
  })

  it('a poll that closes by its deadline gets its page on the first read after it', async () => {
    const poll = await pollWithVotes([1], { target: 5 })
    expect(poll.status).toBe('open')
    expect(await outcome(resultSlug(poll))).toBe('NEXT_NOT_FOUND')
    await db().query("UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1", [poll.id])
    expect(h1sOf(await renderResult(resultSlug(poll)))).toEqual([QUESTION])
  })

  it('escapes the question like any text (no markup from it reaches the page)', async () => {
    const question = 'Cover <b>A</b> or "B" & co?'
    const poll = await pollWithVotes([0], { question })
    const html = await renderResult(resultSlug(poll))
    expect(html).not.toContain('<b>A</b>')
    expect(h1sOf(html)).toEqual([question])
    expect((await metadataOf(resultSlug(poll))).title).toEqual({ absolute: question })
  })

  it('an address with other words before the id redirects (308) to the page’s own address', async () => {
    const poll = await pollWithVotes([0])
    expect(await outcome(`old-words-${poll.id}`)).toBe(`NEXT_REDIRECT 308 ${resultPath(poll)}`)
    expect(await outcome(poll.id)).toBe(`NEXT_REDIRECT 308 ${resultPath(poll)}`)
  })

  it('says honestly where the votes came from and that the creator chose to publish', async () => {
    const text = textOf(await renderResult(resultSlug(await pollWithVotes([0]))))
    expect(text).toContain('its creator chose to publish the result')
    expect(text).not.toMatch(/\b\d[\d,]*\+?\s+(users|sellers|creators|customers)\b/i)
    expect(text).not.toMatch(/testimonial|trusted by/i)
  })

  it('the creator’s poll page links to the public page once it’s up', async () => {
    const poll = await pollWithVotes([1])
    const pollPage = () => PollPage({ params: Promise.resolve({ id: poll.id }), searchParams: Promise.resolve({}) })
    expect(await render(pollPage, voter(1))).toContain(`href="${resultPath(poll)}"`)
    expect(textOf(await render(pollPage, voter(1)))).toContain('You published this result')
    expect(textOf(await render(pollPage))).toContain('Its creator published this result')

    const unpublished = await pollWithVotes([1], { publishResult: false })
    const plain = await render(() => PollPage({ params: Promise.resolve({ id: unpublished.id }), searchParams: Promise.resolve({}) }), voter(1))
    expect(plain).not.toContain('/results/')
    const open = await pollWithVotes([1], { target: 3 })
    const openPage = await render(() => PollPage({ params: Promise.resolve({ id: open.id }), searchParams: Promise.resolve({}) }), voter(1))
    expect(openPage).not.toContain('/results/')
  })
})

describe('3. which polls get a page, and the sitemap', () => {
  it('404s for an open poll, an un-opted poll, a poll that closed with no votes, and made-up addresses', async () => {
    const open = await pollWithVotes([0], { target: 3 })
    const unopted = await pollWithVotes([0], { publishResult: false })
    const noVotes = await pollWithVotes([], { target: 3 })
    await db().query("UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1", [noVotes.id])
    expect((await getPoll(noVotes.id)).body.poll.status).toBe('no_result')

    for (const poll of [open, unopted, noVotes]) expect(await outcome(resultSlug(poll))).toBe('NEXT_NOT_FOUND')
    for (const slug of ['', 'nope', 'which-mug-AAAAAAAAAAAA', `x${open.id}`, `${resultSlug(open)}/more`]) {
      expect(await outcome(slug)).toBe('NEXT_NOT_FOUND')
    }
    expect(await metadataOf('nope')).toEqual({})
  })

  it('404s once 3 reports hide the poll (2 aren’t enough)', async () => {
    const poll = await pollWithVotes([1, 0, 1])
    const slug = resultSlug(poll)
    for (let i = 1; i < REPORTS_TO_HIDE; i++) expect((await report(poll.id, voter(200 + i))).res.status).toBe(201)
    expect(h1sOf(await renderResult(slug))).toEqual([QUESTION])
    expect((await report(poll.id, voter(299))).res.status).toBe(201)
    expect(await outcome(slug)).toBe('NEXT_NOT_FOUND')
    expect(await resultUrls()).toEqual([])
  })

  it('/sitemap.xml lists only opted-in, closed, unhidden polls, after the public pages', async () => {
    const published = await pollWithVotes([1, 1, 0])
    const alsoPublished = await pollWithVotes([0], { question: 'Which book cover for my cozy mystery?' })
    await pollWithVotes([0, 1], { publishResult: false }) // closed, not opted in
    await pollWithVotes([0], { target: 4 }) // opted in, still open
    const hidden = await pollWithVotes([0])
    for (let i = 0; i < REPORTS_TO_HIDE; i++) await report(hidden.id, voter(300 + i))
    const empty = await pollWithVotes([], { target: 2 })
    await db().query("UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1", [empty.id])

    const urls = await sitemapUrls()
    expect(urls.slice(0, PUBLIC_PAGES.length)).toEqual(PUBLIC_PAGES.map((p) => `${SITE_URL}${p === '/' ? '' : p}`))
    expect((await resultUrls()).sort()).toEqual([published, alsoPublished].map((p) => `${SITE_URL}${resultPath(p)}`).sort())
  })

  it('each entry’s last change is when its poll closed', async () => {
    const poll = await pollWithVotes([0])
    const { closedAt } = (await getPoll(poll.id)).body.poll
    const entry = (await sitemap()).find((e) => e.url === `${SITE_URL}${resultPath(poll)}`)
    expect(entry?.lastModified).toBe(closedAt)
  })

  it('closes a published poll whose deadline passed with nobody looking, so it’s listed', async () => {
    const poll = await pollWithVotes([1], { target: 5 })
    expect(await resultUrls()).toEqual([])
    await db().query("UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1", [poll.id])
    expect(await resultUrls()).toEqual([`${SITE_URL}${resultPath(poll)}`])
    expect((await db().query('SELECT status FROM polls WHERE id = $1', [poll.id])).rows).toEqual([{ status: 'closed' }])
  })

  it('is built per request, not at build time (it reads the database)', () => {
    expect(sitemapDynamic).toBe('force-dynamic')
    expect(resultPage.dynamic).toBe('force-dynamic')
  })

  it('still lists the public pages if the polls can’t be read', async () => {
    await pollWithVotes([0])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db().query('ALTER TABLE polls RENAME TO polls_away')
    try {
      expect(await sitemapUrls()).toEqual(PUBLIC_PAGES.map((p) => `${SITE_URL}${p === '/' ? '' : p}`))
      expect(error).toHaveBeenCalled()
    } finally {
      await db().query('ALTER TABLE polls_away RENAME TO polls')
      error.mockRestore()
    }
  })
})

describe('the result page’s address', () => {
  const id = 'AbC-dEf_GhIj'

  it('is the question’s words, then the poll id', () => {
    expect(resultSlug({ id, question: 'Which book cover: the red one, or the blue one?' })).toBe(
      `which-book-cover-the-red-one-or-the-blue-one-${id}`,
    )
    expect(resultSlug({ id, question: 'Café crème ou thé ?' })).toBe(`cafe-creme-ou-the-${id}`)
    expect(resultPath({ id, question: 'Mug A or mug B?' })).toBe(`/results/mug-a-or-mug-b-${id}`)
  })

  it('is just the id when the question has no letters or digits it can use', () => {
    expect(resultSlug({ id, question: '本の表紙はどっち？' })).toBe(id)
    expect(resultSlug({ id, question: '?!' })).toBe(id)
  })

  it('keeps at most 60 characters of words, cut between words', () => {
    const question = 'Which of these four thumbnails would make you click on my video about sourdough starters?'
    const slug = resultSlug({ id, question })
    const words = slug.slice(0, -id.length - 1)
    expect(words.length).toBeLessThanOrEqual(60)
    expect(question.toLowerCase()).toContain(words.replace(/-/g, ' '))
    expect(words).toBe('which-of-these-four-thumbnails-would-make-you-click-on-my')
    expect(resultSlug({ id, question: 'x'.repeat(100) })).toBe(`${'x'.repeat(60)}-${id}`)
  })

  it('gives back its poll id, whatever words come first', () => {
    expect(pollIdOfSlug(resultSlug({ id, question: 'Mug A or mug B?' }))).toBe(id)
    expect(pollIdOfSlug(id)).toBe(id)
    expect(pollIdOfSlug(`anything-${id}`)).toBe(id)
    for (const slug of ['', 'short', `x${id}`, `${id}-`]) expect(pollIdOfSlug(slug)).toBeNull()
  })

  it('isResultPath picks out result pages only', () => {
    expect(isResultPath(`/results/mug-a-or-mug-b-${id}`)).toBe(true)
    expect(isResultPath(`/results/${id}`)).toBe(true)
    for (const path of ['/', '/results', '/results/', '/p/AAAAAAAAAAAA', '/feed', '/tools/etsy-thumbnail-preview', '/results/a/b']) {
      expect(isResultPath(path)).toBe(false)
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

describe('4. the visit beacon on a result page', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  const path = `/results/which-photo-for-my-ceramic-mug-listing-AbC-dEf_GhIj`

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

  it('loading /results/<slug> sends a visit with path /results/<slug>', () => {
    countVisit(path) // the layout's beacon, on the page load
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/', path }])
  })

  it('once per session per result page, and still after the session’s other visit', () => {
    countVisit('/')
    countVisit(path)
    countVisit(path)
    countVisit('/feed')
    expect(sent().map((b) => b.path ?? null)).toEqual([null, path])
  })

  it('leaves every other page’s visit as it was (no path)', () => {
    countVisit('/p/AAAAAAAAAAAA')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/' }])
  })

  it('sends nothing off production or from automated browsers', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    countVisit(path)
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    vi.stubGlobal('navigator', { webdriver: true })
    sendSignal('visit', path)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the privacy page', () => {
  it('says a published result is public and searchable, and that its visit names the page', () => {
    const text = textOf(renderToString(PrivacyPage()))
    expect(text).toContain('Publish the result when it closes')
    expect(text).toMatch(/search engines/)
    expect(text).toMatch(/published poll result/)
  })
})

/** The commit this branch started from on main, or null where git or main isn't there (a shallow CI checkout). */
function mainBase(): string | null {
  for (const ref of ['main', 'origin/main']) {
    try {
      return execFileSync('git', ['merge-base', 'HEAD', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {}
  }
  return null
}
const base = mainBase()

describe('5. the native app', () => {
  it.skipIf(base === null)('is untouched: no file under mobile/ differs from main, committed or not', () => {
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
    expect(git('diff', '--name-only', base!, '--', 'mobile')).toBe('')
    expect(git('ls-files', '--others', '--exclude-standard', '--', 'mobile')).toBe('')
  })

  it('keeps working against the API: a poll it posts (no publishResult) is created and stays unpublished', async () => {
    const res = await rawCreate({
      headers: { 'content-type': 'application/json', 'x-tiebreak-voter': voter(8).split('=')[1] },
      body: JSON.stringify({ question: 'Hat or no hat?', options: [{ text: 'Hat' }, { text: 'No hat' }], target: 1, durationHours: 24 }),
    })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    expect((await vote(id, 0, voter(9))).body.poll).toMatchObject({ status: 'closed', publishResult: false })
    expect(await outcome(resultSlug({ id, question: 'Hat or no hat?' }))).toBe('NEXT_NOT_FOUND')
  })
})
