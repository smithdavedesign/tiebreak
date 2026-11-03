'use client'

import { useEffect, useRef, useState } from 'react'
import { newsletterBlocks } from '@/lib/newsletter'
import type { PollView as Poll } from '@/lib/polls'

/**
 * "Get votes from your newsletter" (GROWTH.md, 2026-11-03), for a poll's creator while it's open: the poll as a
 * block to paste into an email or a post, each option linking to its own vote (lib/newsletter.ts). `origin` is the
 * server's idea of this site's address; the browser's own replaces it once loaded, as in the share link.
 */
export function NewsletterPanel({ poll, origin }: { poll: Poll; origin: string }) {
  const [here, setHere] = useState(origin)
  useEffect(() => setHere(window.location.origin), [])
  const blocks = newsletterBlocks(poll, here)

  return (
    <section className="card newsletter" aria-labelledby="newsletter-heading">
      <h2 id="newsletter-heading">Get votes from your newsletter</h2>
      <p>
        Paste your options into your next email or post. Each one links to its own vote: a reader taps the one
        they&apos;d pick, then confirms it here.
      </p>
      <Preview html={blocks.emailHtml} />
      <div className="copy-blocks">
        <CopyBlock
          button="Copy email HTML"
          hint="For email: paste it into a message, or into your email tool’s HTML block."
          code="Email HTML"
          show="Show the HTML"
          text={blocks.emailHtml}
          html={blocks.emailHtml}
        />
        <CopyBlock
          button="Copy Markdown"
          hint="For Substack and similar editors: a picture and a link for each option."
          code="Markdown"
          show="Show the Markdown"
          text={blocks.markdown}
          html={blocks.markdownHtml}
        />
      </div>
      <p className="hint">
        Opening a link counts nothing until the reader taps Confirm vote, so the link checkers some email services run
        don&apos;t vote.
      </p>
    </section>
  )
}

/**
 * The email block as a reader sees it, in a sandboxed frame: nothing in it can run, and its links open in a new
 * tab. Same-origin without scripts, so this page can read its height and show it whole.
 */
function Preview({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const fit = () => {
      const body = el.contentDocument?.body
      if (body) el.style.height = `${Math.ceil(body.getBoundingClientRect().height)}px`
    }
    fit()
    el.addEventListener('load', fit)
    window.addEventListener('resize', fit)
    return () => {
      el.removeEventListener('load', fit)
      window.removeEventListener('resize', fit)
    }
  }, [html])

  return (
    <iframe
      ref={frame}
      className="newsletter-preview"
      title="Preview of the email block"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><body style="margin:0;padding:8px;display:flow-root">${html}</body>`}
    />
  )
}

/**
 * One block's copy button. The clipboard gets `text` as plain text (what a code box or a Markdown editor pastes)
 * and `html` as HTML (what a rich editor pastes). Without clipboard access, the code opens, selected, to copy by hand.
 */
function CopyBlock({
  button,
  hint,
  code,
  show,
  text,
  html,
}: {
  button: string
  hint: string
  /** The code box's label. */
  code: string
  /** What opens the code box. */
  show: string
  text: string
  html: string
}) {
  const [copied, setCopied] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  async function copy() {
    try {
      if (typeof ClipboardItem === 'undefined') {
        await navigator.clipboard.writeText(text)
      } else {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ])
      }
      setCopied(true)
    } catch {
      if (details.current) details.current.open = true
      area.current?.select()
    }
  }

  return (
    <div className="copy-block">
      <button type="button" onClick={() => void copy()}>
        {copied ? 'Copied' : button}
      </button>
      <p className="hint">{hint}</p>
      <details ref={details}>
        <summary>{show}</summary>
        <textarea ref={area} readOnly value={text} aria-label={code} rows={6} onFocus={(e) => e.target.select()} />
      </details>
    </div>
  )
}
