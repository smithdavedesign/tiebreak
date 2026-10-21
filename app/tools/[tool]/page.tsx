import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GUIDES } from '@/lib/guides'
import { pageMetadata } from '@/lib/site'
import { TOOLS, toolBySlug } from '@/lib/tools'
import { ThumbnailPreview } from './thumbnail-preview'

type Props = { params: Promise<{ tool: string }> }

// The three tools are built at deploy; any other /tools/<slug> is a 404.
export const dynamicParams = false

export function generateStaticParams() {
  return TOOLS.map((t) => ({ tool: t.slug }))
}

async function toolOf({ params }: Props) {
  const tool = toolBySlug((await params).tool)
  if (!tool) notFound()
  return tool
}

export async function generateMetadata(props: Props) {
  const tool = await toolOf(props)
  return pageMetadata(tool.path, tool.title, tool.description)
}

export default async function ToolPage(props: Props) {
  const tool = await toolOf(props)
  const guide = GUIDES.find((g) => g.path === tool.guide)
  const others = TOOLS.filter((t) => t !== tool)
  return (
    <article className="tool-page">
      <h1>{tool.name}</h1>
      <p className="lede">{tool.lede}</p>
      <ThumbnailPreview tool={tool} />

      <div className="terms">
        <h2>What to look for</h2>
        <ul className="features">
          {tool.checks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>

        <h2>How it works</h2>
        <ol className="features">
          <li>
            Add 2–4 {tool.noun}. They stay on your device: your browser draws the previews, and nothing is uploaded.
          </li>
          <li>Compare them side by side, and remove any that fail.</li>
          <li>
            Still stuck? Press <b>Let strangers pick</b>. The images upload and a new poll opens with them as the
            options. Set a vote target and a deadline, share the link, and the poll closes with a winner and the split.
            It&apos;s free, with no sign-up.
          </li>
        </ol>
        <p className="hint">
          The previews are simplified mocks: they show size and crop, not any site&apos;s exact layout. tiebreak
          isn&apos;t affiliated with Etsy, YouTube or any store.
        </p>

        <p className="guide-links">
          More free tools:{' '}
          {others.map((t, i) => (
            <span key={t.path}>
              {i > 0 && ' · '}
              <Link href={t.path}>{t.name}</Link>
            </span>
          ))}
          {guide && (
            <>
              . Not sure how to choose? <Link href={guide.path}>{guide.label}</Link>
            </>
          )}
        </p>
      </div>
    </article>
  )
}
