// The free thumbnail preview tools (GROWTH.md, 2026-10-21): search-landing pages where 2–4 candidates are
// previewed side by side, drawn in the browser from the visitor's own files, then handed to a poll. Their
// paths are also in PUBLIC_PAGES (lib/site.ts), which the sitemap reads.
import { OPTION_LETTERS } from '@/lib/limits'

/** One way the tool shows every candidate: cropped to a width:height ratio, or whole at a fixed height. */
export type ToolView =
  /** A results grid; `tile` is about how wide a tile is, in rem. */
  | { key: string; label: string; layout: 'grid'; ratio: readonly [number, number]; tile: number }
  /** A phone-wide feed, one tile under another. */
  | { key: string; label: string; layout: 'feed'; ratio: readonly [number, number] }
  /** A row of covers at `height` CSS px, uncropped. */
  | { key: string; label: string; layout: 'shelf'; height: number }

export type Tool = {
  slug: string
  path: string
  /** The tool's name: its h1 and its link text. */
  name: string
  /** The page title, before " · tiebreak". */
  title: string
  description: string
  lede: string
  /** What the candidates are, in the page's copy. */
  noun: string
  /** The question the new-poll form starts with. */
  question: string
  views: readonly ToolView[]
  /** What to look for in the previews. */
  checks: readonly string[]
  /** The search page on the same topic. */
  guide: string
}

export const TOOLS: readonly Tool[] = [
  {
    slug: 'etsy-thumbnail-preview',
    path: '/tools/etsy-thumbnail-preview',
    name: 'Etsy thumbnail preview',
    title: 'Free Etsy thumbnail preview: compare listing photos side by side',
    description:
      'Add 2–4 listing photos and see them side by side in a search-grid mock, cropped 1:1, 4:3 and 5:4. Free, in your browser. Then let strangers vote on the best.',
    lede: 'Your first listing photo becomes a small, cropped thumbnail in search results. Add your 2–4 candidates to see each one side by side at three crops, then let strangers pick, instead of asking “which picture is best?” in a forum thread.',
    noun: 'listing photos',
    question: 'Which listing photo should I use?',
    views: [
      { key: '1:1', label: 'Square crop (1:1)', layout: 'grid', ratio: [1, 1], tile: 10 },
      { key: '4:3', label: '4:3 crop', layout: 'grid', ratio: [4, 3], tile: 10 },
      { key: '5:4', label: '5:4 crop', layout: 'grid', ratio: [5, 4], tile: 10 },
    ],
    checks: [
      'Is the item whole in every crop, with room around its edges?',
      'Can you tell what it is at this size, as on a phone?',
      'Which one do you notice first next to the others?',
    ],
    guide: '/which-etsy-photo-is-best',
  },
  {
    slug: 'book-cover-thumbnail-test',
    path: '/tools/book-cover-thumbnail-test',
    name: 'Book cover thumbnail test',
    title: 'Free book cover thumbnail test: compare covers at small sizes',
    description:
      'Add 2–4 book covers and see them next to each other at about 160 px and 80 px tall, to check the title and genre still read when small. Free, in your browser.',
    lede: 'Readers often meet your cover small, next to other covers, before they see it full size. Add your 2–4 candidates to see them side by side at about 160 px and 80 px tall, then let strangers pick.',
    noun: 'covers',
    question: 'Which book cover would you pick up?',
    views: [
      { key: '160', label: 'About 160 px tall', layout: 'shelf', height: 160 },
      { key: '80', label: 'About 80 px tall', layout: 'shelf', height: 80 },
    ],
    checks: [
      'Can you still read the title at 80 px?',
      'Does the genre show at a glance?',
      'Which cover do you notice first in the row?',
    ],
    guide: '/choose-a-thumbnail-or-book-cover',
  },
  {
    slug: 'youtube-thumbnail-preview',
    path: '/tools/youtube-thumbnail-preview',
    name: 'YouTube thumbnail preview',
    title: 'Free YouTube thumbnail preview: compare 2–4 thumbnails at 16:9',
    description:
      'Add 2–4 thumbnails and see each at 16:9 in a desktop grid tile and a phone feed tile, side by side. Free, in your browser. Then let strangers pick one to click.',
    lede: 'Viewers see your thumbnail small: in a grid on a computer, in a feed on a phone. Add your 2–4 candidates to see each one in both, side by side, then let strangers pick the one they would click.',
    noun: 'thumbnails',
    question: 'Which thumbnail would you click?',
    views: [
      { key: 'desktop', label: 'Desktop grid', layout: 'grid', ratio: [16, 9], tile: 15 },
      { key: 'phone', label: 'Phone feed', layout: 'feed', ratio: [16, 9] },
    ],
    checks: [
      'Can you read any text on it in the phone feed?',
      'Is the face or the subject clear in the grid tile?',
      'Which one would you click?',
    ],
    guide: '/choose-a-thumbnail-or-book-cover',
  },
]

export const toolBySlug = (slug: string): Tool | undefined => TOOLS.find((t) => t.slug === slug)

/** How the first n poll options are named: "option A", "options A and B", "options A–C". */
export function optionRange(n: number) {
  if (n <= 1) return 'option A'
  if (n === 2) return 'options A and B'
  return `options A–${OPTION_LETTERS[n - 1]}`
}
