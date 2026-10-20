// The free thumbnail preview tools (GROWTH.md, 2026-10-20): search-landing pages under /tools/ that preview
// 2–4 images side by side and hand them to a poll. The footer and the tool pages link from this list; the
// paths are also in PUBLIC_PAGES (lib/site.ts), which the sitemap reads.
export const TOOLS = [
  {
    kind: 'etsy',
    path: '/tools/etsy-thumbnail-preview',
    name: 'Etsy thumbnail preview',
    question: 'Which listing photo would you click?',
  },
  {
    kind: 'book-cover',
    path: '/tools/book-cover-thumbnail-test',
    name: 'Book cover thumbnail test',
    question: 'Which cover would you pick up?',
  },
  {
    kind: 'youtube',
    path: '/tools/youtube-thumbnail-preview',
    name: 'YouTube thumbnail preview',
    question: 'Which thumbnail would you click?',
  },
] as const

export type Tool = (typeof TOOLS)[number]
export type ToolKind = Tool['kind']

export const toolOf = (kind: ToolKind): Tool => TOOLS.find((t) => t.kind === kind)!
