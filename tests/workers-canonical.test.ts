// Criterion 5 offline: every page the app has names a canonical URL on the Workers host. The app is loaded the way
// the Worker is built: with the variables its build script sets and nothing else, so no NEXT_PUBLIC_SITE_URL and no
// Vercel production domain, and the address comes from the app itself (lib/site.ts). The indexable pages (the
// sitemap's) each name their own address. A poll page (someone's share link) names its own address too, without
// tags like ?ref=, and stays noindex. Every 404 (a missing poll, an unknown address) names the home page: Next renders
// one 404 page for all of them, so it can't name the address asked for. The rendered HTML is checked in
// tests/zz-debug-browser.test.ts, and the live site in tests/live-site.test.ts.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Metadata } from 'next'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { WORKERS_URL } from './workers-move'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), notFound: () => {} }))

const scripts = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts
/** The scripts that build the Worker (`opennextjs-cloudflare build`), deploy included. */
const WORKER_BUILDS = Object.keys(scripts).filter((name) => scripts[name].includes('opennextjs-cloudflare build'))

/** The environment a build script runs its build in: the shell's, minus any site address, plus what it sets itself. */
function stubBuildEnv(script: string) {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined)
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', undefined)
  const assignments = scripts[script].match(/^(?:\s*[A-Z_][A-Z0-9_]*=\S*)*/)![0]
  for (const [, name, value] of assignments.matchAll(/([A-Z_][A-Z0-9_]*)=(\S*)/g)) vi.stubEnv(name, value)
}

// The app reads its address when lib/site loads, so the build's environment is set before anything from it is imported.
stubBuildEnv('cf:build')
afterAll(() => {
  vi.unstubAllEnvs()
})
const { JSON_LD, PUBLIC_PAGES, SITE_URL } = await import('@/lib/site')
const { metadata: layout } = await import('@/app/layout')
const { metadata: notFound } = await import('@/app/not-found')
const sitemap = (await import('@/app/sitemap')).default
const robots = (await import('@/app/robots')).default
const { generateMetadata: pollMetadata } = await import('@/app/p/[id]/page')
const { basicPoll, createPoll, useTestDb, voter } = await import('./helpers')

useTestDb()

const appDir = fileURLToPath(new URL('../app/', import.meta.url))
const appFiles = (readdirSync(appDir, { recursive: true }) as string[]).map((file) => file.split('\\').join('/'))
/** Every page route under app/: each page.tsx's folder path, `[id]` segments as they are. */
const pageRoutes = appFiles
  .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
  .map((file) => `/${file.slice(0, -'page.tsx'.length)}`.replace(/\/$/, '') || '/')
  .sort()

/** Where a page's canonical link points: its `alternates.canonical`, resolved against the layout's metadataBase. */
const canonicalOf = (metadata: Metadata) => {
  const canonical = metadata.alternates?.canonical
  return typeof canonical === 'string' ? new URL(canonical, layout.metadataBase!).href : null
}

/** The `metadata` a public page exports (all of them are static). */
async function publicPageMetadata(path: string): Promise<Metadata> {
  const module = (await import(/* @vite-ignore */ `@/app${path === '/' ? '' : path}/page`)) as { metadata: Metadata }
  return module.metadata
}

describe('criterion 5: every page on the Workers site has a canonical URL on its host', () => {
  it.each(WORKER_BUILDS)('npm run %s bakes in the Workers address, with no NEXT_PUBLIC_SITE_URL set by hand', async (script) => {
    vi.resetModules()
    stubBuildEnv(script)
    expect((await import('@/lib/site')).SITE_URL).toBe(WORKERS_URL)
  })

  it('a custom domain still wins when NEXT_PUBLIC_SITE_URL is set', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://tiebreak.example/')
    expect((await import('@/lib/site')).SITE_URL).toBe('https://tiebreak.example')
    stubBuildEnv('cf:build')
  })

  it('the app built by cf:build is on the Workers address', () => {
    expect(WORKER_BUILDS).toContain('cf:build')
    expect(SITE_URL).toBe(WORKERS_URL)
    expect(String(layout.metadataBase)).toBe(`${WORKERS_URL}/`)
  })

  it('knows every page the app has: the public pages, the poll page and the one 404 page', () => {
    expect(pageRoutes).toEqual([...PUBLIC_PAGES, '/p/[id]'].sort())
    expect(appFiles.filter((file) => /(^|\/)(global-)?not-found\.[jt]sx?$/.test(file))).toEqual(['not-found.tsx'])
  })

  it.each([...PUBLIC_PAGES])('%s names itself on the Workers host', async (path) => {
    expect(canonicalOf(await publicPageMetadata(path))).toBe(new URL(path, WORKERS_URL).href)
  })

  it('a poll page names itself on the Workers host, and is kept out of search', async () => {
    const { body } = await createPoll({ ...basicPoll, question: 'Speckled mug or white mug?' }, voter(1))
    const metadata = await pollMetadata({ params: Promise.resolve({ id: body.id }) })
    expect(canonicalOf(metadata)).toBe(`${WORKERS_URL}/p/${body.id}`)
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
  })

  it('every 404 (a missing poll, an unknown address) names the home page on the Workers host', () => {
    expect(canonicalOf(notFound)).toBe(`${WORKERS_URL}/`)
  })

  it('the layout sets no canonical URL, so a new page without its own fails the checks above', () => {
    expect(layout.alternates).toBeUndefined()
  })

  it('the sitemap lists exactly the indexable pages, on the Workers host; robots.txt points at it', () => {
    expect(sitemap().map((entry) => new URL(entry.url).href)).toEqual(PUBLIC_PAGES.map((path) => new URL(path, WORKERS_URL).href))
    expect(robots().sitemap).toBe(`${WORKERS_URL}/sitemap.xml`)
  })

  it('the structured data names the Workers site, with Pro on it', () => {
    expect(JSON_LD.url).toBe(WORKERS_URL)
    expect(JSON_LD.offers.url).toBe(`${WORKERS_URL}/pro`)
  })
})
