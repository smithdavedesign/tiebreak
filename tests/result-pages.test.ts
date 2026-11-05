// Opt-in public result pages (GROWTH.md, 2026-11-05). A creator ticks "Publish the result when it closes" on the
// new-poll form; once the poll closes, /results/<slug> is a page titled with its question (title and h1), whose
// description states the winner and the vote count, with every option's split and a "Make your own tiebreak" link,
// and /sitemap.xml lists it. Open, un-opted, unanswered and report-hidden polls are a 404 and stay out of the
// sitemap; a private (Pro) poll can't be published at all (400). The page sends its own visit, with its path.
// The same page, the beacon and the sitemap in Chromium against the dev server: tests/result-pages-browser.test.ts.
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fromPglite, setDb, type Db } from '@/lib/db'
import { REPORTS_TO_HIDE } from '@/lib/limits'
import { sendSignal } from '@/lib/beacon'
import { isResultPath, pollIdOfSlug, resultPath, resultSlug } from '@/lib/results'
import { PUBLIC_PAGES, SIGNAL_URL, SITE_URL } from '@/lib/site'
import {
  accountIdOf,
  basicPoll,
  createPoll,
  getPoll,
  makePro,
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
}))

const { default: ResultPage, generateMetadata } = await import('@/app/results/[slug]/page')
const { ResultVisit } = await import('@/app/results/[slug]/result-visit')
const { default: PollPage } = await import('@/app/p/[id]/page')
const { countVisit } = await import('@/app/visit-beacon')
const home = await import('@/app/page')
const sitemap = (await import('@/app/sitemap')).default

const pg = useTestDb()

const QUESTION = 'Which book cover should I use for my cozy mystery?'
const RED = 'Red cover, gold title'
const NAVY = 'Navy cover, white title'
const published = { ...basicPoll, question: QUESTION, options: [RED, NAVY], publishResult: true }

/** Posts a poll as voter 1 and returns its id (201 expected). */
async function post(body: Record<string, unknown>, as = voter(1)) {
  const { res, body: created } = await createPoll(body, as)
  expect(res.status).toBe(201)
  return created.id as string
}

/** Strangers vote these options in turn; with the target reached, the poll closes. */
async function votes(id: string, options: number[]) {
  for (const [i, option] of options.entries()) expect((await vote(id, option, voter(1000 + i))).res.status).toBe(201)
}

/** An opted-in poll, closed at 3 votes: Navy wins 2 to 1. */
async function closedPublished(overrides: Record<string, unknown> = {}) {
  const id = await post({ ...published, ...overrides })
  await votes(id, [1, 0, 1])
  return id
}

const slugOf = async (id: string) => resultSlug({ id, question: (await getPoll(id)).body.poll.question })
const pathOf = async (id: string) => `/results/${await slugOf(id)}`
const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

/** The page's HTML, with React's text-node separators taken out. */
async function render(slug: string) {
  return renderToString((await ResultPage(params(slug))) as ReactElement).replace(/<!-- -->/g, '')
}

/** A deadline that passed an hour ago, without anyone reading the poll since (it's still 'open' in the table). */
async function expire(id: string) {
  await pg().query(`UPDATE polls SET closes_at = now() - interval '1 hour' WHERE id = $1`, [id])
}

/** Files `reports` reports on a poll, from distinct accounts (`from` skips the ones already used). */
async function hide(id: string, reports = REPORTS_TO_HIDE, from = 0) {
  for (let i = from; i < from + reports; i++) expect((await report(id, voter(2000 + i))).res.status).toBe(201)
}

describe('the create-poll form', () => {
  it('has a "Publish the result when it closes" checkbox, off by default', async () => {
    cookie = undefined
    const html = renderToString(await home.default())
    const box = html.match(/<label class="check"><input type="checkbox"([^>]*)\/?><span>Publish the result when it closes/)
    expect(box).not.toBeNull()
    expect(box![1]).not.toMatch(/checked/)
    expect(box![1]).not.toMatch(/disabled/)
    expect(html).toContain('it gets a public page of its own, which search engines can list')
  })
})

