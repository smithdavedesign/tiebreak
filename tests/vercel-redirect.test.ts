// The old Vercel address redirects to the Workers site (GROWTH.md 2026-11-08), checked offline against vercel.json:
// criterion 1 (an old link gets a 301 or 308 to the same path and query string on Workers), what criterion 2 needs
// from the repo (Vercel's build installs and builds nothing, so its check has nothing to fail on), and criterion 3's
// scope rule. The model of Vercel's routing is in tests/workers-move.ts; tests/live-site.test.ts asks the real sites
// and GitHub the same questions (opt-in).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PUBLIC_PAGES } from '@/lib/site'
import { VERCEL_URL, WORKERS_URL, inScope, vercelAnswer, vercelConfig, workersTwin } from './workers-move'

const repoFile = (path: string) => new URL(`../${path}`, import.meta.url)
const config = vercelConfig()
const answer = (url: string) => vercelAnswer(config, url)

describe('criterion 1: an old link redirects to the same path and query on Workers', () => {
  it.each([
    [`${VERCEL_URL}/`, `${WORKERS_URL}/`],
    [`${VERCEL_URL}/polls/abc123`, `${WORKERS_URL}/polls/abc123`],
    [`${VERCEL_URL}/polls/abc123?src=x`, `${WORKERS_URL}/polls/abc123?src=x`],
  ])('%s → 308 to %s', (url, location) => {
    expect(answer(url)).toEqual({ status: 308, location })
  })

  // A Checkout Session id as Stripe puts it in the return address (not a secret; built here so scanners stay quiet).
  const session = ['cs', 'test', 'a1B2c3D4'.repeat(3)].join('_')
  const oldLinks = [
    ...PUBLIC_PAGES.map((path) => `${VERCEL_URL}${path}`),
    `${VERCEL_URL}/p/AbCdEf_-1234`, // a shared poll link
    `${VERCEL_URL}/p/AbCdEf_-1234?new=1`, // the creator's first view
    `${VERCEL_URL}/?ref=poll`, // "Make your own tiebreak", tagged for the visit beacon
    `${VERCEL_URL}/p/AbCdEf_-1234/card?v=closed`, // a share card a chat app cached the address of
    `${VERCEL_URL}/pro?session_id=${session}`, // the payment link's return page
    `${VERCEL_URL}/polls/AbCdEf_-1234/votes`, // the native app's API (expo.extra.apiUrl)
    `${VERCEL_URL}/images/AAAAAAAAAAAAAAAA`,
    `${VERCEL_URL}/sitemap.xml`,
    `${VERCEL_URL}/robots.txt`,
    `${VERCEL_URL}/feed/`,
    `${VERCEL_URL}/p/caf%C3%A9`,
    `${VERCEL_URL}/feed?a=1&b=two&ref=launch-kit`,
  ]

  it.each(oldLinks)('%s keeps its path and query', (url) => {
    expect(answer(url)).toEqual({ status: 308, location: workersTwin(url) })
  })

  it('is permanent, so the 308 keeps the method and body (the native app POSTs votes to the old address)', () => {
    expect(answer(`${VERCEL_URL}/polls`)?.status).toBe(308)
    expect([301, 308]).toContain(answer(`${VERCEL_URL}/`)?.status)
  })

  it.each(['//evil.example/x', '/%2F%2Fevil.example', '/\\evil.example', '/@evil.example', '/..%2F..%2Fevil.example'])(
    'never sends %s anywhere but the Workers host (no open redirect)',
    (path) => {
      const to = answer(`${VERCEL_URL}${path}`)
      expect(to?.status).toBe(308)
      expect(new URL(to!.location).origin).toBe(WORKERS_URL)
    },
  )

  it('is one catch-all rule with no conditions, to the Workers host', () => {
    expect(config.redirects).toHaveLength(1)
    const [rule] = config.redirects!
    expect(rule).toEqual({ source: rule.source, destination: rule.destination, permanent: true })
    expect(new URL(rule.destination).origin).toBe(WORKERS_URL)
  })

  it('uses a source that matches the root: `/:path*` would not, under Vercel’s strict matching', () => {
    const naive = { redirects: [{ source: '/:path*', destination: `${WORKERS_URL}/:path`, permanent: true }] }
    expect(vercelAnswer(naive, `${VERCEL_URL}/`)).toBeNull()
    expect(answer(`${VERCEL_URL}/`)).not.toBeNull()
  })
})

