// Acceptance criterion 5 of the move to Workers (GROWTH.md 2026-11-07): every page on the Workers site has a
// <link rel="canonical"> on the Workers host. tests/vercel-redirect.test.ts checks the 11 public pages the sitemap
// lists; this file checks the rest: a poll's share link (/p/:id, where shared links, the feed and the redirected
// old poll links land) and the 404 page. It also lists every page file under app/, so a page added without a
// canonical URL fails here instead of going live without one. tests/live-site.test.ts reads the live HTML.
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Metadata } from 'next'
import { renderToString } from 'react-dom/server'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { metadata as layoutMetadata } from '@/app/layout'
import NotFound, { metadata as notFoundMetadata } from '@/app/not-found'
import PollPage, { generateMetadata as pollMetadata } from '@/app/p/[id]/page'
import { PUBLIC_PAGES } from '@/lib/site'
import { basicPoll, createPoll, useTestDb, vote, voter } from './helpers'
import { WORKERS_URL } from './redirect-to-workers'

// The whole file runs with the env cf:build bakes into the Worker (NEXT_PUBLIC_* are inlined at build time), set
// before any app module reads it.
await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs')
  const { scriptEnv } = await import('./redirect-to-workers')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>
  }
  for (const [name, value] of Object.entries(scriptEnv(pkg.scripts['cf:build']))) vi.stubEnv(name, value)
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
})

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

useTestDb()

afterAll(() => {
  vi.unstubAllEnvs()
})

const workersHost = new URL(WORKERS_URL).host

/** The href Next writes in a page's <link rel="canonical">: its canonical path against the layout's metadataBase. */
function canonicalHref(metadata: Metadata): URL | null {
  const canonical = metadata.alternates?.canonical
  if (typeof canonical !== 'string') return null
  return new URL(canonical, layoutMetadata.metadataBase as URL)
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('every page under app/ is one that sets a canonical URL', () => {
  // Every file Next renders as an HTML page: page.*, and the 404 page (not-found.*, global-not-found.*).
  const appDir = fileURLToPath(new URL('../app/', import.meta.url))
  const pageFiles = readdirSync(appDir, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => /(^|\/)(page|not-found|global-not-found)\.(tsx|ts|jsx|js|mdx)$/.test(file))

  it('the public pages (tests/vercel-redirect.test.ts), a poll page and the 404 page, and nothing else', () => {
    const publicFiles = PUBLIC_PAGES.map((path) => (path === '/' ? 'page.tsx' : `${path.slice(1)}/page.tsx`))
    expect(pageFiles.sort()).toEqual([...publicFiles, 'p/[id]/page.tsx', 'not-found.tsx'].sort())
  })

  it('the layout sets none, so no page inherits another page’s canonical URL', () => {
    expect(layoutMetadata.alternates).toBeUndefined()
    expect((layoutMetadata.metadataBase as URL).href).toBe(`${WORKERS_URL}/`)
  })
})

describe('a poll’s share link (/p/:id), built with cf:build’s env', () => {
  it('has a canonical URL on the Workers host at the poll’s own address, and og:url to match', async () => {
    const { body } = await createPoll(basicPoll, voter(1))
    const meta = await pollMetadata(params(body.id))
    const href = canonicalHref(meta)
    expect(href?.host).toBe(workersHost)
    // No `?new=1` or `?ref=poll` from the link that was shared: one address per poll.
    expect(href?.href).toBe(`${WORKERS_URL}/p/${body.id}`)
    expect(new URL((meta.openGraph as { url: string }).url, href!).href).toBe(href!.href)
    // Still kept out of search: the canonical names its address, it doesn't invite indexing.
    expect(meta.robots).toMatchObject({ index: false, follow: false })
  })

  it('keeps the same canonical URL once the poll closes, when its card shows the result', async () => {
    const { body } = await createPoll({ ...basicPoll, target: 1 }, voter(1))
    await vote(body.id, 0, voter(2))
    expect(canonicalHref(await pollMetadata(params(body.id)))?.href).toBe(`${WORKERS_URL}/p/${body.id}`)
  })

  it.each(['x?y=1', 'x#y', '../x', '//evil.example'])(
    'an id can’t add a query, a fragment, another path or another host: %s',
    async (id) => {
      const href = canonicalHref(await pollMetadata(params(id)))!
      expect(href.host).toBe(workersHost)
      expect(href.search + href.hash).toBe('')
      expect(href.pathname).toBe(`/p/${encodeURIComponent(id)}`)
    },
  )
})

describe('the 404 page (any unknown address, and a poll that doesn’t exist), built with cf:build’s env', () => {
  it('has a canonical URL on the Workers host: the home page, since a missing page has no address of its own', () => {
    // How Next builds a 404's head (next/dist/lib/metadata/resolve-metadata.js): the layouts' metadata, then the
    // nearest not-found module's, never the metadata of the page that called notFound().
    expect(canonicalHref(notFoundMetadata)?.href).toBe(`${WORKERS_URL}/`)
    expect(notFoundMetadata.title).toBe('Page not found')
  })

  it('is what a poll that doesn’t exist renders', async () => {
    await expect(PollPage({ ...params('AAAAAAAAAAAA'), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('says the page is missing and links to posting a poll and to the feed', () => {
    const html = renderToString(NotFound())
    expect(html).toContain('<h1>Page not found</h1>')
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/feed"')
  })
})