describe('POST /polls with publishResult', () => {
  it('is off unless asked for', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    expect(body.poll.publishResult).toBe(false)
    expect((await getPoll(body.id)).body.poll.publishResult).toBe(false)
  })

  it('is on when asked for, for a link-only or a public poll', async () => {
    const { res, body } = await createPoll(published, voter(1))
    expect(res.status).toBe(201)
    expect(body.poll.publishResult).toBe(true)
    expect((await getPoll(body.id)).body.poll.publishResult).toBe(true)
  })

  it('must be true or false', async () => {
    for (const publishResult of ['yes', 1, null, {}]) {
      const { res, body } = await createPoll({ ...published, publishResult }, voter(1))
      expect(res.status).toBe(400)
      expect(body.error).toMatch(/publishResult/)
    }
  })

  it('needs a question, since the page is titled with it', async () => {
    for (const question of ['', '   ']) {
      const { res, body } = await createPoll({ ...published, question }, voter(1))
      expect(res.status).toBe(400)
      expect(body.error).toMatch(/question/)
    }
    expect((await createPoll({ ...published, question: '', publishResult: false }, voter(1))).res.status).toBe(201)
  })

  describe('a private (Pro) poll', () => {
    useFakeStripe()

    it("can't be published: 400 for a Pro account, and no poll is made", async () => {
      const me = voter(7)
      await makePro(me)
      const { res, body } = await createPoll({ ...published, visibility: 'private' }, me)
      expect(res.status).toBe(400)
      expect(body.error).toMatch(/private/i)
      const { rows } = await pg().query('SELECT id FROM polls WHERE creator_id = $1', [accountIdOf(me)])
      expect(rows).toHaveLength(0)
      // The same account can still post a private poll, unpublished.
      expect((await createPoll({ ...published, visibility: 'private', publishResult: false }, me)).res.status).toBe(201)
    })

    it('is a 400 (not the 403 for Pro) for a free account too', async () => {
      const { res } = await createPoll({ ...published, visibility: 'private' }, voter(8))
      expect(res.status).toBe(400)
    })

    it('the database refuses a published private poll even if the check were skipped', async () => {
      await expect(
        pg().query(
          `INSERT INTO polls (id, question, options, target, closes_at, created_at, visibility, publish_result)
           VALUES ('privAAAAAAAA', 'q', '[]'::jsonb, 3, now(), now(), 'private', true)`,
        ),
      ).rejects.toThrow(/polls_publish_result_check/)
    })
  })
})

