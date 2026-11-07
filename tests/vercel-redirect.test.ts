// The leftover Vercel deploy becomes a redirect to the live Workers site (growth, 2026-11-07). Offline checks of
// the config that does it: vercel.json's one rule (every path and query string, 308), a Vercel build that runs
// none of the app's code, so its check can't fail on it, and a Workers build that pins its own address, so every
// public page's canonical URL is on the Workers host and not on the address that now redirects (poll pages and
// the 404 page: tests/canonical-every-page.test.ts). What the deployed sites answer is checked by
// tests/live-site.test.ts, which runs only when asked.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import type { Metadata } from 'next'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PUBLIC_PAGES } from '@/lib/site'
import {
  CANONICAL_PAGE_FILES,
  VERCEL_URL,
  WORKERS_URL,
  canonicalOf,
  offLimitsChanges,
  packageJsonDrift,
  readVercelConfig,
  scriptEnv,
  vercelRedirect,
} from './redirect-to-workers'

const root = new URL('../', import.meta.url)
const config = readVercelConfig()
const pkgText = readFileSync(new URL('package.json', root), 'utf8')
const pkg = JSON.parse(pkgText) as { scripts: Record<string, string> }

describe('vercel.json: the old address sends everyone to the Workers site', () => {
  // Acceptance criterion 1's three requests, then every public page, a poll's share link and its card.
  const PATHS = [
    '/',
    '/polls/abc123',
    '/polls/abc123?src=x',
    ...PUBLIC_PAGES.filter((p) => p !== '/'),
    '/p/AbCdEf_-1234?ref=poll',
    '/p/AbCdEf_-1234/card?v=closed',
    '/sitemap.xml',
    '/pro?session_id=sample-session',
    '/?utm_source=reddit&ref=launch',
  ]

  it.each(PATHS)('%s → 308 to the same path and query string on Workers', (path) => {
    const answer = vercelRedirect(config, path)
    expect(answer).not.toBeNull()
    expect([301, 308]).toContain(answer!.status)
    expect(answer!.location).toBe(`${WORKERS_URL}${path}`)
  })

  it.each(['//evil.example/x', '/@evil.example', '/%2F%2Fevil.example', '/\\evil.example'])(
    'never sends anyone off the Workers host: %s',
    (path) => {
      // The destination's host is fixed and the path only ever follows its slash, so this is no open redirect.
      const location = vercelRedirect(config, path)!.location
      expect(location.startsWith(`${WORKERS_URL}/`)).toBe(true)
      expect(new URL(location).host).toBe(new URL(WORKERS_URL).host)
    },
  )

  it('is permanent and keeps the method: a 308, so the native app’s POSTs to the old API address still arrive', () => {
    // A 301 lets clients turn a POST into a GET; 308 doesn't. mobile/app.json still has the Vercel address.
    expect(vercelRedirect(config, '/polls/abc123/votes')?.status).toBe(308)
    expect(readFileSync(new URL('mobile/app.json', root), 'utf8')).toContain(VERCEL_URL)
  })

  it('is one rule for every host and path, with nothing served or rewritten around it', () => {
    expect(config.redirects).toHaveLength(1)
    const [rule] = config.redirects!
    expect(rule).toEqual({ source: '/:path(.*)', destination: `${WORKERS_URL}/:path`, permanent: true })
    for (const key of ['rewrites', 'routes', 'headers', 'functions', 'crons', 'cleanUrls', 'trailingSlash']) {
      expect(config).not.toHaveProperty(key)
    }
  })

  it('points at the Workers address the tests and the Workers build use', () => {
    expect(scriptEnv(pkg.scripts['cf:build']).NEXT_PUBLIC_SITE_URL).toBe(WORKERS_URL)
    expect(new URL(WORKERS_URL).hostname.endsWith('.workers.dev')).toBe(true)
  })
})

