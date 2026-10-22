// The thumbnail preview tools (GROWTH.md, 2026-10-22): search-landing pages that show 2–4 candidate images side
// by side, in the browser, and hand them to a new poll. The footer and the visit beacon read this list; the paths
// are also in PUBLIC_PAGES (lib/site.ts), which the sitemap reads.
export const TOOLS = [
  {
    path: '/tools/etsy-thumbnail-preview',
    kind: 'etsy',
    name: 'Etsy thumbnail preview',
    question: 'Which photo would you click in Etsy search?',
  },
  {
    path: '/tools/book-cover-thumbnail-test',
    kind: 'book-cover',
    name: 'Book cover thumbnail test',
    question: 'Which book cover would you pick up?',
  },
  {
    path: '/tools/youtube-thumbnail-preview',
    kind: 'youtube',
    name: 'YouTube thumbnail preview',
    question: 'Which thumbnail would you click?',
  },
] as const

export type ToolKind = (typeof TOOLS)[number]['kind']

export const toolOf = (kind: ToolKind) => TOOLS.find((t) => t.kind === kind)!

/** Tool pages count their own visit, with their path, apart from the rest of the site. */
export const isToolPath = (pathname: string) => TOOLS.some((t) => t.path === pathname)

/** The crops an Etsy candidate is shown at (width:height); `className` sets the shape (app/globals.css). */
export const ETSY_CROPS = [
  { label: '1:1', width: 1, height: 1, className: 'ratio-1-1' },
  { label: '4:3', width: 4, height: 3, className: 'ratio-4-3' },
  { label: '5:4', width: 5, height: 4, className: 'ratio-5-4' },
] as const

/** The heights, in CSS pixels, a book cover is shown at (the `shelf-<height>` classes in app/globals.css). */
export const COVER_HEIGHTS = [160, 80] as const