describe('/results/<slug> for a closed, opted-in poll', () => {
  it('has a <title> and an h1 equal to the question, and its own canonical URL', async () => {
    const id = await closedPublished()
    const slug = await slugOf(id)
    const metadata = await generateMetadata(params(slug))
    expect(metadata.title).toEqual({ absolute: QUESTION })
    expect(metadata.alternates?.canonical).toBe(`/results/${slug}`)
    expect(metadata.robots).toBeUndefined() // indexable, unlike the /p/:id share page
    const html = await render(slug)
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    expect(html).toContain(`<h1>${QUESTION}</h1>`)
  })

  it('has a description stating the winner and the vote count', async () => {
    const id = await closedPublished()
    const { description } = await generateMetadata(params(await slugOf(id)))
    expect(description).toContain(`Winner: ${NAVY}`)
    expect(description).toContain('2 of 3 votes')
    expect(description!.length).toBeLessThan(300)
  })

  it('shows every option with its vote split, the winner marked, and links to make your own', async () => {
    const id = await closedPublished()
    const html = await render(await slugOf(id))
    expect(html).toContain(`Winner: B · ${NAVY}`)
    expect(html).toContain(`<span>A · ${RED}</span><span>1 vote (33%)</span>`)
    expect(html).toContain(`<span>B · ${NAVY}</span><span>2 votes (67%)</span>`)
    expect(html).toMatch(new RegExp(`<li class="result-option win">.*B · ${NAVY}`))
    expect(html).toMatch(/<a class="button" href="\/\?ref=results">Make your own tiebreak<\/a>/)
    expect(html).toContain('Closed')
    expect(html).toContain('3 votes')
  })

  it('shows each option’s photo, and labels a photo-only option by its letter', async () => {
    const photo = (n: number) => `https://images.example.com/cover-${n}.jpg`
    const id = await post({
      ...published,
      options: [{ text: 'Red', imageUrl: photo(1) }, { imageUrl: photo(2) }, { text: 'Green' }, { text: 'Gold', imageUrl: photo(4) }],
      target: 4,
    })
    await votes(id, [1, 1, 3, 0])
    const html = await render(await slugOf(id))
    for (const n of [1, 2, 4]) expect(html).toContain(`src="${photo(n)}"`)
    expect(html).toContain('<span>B · Option B</span><span>2 votes (50%)</span>')
    expect(html).toContain('<span>C · Green</span><span>0 votes (0%)</span>')
    const { description } = await generateMetadata(params(await slugOf(id)))
    expect(description).toContain('Winner: Option B, with 2 of 4 votes (50%)')
  })

  it('says so when it closed on a tie', async () => {
    const id = await post({ ...published, target: 2 })
    await votes(id, [0, 1])
    const slug = await slugOf(id)
    expect((await generateMetadata(params(slug))).description).toContain(`It's a tie: ${RED} and ${NAVY}, 1 vote each, out of 2 votes`)
    expect(await render(slug)).toContain('It&#x27;s a tie.')
  })

  it('a poll that ran out of time with votes is published once its deadline passes', async () => {
    const id = await post(published)
    await votes(id, [1])
    await expect(render(await slugOf(id))).rejects.toThrow('NEXT_NOT_FOUND') // still open
    await expire(id)
    const html = await render(await slugOf(id))
    expect(html).toContain('Winner: B')
    expect(html).toContain('1 vote (100%)')
  })

  it('escapes the question and options as text', async () => {
    const question = 'Which <script>alert(1)</script> cover?'
    const id = await closedPublished({ question })
    const html = await render(await slugOf(id))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('has a report button, since 3 reports take the page down', async () => {
    const id = await closedPublished()
    expect(await render(await slugOf(id))).toMatch(/<button type="button" class="link">Report<\/button>/)
  })
})

describe('/results/<slug> is a 404', () => {
  const notFound = async (slug: string) => {
    await expect(render(slug)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(generateMetadata(params(slug))).rejects.toThrow('NEXT_NOT_FOUND')
  }

  it('for an open poll', async () => {
    const id = await post(published)
    await votes(id, [0, 1])
    await notFound(await slugOf(id))
  })

  it('for a closed poll whose creator didn’t opt in', async () => {
    const id = await post({ ...published, publishResult: false })
    await votes(id, [1, 0, 1])
    expect((await getPoll(id)).body.poll.status).toBe('closed')
    await notFound(await slugOf(id))
  })

  it(`for a poll hidden by ${REPORTS_TO_HIDE} reports (and not for one fewer)`, async () => {
    const id = await closedPublished()
    const slug = await slugOf(id)
    await hide(id, REPORTS_TO_HIDE - 1)
    expect(await render(slug)).toContain(`<h1>${QUESTION}</h1>`)
    await hide(id, 1, REPORTS_TO_HIDE - 1)
    await notFound(slug)
  })

  it('for a poll that closed without a vote', async () => {
    const id = await post(published)
    await expire(id)
    expect((await getPoll(id)).body.poll.status).toBe('no_result')
    await notFound(await slugOf(id))
  })

  it('for a slug whose words aren’t the question’s, an unknown id, or garbage', async () => {
    const id = await closedPublished()
    await notFound(`which-cover-${id}`)
    await notFound(id)
    await notFound(`which-book-cover-should-i-use-for-my-cozy-mystery-AAAAAAAAAAAA`)
    await notFound('')
    await notFound('not-a-poll')
    await notFound(`${await slugOf(id)}/x`)
  })
})

describe('/sitemap.xml', () => {
  it('lists only opted-in, closed, unhidden polls, after the public pages', async () => {
    const listed = await closedPublished()
    const ranOut = await post({ ...published, question: 'Which mug photo?' }) // closes by deadline, never read since
    await votes(ranOut, [0])
    await expire(ranOut)
    const open = await post({ ...published, question: 'Open poll?' })
    const unopted = await post({ ...published, question: 'Not published?', publishResult: false })
    await votes(unopted, [0, 0, 1])
    const hidden = await closedPublished({ question: 'Reported poll?' })
    await hide(hidden)
    const empty = await post({ ...published, question: 'Nobody voted?' })
    await expire(empty)

    const entries = await sitemap()
    const urls = entries.map((e) => e.url)
    const statics = PUBLIC_PAGES.map((p) => `${SITE_URL}${p === '/' ? '' : p}`)
    expect(urls.slice(0, statics.length)).toEqual(statics)
    expect(urls.slice(statics.length).sort()).toEqual([`${SITE_URL}${await pathOf(listed)}`, `${SITE_URL}${await pathOf(ranOut)}`].sort())
    for (const id of [open, unopted, hidden, empty]) expect(urls.join(' ')).not.toContain(id)
    const entry = entries.find((e) => e.url.endsWith(listed))!
    expect(entry.lastModified).toBeTruthy()
  })

  it('every listed page answers 200', async () => {
    const ids = [await closedPublished(), await closedPublished({ question: 'Which thumbnail?' })]
    const statics = PUBLIC_PAGES.length
    const paths = (await sitemap()).slice(statics).map((e) => new URL(e.url).pathname)
    expect(paths).toHaveLength(ids.length)
    for (const path of paths) expect(await render(path.replace('/results/', ''))).toMatch(/<h1>/)
  })

  it('still lists the public pages if the database is down', async () => {
    const inner = fromPglite(pg())
    const failing: Db = {
      query: (text, values) => (/publish_result/.test(text) ? Promise.reject(new Error('connection refused')) : inner.query(text, values)),
      transaction: inner.transaction,
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await setDb(failing)
      const urls = (await sitemap()).map((e) => e.url)
      expect(urls).toEqual(PUBLIC_PAGES.map((p) => `${SITE_URL}${p === '/' ? '' : p}`))
      expect(logged).toHaveBeenCalled()
    } finally {
      logged.mockRestore()
      await setDb(inner)
    }
  })
})

describe('the poll page of a published poll', () => {
  const renderPoll = async (id: string) =>
    renderToString((await PollPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })) as ReactElement).replace(/<!-- -->/g, '')

  it('links to the result page once the poll has closed', async () => {
    const id = await closedPublished()
    cookie = undefined
    expect(await renderPoll(id)).toContain(`href="${await pathOf(id)}"`)
  })

  it('tells the creator, while it is open, that the result will be published', async () => {
    const id = await post(published)
    cookie = accountIdOf(voter(1))
    const html = await renderPoll(id)
    cookie = undefined
    expect(html).toContain('the result gets its own public page')
    expect(html).not.toContain('/results/')
  })

  it('says nothing about it for a poll that isn’t published', async () => {
    const id = await post({ ...published, publishResult: false })
    await votes(id, [0, 0, 1])
    expect(await renderPoll(id)).not.toContain('/results/')
  })
})

describe('result page addresses', () => {
  it('are the question’s words, then the poll id', () => {
    expect(resultSlug({ id: 'AbC123xyz_-0', question: 'Which book cover? Red or navy!' })).toBe('which-book-cover-red-or-navy-AbC123xyz_-0')
    expect(resultSlug({ id: 'AbC123xyz_-0', question: 'Café crème — or thé?' })).toBe('cafe-creme-or-the-AbC123xyz_-0')
    expect(resultPath({ id: '-bC123xyz_-0', question: 'Is a hot dog a sandwich?' })).toBe('/results/is-a-hot-dog-a-sandwich--bC123xyz_-0')
  })

  it('are just the id when the question has no letters or digits to use', () => {
    expect(resultSlug({ id: 'AbC123xyz_-0', question: '🙂 ？' })).toBe('AbC123xyz_-0')
  })

  it('keep at most 60 characters of words, cut between words', () => {
    const question = 'Which of these two very similar photographs of a handmade ceramic mug should lead my listing?'
    const words = resultSlug({ id: 'AbC123xyz_-0', question }).slice(0, -'-AbC123xyz_-0'.length)
    expect(words.length).toBeLessThanOrEqual(60)
    expect(question.toLowerCase().replace(/[^a-z0-9]+/g, '-')).toContain(`${words}-`)
    expect(words).toBe('which-of-these-two-very-similar-photographs-of-a-handmade')
  })

  it('give back the poll id, and nothing for anything shorter than one', () => {
    expect(pollIdOfSlug('which-book-cover-AbC123xyz_-0')).toBe('AbC123xyz_-0')
    expect(pollIdOfSlug('AbC123xyz_-0')).toBe('AbC123xyz_-0')
    expect(pollIdOfSlug('short')).toBeNull()
    expect(pollIdOfSlug('which-cover-AbC12!xyz_-0')).toBeNull()
  })

  it('isResultPath picks out result pages only', () => {
    expect(isResultPath('/results/which-cover-AbC123xyz_-0')).toBe(true)
    for (const path of ['/', '/results', '/results/', '/p/AbC123xyz_-0', '/tools/etsy-thumbnail-preview', '/results/a/b']) {
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

/** Every element in a server component's tree, depth first. */
function elementsOf(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf)
  if (!isValidElement(node)) return []
  const { children } = node.props as { children?: ReactNode }
  return [node, ...elementsOf(children)]
}

describe('the visit beacon on a result page', () => {
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

  it('the page mounts its own visit, carrying /results/<slug>', async () => {
    const id = await closedPublished()
    const slug = await slugOf(id)
    const visits = elementsOf((await ResultPage(params(slug))) as ReactElement).filter((e) => e.type === ResultVisit)
    expect(visits.map((e) => (e.props as { path: string }).path)).toEqual([`/results/${slug}`])
  })

  it('a visit to it carries its path, once per session, and the layout’s beacon leaves it to the page', () => {
    const path = '/results/which-book-cover-AbC123xyz_-0'
    countVisit(path) // the layout's beacon: nothing, the page sends its own
    sendSignal('visit', path)
    sendSignal('visit', path)
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/', path }])
  })

  it('every other page still counts through the layout’s beacon, without a path', () => {
    countVisit('/p/AbC123xyz_-0')
    expect(sent()).toEqual([{ slug: 'tiebreak', kind: 'visit', referrer: 'https://www.google.com/' }])
  })
})

describe('upgrading a database from before result pages', () => {
  it('adds the column (every earlier poll unpublished), its check and its index', async () => {
    const id = await post({ ...published, publishResult: false })
    await pg().query('DROP INDEX polls_published_idx')
    await pg().query('ALTER TABLE polls DROP COLUMN publish_result')
    await setDb(fromPglite(pg()))
    expect((await getPoll(id)).body.poll.publishResult).toBe(false)
    const { rows } = await pg().query<{ ready: boolean }>(`SELECT to_regclass('polls_published_idx') IS NOT NULL AS ready`)
    expect(rows[0].ready).toBe(true)
    await expect(
      pg().query(`UPDATE polls SET visibility = 'private', publish_result = true WHERE id = $1`, [id]),
    ).rejects.toThrow(/polls_publish_result_check/)
  })
})