describe('the Vercel build runs none of the app, so its check has nothing to fail on', () => {
  it('builds as a static site (no Next.js preset), installs nothing and builds nothing', () => {
    expect(config.framework).toBeNull()
    expect(config.installCommand).toBe('')
    // One echo, no chained command: no npm, no next build, no env it could miss.
    expect(config.buildCommand).toMatch(/^echo '[^'&;|`$]*'$/)
    expect(config.buildCommand).not.toMatch(/\b(npm|npx|next|node)\b/)
  })

  it('has no other settings that could make a build or a deploy fail', () => {
    expect(Object.keys(config).sort()).toEqual(
      ['$schema', 'buildCommand', 'framework', 'installCommand', 'outputDirectory', 'redirects'].sort(),
    )
  })

  it('serves a committed output directory: one moved-page that links the Workers site', () => {
    const dir = new URL(`${config.outputDirectory}/`, root)
    expect(config.outputDirectory).toBe('vercel-redirect')
    expect(existsSync(new URL('index.html', dir))).toBe(true)
    const html = readFileSync(new URL('index.html', dir), 'utf8')
    expect(html).toContain(`<link rel="canonical" href="${WORKERS_URL}/">`)
    expect(html).toContain(`<a href="${WORKERS_URL}/">`)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${WORKERS_URL}/">`)
    // No scripts or assets: nothing on the old address can load, count or break anything.
    expect(html).not.toMatch(/<script|<img|<iframe|src=/i)
  })
})

describe('the Workers production build pins its own address', () => {
  it('cf:build sets the Workers address and the production env the beacon needs', () => {
    expect(scriptEnv(pkg.scripts['cf:build'])).toEqual({
      NEXT_PUBLIC_DEPLOY_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: WORKERS_URL,
    })
    expect(pkg.scripts['cf:build']).toMatch(/ opennextjs-cloudflare build$/)
  })

  it('npm run deploy builds through cf:build, so a deploy can’t drop either setting', () => {
    expect(pkg.scripts.deploy).toBe('npm run cf:build && opennextjs-cloudflare deploy')
  })
})

