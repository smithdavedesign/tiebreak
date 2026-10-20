// Public launch: every public page renders with its own title, description, canonical URL and share tags;
// the share image is 1200×630; the JSON-LD carries the $5 offer; the footer links privacy and terms; the
// Buy button shows only once payments are set up; terms and privacy say what REVENUE.md and the code do.
import { readFileSync } from 'node:fs'
import type { Metadata } from 'next'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ISSUES_URL, JSON_LD, PRICE, PUBLIC_PAGES, SHARE_IMAGE, SITE_URL } from '@/lib/site'
import { basicPoll, createPoll, useTestDb, voter } from './helpers'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const { default: RootLayout } = await import('@/app/layout')
const robots = (await import('@/app/robots')).default
const ogImage = await import('@/app/opengraph-image')
const { generateMetadata: pollMetadata } = await import('@/app/p/[id]/page')
const home = await import('@/app/page')
const feed = await import('@/app/feed/page')
const pro = await import('@/app/pro/page')
const privacy = await import('@/app/privacy/page')
const terms = await import('@/app/terms/page')
const pickfu = await import('@/app/pickfu-alternative/page')
const etsy = await import('@/app/which-etsy-photo-is-best/page')
const thumbnail = await import('@/app/choose-a-thumbnail-or-book-cover/page')
const etsyTool = await import('@/app/tools/etsy-thumbnail-preview/page')
const coverTool = await import('@/app/tools/book-cover-thumbnail-test/page')
const youtubeTool = await import('@/app/tools/youtube-thumbnail-preview/page')

useTestDb()

const noQuery = { searchParams: Promise.resolve({}) }
const PAGES: Record<(typeof PUBLIC_PAGES)[number], { metadata: Metadata; render: () => ReactElement | Promise<ReactElement> }> = {
  '/': { metadata: home.metadata, render: () => home.default() },
  '/feed': { metadata: feed.metadata, render: () => feed.default() },
  '/pro': { metadata: pro.metadata, render: () => pro.default(noQuery) },
  '/privacy': { metadata: privacy.metadata, render: () => privacy.default() },
  '/terms': { metadata: terms.metadata, render: () => terms.default() },
  '/pickfu-alternative': { metadata: pickfu.metadata, render: () => pickfu.default() },
  '/which-etsy-photo-is-best': { metadata: etsy.metadata, render: () => etsy.default() },
  '/choose-a-thumbnail-or-book-cover': { metadata: thumbnail.metadata, render: () => thumbnail.default() },
  '/tools/etsy-thumbnail-preview': { metadata: etsyTool.metadata, render: () => etsyTool.default() },
  '/tools/book-cover-thumbnail-test': { metadata: coverTool.metadata, render: () => coverTool.default() },
  '/tools/youtube-thumbnail-preview': { metadata: youtubeTool.metadata, render: () => youtubeTool.default() },
}
const entries = Object.entries(PAGES)

/** The <title> a page ends up with: its own title through the layout's "%s · tiebreak" template. */
const titleOf = ({ title }: Metadata) =>
  typeof title === 'string' ? `${title} · tiebreak` : (title as { absolute: string }).absolute

const STRIPE_ENV = ['STRIPE_PAYMENT_LINK', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_PRICE_LABEL']
const PLACEHOLDER_LINK = 'https://example.com/pay'

beforeEach(() => {
  for (const name of STRIPE_ENV) vi.stubEnv(name, '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('every public page', () => {
  it('is in the sitemap list, and has metadata here', () => {
    expect(Object.keys(PAGES).sort()).toEqual([...PUBLIC_PAGES].sort())
  })

  it.each(entries)('%s renders', async (_path, page) => {
    const html = renderToString(await page.render())
    expect(html).toMatch(/<h1[^>]*>/)
  })

  it('has a title and a description no other page shares', () => {
    const titles = entries.map(([, p]) => titleOf(p.metadata))
    const descriptions = entries.map(([, p]) => p.metadata.description)
    expect(new Set(titles).size).toBe(titles.length)
    expect(new Set(descriptions).size).toBe(descriptions.length)
    for (const d of descriptions) expect(d?.length).toBeGreaterThan(50)
  })

  it.each(entries)('%s has its own canonical URL, Open Graph tags and a large Twitter card', (path, { metadata }) => {
    expect(metadata.alternates?.canonical).toBe(path)
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'tiebreak',
      url: path,
      title: titleOf(metadata),
      description: metadata.description,
      // Next drops the file-based image wherever a page sets its own openGraph, so it's listed here.
      images: [SHARE_IMAGE],
    })
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: titleOf(metadata) })
  })

  it('is open to search engines', () => {
    const disallowed = (robots().rules as { disallow: string[] }).disallow
    for (const path of PUBLIC_PAGES) expect(disallowed.some((prefix) => path.startsWith(prefix))).toBe(false)
  })
})

