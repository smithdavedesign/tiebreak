import Link from 'next/link'
import type { ReactNode } from 'react'

/** The "try it" block that closes every search page: one clear link to the core action. */
export function TryTiebreak({ children }: { children: ReactNode }) {
  return (
    <div className="card guide-cta">
      <p>{children}</p>
      <Link className="button" href="/">
        Post your poll
      </Link>
    </div>
  )
}