describe('criterion 2: the Vercel build has nothing to fail on', () => {
  it('replaces the Next.js preset: no framework, no install, a build that only echoes', () => {
    expect(config.framework).toBeNull()
    expect(config.installCommand).toBe('') // Vercel skips the install step on an empty string
    expect(config.buildCommand).toMatch(/^echo '[^'`$\\]*'$/) // one echo: no npm, no next build, no env, no database
  })

  it('sets nothing else that runs code or needs settings (no functions, rewrites, headers, crons or env)', () => {
    expect(Object.keys(config).sort()).toEqual(
      ['$schema', 'buildCommand', 'framework', 'installCommand', 'outputDirectory', 'redirects'].sort(),
    )
  })

  it('outputs one static page, which says where tiebreak went (the redirect answers first, so nobody should see it)', () => {
    const dir = config.outputDirectory as string
    expect(readdirSync(repoFile(dir))).toEqual(['index.html'])
    const html = readFileSync(repoFile(`${dir}/index.html`), 'utf8')
    expect(html).toContain(`<link rel="canonical" href="${WORKERS_URL}/">`)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain(`<a href="${WORKERS_URL}/">`)
  })

  it('has no other entry point Vercel would build for an "Other" project (a root api/, middleware or proxy)', () => {
    for (const path of ['api', 'middleware.ts', 'middleware.js', 'proxy.ts', 'proxy.js']) expect(existsSync(repoFile(path))).toBe(false)
  })

  it('.vercelignore uploads vercel.json and the output page', () => {
    const ignored = readFileSync(repoFile('.vercelignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    // Everything (`*`, `/*`, `**`), or either of the two by name.
    expect(ignored.filter((line) => /^\/?\*+\/?$/.test(line) || /vercel\.json|vercel-redirect/.test(line))).toEqual([])
  })
})

describe('criterion 3: the PR changes only the Vercel config and tests', () => {
  it.each(['vercel.json', '.vercelignore', 'vercel-redirect/index.html', 'tests/vercel-redirect.test.ts', 'tests/workers-move.ts', 'GROWTH.md', 'README.md', 'docs/screenshots/home-mobile.png', 'scripts/screenshots.mjs', '.provision'])(
    '%s may change',
    (file) => expect(inScope(file)).toBe(true),
  )

  // Criterion 5 needs these three (the default address, the poll page's canonical link and the 404 page's), and no more.
  it.each(['lib/site.ts', 'app/p/[id]/page.tsx', 'app/not-found.tsx'])('%s may change, for criterion 5', (file) => expect(inScope(file)).toBe(true))

  it.each(['app/page.tsx', 'app/layout.tsx', 'app/p/[id]/poll-view.tsx', 'app/p/[id]/card/route.ts', 'app/global-not-found.tsx', 'lib/site.tsx', 'lib/beacon.ts', 'mobile/app.json', 'mobile/src/lib/client.ts', 'public/robots.txt', 'package.json', 'package-lock.json', 'next.config.ts', 'open-next.config.ts', 'wrangler.jsonc', 'tsconfig.json', 'proxy.ts', 'middleware.ts', '.github/workflows/ci.yml', 'vercel-redirect/app.js', 'docs/screenshots/cloudflare-local/x.png'])(
    '%s may not',
    (file) => expect(inScope(file)).toBe(false),
  )

  // Opt-in, since it reads git: `SCOPE_BASE=main npx vitest run tests/vercel-redirect.test.ts` before committing.
  it.skipIf(!process.env.SCOPE_BASE)('this checkout changes nothing else since SCOPE_BASE', () => {
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)
    const changed = [...git('diff', '--name-only', process.env.SCOPE_BASE!), ...git('ls-files', '--others', '--exclude-standard')]
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.filter((file) => !inScope(file))).toEqual([])
  })
})