describe('the layout', () => {
  const html = () => renderToString(RootLayout({ children: createElement('p', null, 'page') }))

  it('links privacy and terms from the footer', () => {
    const footer = html().match(/<footer[^>]*>(.*?)<\/footer>/s)?.[1] ?? ''
    expect(footer).toContain('href="/privacy"')
    expect(footer).toContain('href="/terms"')
  })

  it('carries SoftwareApplication JSON-LD with an Offer for $5, paid once', () => {
    const script = html().match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]
    expect(JSON.parse(script ?? 'null')).toEqual(JSON_LD)
    expect(JSON_LD).toMatchObject({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', url: SITE_URL })
    expect(JSON_LD.offers).toMatchObject({ '@type': 'Offer', price: '5.00', priceCurrency: 'USD', url: `${SITE_URL}/pro` })
    expect(JSON_LD.offers.description).toMatch(/paid once/i)
  })

  it("states the price REVENUE.md decided", () => {
    expect(readFileSync(new URL('../REVENUE.md', import.meta.url), 'utf8')).toContain(`**${PRICE.label} once`)
  })
})

describe('the share image', () => {
  it('is a 1200×630 PNG drawn in code', async () => {
    expect(ogImage.size).toEqual({ width: 1200, height: 630 })
    expect(ogImage.contentType).toBe('image/png')
    expect(ogImage.alt).toBe(SHARE_IMAGE.alt)
    expect([SHARE_IMAGE.width, SHARE_IMAGE.height]).toEqual([1200, 630])
    const png = Buffer.from(await ogImage.default().arrayBuffer())
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    // The IHDR chunk: width and height, big-endian, right after the signature and chunk header.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
  })
})

describe('a poll share page', () => {
  it('puts its question on both cards and stays out of search', async () => {
    const { body } = await createPoll({ ...basicPoll, question: 'Speckled mug or white mug?' }, voter(1))
    const meta = await pollMetadata({ params: Promise.resolve({ id: body.id }) })
    expect(meta.robots).toMatchObject({ index: false })
    expect(meta.openGraph).toMatchObject({
      siteName: 'tiebreak',
      url: `/p/${body.id}`,
      title: 'Speckled mug or white mug?',
      images: [SHARE_IMAGE],
    })
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: 'Speckled mug or white mug?' })
  })
})

describe('the Buy button on /pro', () => {
  const renderPro = async () => renderToString(await pro.default(noQuery))

  it('is hidden while STRIPE_PAYMENT_LINK is unset', async () => {
    const html = await renderPro()
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Get Pro for')
    expect(html).toContain('on sale yet')
  })

  it('shows at the REVENUE.md price once the link is set, and the link itself stays on the server', async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', PLACEHOLDER_LINK)
    const html = await renderPro()
    expect(html).toContain(`>Get Pro for ${PRICE.label}</button>`)
    expect(html).not.toContain(PLACEHOLDER_LINK)
    expect(html).not.toContain('on sale yet')
  })

  it("prefers the price label provision sets for the link", async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', PLACEHOLDER_LINK)
    vi.stubEnv('STRIPE_PRICE_LABEL', '$9')
    expect(await renderPro()).toContain('>Get Pro for $9</button>')
  })

  it('stays hidden for a link that is not https', async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', 'http://example.com/pay')
    expect(await renderPro()).not.toContain('<button')
  })
})

describe('terms and privacy', () => {
  it('the terms give the REVENUE.md price and refund line, no warranty, and GitHub issues for contact', () => {
    const html = renderToString(terms.default())
    expect(html).toContain(`costs <!-- -->${PRICE.label}<!-- -->, paid once`)
    expect(html).toContain('verdict within 48 hours or a refund')
    expect(html).toContain('14 days')
    expect(html).toContain('without warranty')
    expect(html).toContain(`href="${ISSUES_URL}"`)
  })

  it('the privacy page names its one cookie and GitHub issues for contact', () => {
    const html = renderToString(privacy.default())
    expect(html).toContain('>Cookies</h2>')
    expect(html).toContain('tb_voter')
    expect(html).toContain('no tracking cookies')
    expect(html).toContain(`href="${ISSUES_URL}"`)
  })
})
