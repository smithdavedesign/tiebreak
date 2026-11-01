'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { newsletterHtml, newsletterMarkdown, type BlockPoll } from '@/lib/newsletter'

type Kind = 'html' | 'markdown'

/**
 * The preview's page around the email block. The frame is sandboxed without scripts (nothing in it can run) and
 * without popups (its links do nothing when clicked); same-origin only so this page can measure its height. No
 * referrer goes to the hosts of linked option images.
 */
const previewDoc = (html: string) =>
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<meta name="referrer" content="no-referrer"><base target="_blank"></head>' +
  `<body style="margin:0;padding:12px 0;background:#ffffff;">${html}</body></html>`

/**
 * HTML goes on the clipboard twice: as rich text, so it pastes as the table into an email, and as its source, so it
 * pastes as code into an email tool's HTML block. Where only plain text can be written, the source alone.
 */
async function writeToClipboard(kind: Kind, text: string) {
  if (kind === 'html' && typeof ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([text], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      return
    } catch {}
  }
  await navigator.clipboard.writeText(text)
}

/**
 * "Get votes from your newsletter", shown to a poll's creator while it's open (lib/newsletter.ts): a preview of the
 * email block, and buttons that copy it as HTML or as Markdown. Each option links to its own vote on this site:
 * the server's address at first, then the page's own (as the share link does), so a local or preview copy links
 * to itself.
 */
export function NewsletterPanel({ poll, siteUrl }: { poll: BlockPoll; siteUrl: string }) {
  const [origin, setOrigin] = useState(siteUrl)
  const [copied, setCopied] = useState<Kind | null>(null)
  const [showCode, setShowCode] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const htmlArea = useRef<HTMLTextAreaElement>(null)
  const markdownArea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setOrigin(window.location.origin), [])

  const blocks: Record<Kind, string> = { html: newsletterHtml(poll, origin), markdown: newsletterMarkdown(poll, origin) }

  // The preview frame is as tall as the block in it (it has no scrollbar of its own).
  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument
    if (frame.current && doc?.documentElement) frame.current.style.height = `${doc.documentElement.scrollHeight}px`
  }, [])
  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === 'complete') fit() // loaded before the page hydrated
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit, blocks.html])

  async function copy(kind: Kind) {
    try {
      await writeToClipboard(kind, blocks[kind])
      setCopied(kind)
    } catch {
      // The clipboard is blocked: show the block, selected, to copy by hand.
      setCopied(null)
      setShowCode(true)
      requestAnimationFrame(() => (kind === 'html' ? htmlArea : markdownArea).current?.select())
    }
  }

  return (
    <section className="card newsletter" aria-labelledby="newsletter-heading">
      <h2 id="newsletter-heading">Get votes from your newsletter</h2>
      <p className="hint">
        Paste a block into your newsletter or an email to your list. Each option links to its own vote: a reader taps
        the one they&apos;d pick, lands here with it selected, and confirms. Opening a link never counts as a vote, so
        email link checkers can&apos;t vote.
      </p>
      <iframe
        ref={frame}
        className="newsletter-preview"
        title="Preview: the block as your readers see it"
        sandbox="allow-same-origin"
        srcDoc={previewDoc(blocks.html)}
        onLoad={fit}
      />
      <div className="newsletter-copy">
        <div>
          <button type="button" onClick={() => void copy('html')}>
            {copied === 'html' ? 'Copied' : 'Copy HTML block'}
          </button>
          <p className="hint">For email: paste it into a message, or into your email tool&apos;s HTML or code block.</p>
        </div>
        <div>
          <button type="button" className="secondary" onClick={() => void copy('markdown')}>
            {copied === 'markdown' ? 'Copied' : 'Copy Markdown'}
          </button>
          <p className="hint">For Substack and similar editors: an image line and a vote link per option.</p>
        </div>
      </div>
      <details open={showCode} onToggle={(e) => setShowCode(e.currentTarget.open)}>
        <summary>Show the code</summary>
        <label>
          HTML block
          <textarea ref={htmlArea} readOnly rows={5} value={blocks.html} onFocus={(e) => e.target.select()} />
        </label>
        <label>
          Markdown
          <textarea ref={markdownArea} readOnly rows={5} value={blocks.markdown} onFocus={(e) => e.target.select()} />
        </label>
      </details>
    </section>
  )
}