describe('built with cf:build’s env, every public page’s canonical URL is on the Workers host', () => {
  type PageModule = { metadata: Metadata }
  const PAGE_MODULES: Record<(typeof PUBLIC_PAGES)[number], () => Promise<PageModule>> = {
    '/': () => import('@/app/page'),
    '/feed': () => import('@/app/feed/page'),
    '/pro': () => import('@/app/pro/page'),
    '/privacy': () => import('@/app/privacy/page'),
    '/terms': () => import('@/app/terms/page'),
    '/pickfu-alternative': () => import('@/app/pickfu-alternative/page'),
    '/which-etsy-photo-is-best': () => import('@/app/which-etsy-photo-is-best/page'),
    '/choose-a-thumbnail-or-book-cover': () => import('@/app/choose-a-thumbnail-or-book-cover/page'),
    '/tools/etsy-thumbnail-preview': () => import('@/app/tools/etsy-thumbnail-preview/page'),
    '/tools/book-cover-thumbnail-test': () => import('@/app/tools/book-cover-thumbnail-test/page'),
    '/tools/youtube-thumbnail-preview': () => import('@/app/tools/youtube-thumbnail-preview/page'),
  }
  const workersHost = new URL(WORKERS_URL).host
  let metadataBase: URL
  const pages = new Map<string, Metadata>()
  let sitemapUrls: string[]
  let robotsSitemap: string | string[] | undefined
  let jsonLdUrl: string

  // NEXT_PUBLIC_* values are inlined when `next build` runs, so the env cf:build sets is what the Worker serves.
  beforeAll(async () => {
    const env = scriptEnv(pkg.scripts['cf:build'])
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', env.NEXT_PUBLIC_SITE_URL ?? '')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
    vi.resetModules()
    metadataBase = (await import('@/app/layout')).metadata.metadataBase as URL
    for (const [path, load] of Object.entries(PAGE_MODULES)) pages.set(path, (await load()).metadata)
    sitemapUrls = (await import('@/app/sitemap')).default().map((e) => e.url)
    robotsSitemap = (await import('@/app/robots')).default().sitemap
    jsonLdUrl = (await import('@/lib/site')).JSON_LD.url
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('covers every page the sitemap lists', () => {
    expect(Object.keys(PAGE_MODULES).sort()).toEqual([...PUBLIC_PAGES].sort())
  })

  it.each([...PUBLIC_PAGES])('%s: canonical and og:url on the Workers host, at its own path', (path) => {
    const { alternates, openGraph } = pages.get(path)!
    expect(alternates?.canonical).toBe(path)
    // How Next writes <link rel="canonical">: the page's path against the layout's metadataBase.
    const canonical = new URL(alternates!.canonical as string, metadataBase)
    expect(canonical.host).toBe(workersHost)
    expect(canonical.protocol).toBe('https:')
    expect(canonical.pathname).toBe(path)
    expect(new URL((openGraph as { url: string }).url, metadataBase).host).toBe(workersHost)
  })

  it('the sitemap, robots.txt and the structured data point at the Workers host too', () => {
    expect(sitemapUrls).toHaveLength(PUBLIC_PAGES.length)
    for (const url of sitemapUrls) expect(new URL(url).host).toBe(workersHost)
    expect(robotsSitemap).toBe(`${WORKERS_URL}/sitemap.xml`)
    expect(jsonLdUrl).toBe(WORKERS_URL)
  })
})

describe('canonicalOf (reads the live pages in tests/live-site.test.ts)', () => {
  it('finds the canonical link in any attribute order, and unescapes &amp;', () => {
    expect(canonicalOf(`<head><link rel="icon" href="/x"/><link rel="canonical" href="${WORKERS_URL}/pro"/></head>`)).toBe(
      `${WORKERS_URL}/pro`,
    )
    expect(canonicalOf(`<link href="${WORKERS_URL}/?a=1&amp;b=2" rel="canonical">`)).toBe(`${WORKERS_URL}/?a=1&b=2`)
  })
  it('is null when a page has none', () => {
    expect(canonicalOf('<head><link rel="icon" href="/favicon.ico"/></head>')).toBeNull()
  })
})

describe('what this change may touch', () => {
  it('flags the web app’s source, its runtime config and dependencies, and the native app', () => {
    expect(
      offLimitsChanges([
        'vercel.json',
        'vercel-redirect/index.html',
        'tests/vercel-redirect.test.ts',
        'GROWTH.md',
        'app/page.tsx',
        'app/p/[id]/poll-view.tsx',
        'lib/site.ts',
        'mobile/app.json',
        'next.config.ts',
        'wrangler.jsonc',
        'package-lock.json',
      ]),
    ).toEqual([
      'app/page.tsx',
      'app/p/[id]/poll-view.tsx',
      'lib/site.ts',
      'mobile/app.json',
      'next.config.ts',
      'wrangler.jsonc',
      'package-lock.json',
    ])
  })

  it('lets through only the two pages criterion 5 needs: a poll page’s canonical and the 404 page’s', () => {
    expect(CANONICAL_PAGE_FILES).toEqual(['app/p/[id]/page.tsx', 'app/not-found.tsx'])
    expect(offLimitsChanges(['vercel.json', ...CANONICAL_PAGE_FILES, 'app/p/[id]/card/route.ts'])).toEqual([
      'app/p/[id]/card/route.ts',
    ])
  })

  it('in package.json, allows only the two Workers build scripts to change', () => {
    const base = { name: 'x', scripts: { build: 'next build', 'cf:build': 'a', deploy: 'b' }, dependencies: { next: '1' } }
    const ok = { ...base, scripts: { ...base.scripts, 'cf:build': 'c', deploy: 'd' } }
    expect(packageJsonDrift(JSON.stringify(base), JSON.stringify(ok))).toEqual([])
    const bad = { ...base, scripts: { ...base.scripts, build: 'echo' }, dependencies: { next: '2' } }
    expect(packageJsonDrift(JSON.stringify(base), JSON.stringify(bad))).toEqual(['dependencies', 'scripts.build'])
  })

  // Against the branch this PR goes into: `PR_BASE=main npx vitest run tests/vercel-redirect.test.ts`.
  // Opt-in, because once merged any later feature branch rightly changes the app.
  it.runIf(process.env.PR_BASE)('this branch changes no file under app/ but the two canonical pages, lib/ or mobile/ (vs PR_BASE)', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    const base = git('merge-base', 'HEAD', process.env.PR_BASE!).trim()
    const changed = [
      ...git('diff', '--name-only', base).split('\n'),
      ...git('ls-files', '--others', '--exclude-standard').split('\n'),
    ].filter(Boolean)
    expect(changed).toContain('vercel.json')
    expect(offLimitsChanges(changed)).toEqual([])
    expect(packageJsonDrift(git('show', `${base}:package.json`), pkgText)).toEqual([])
  })
})
