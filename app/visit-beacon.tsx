'use client'

import { useEffect } from 'react'
import { sendSignal, sourceFor } from '@/lib/beacon'
import { isToolPath } from '@/lib/tools'

/**
 * A page load's visit. A tool page sends its own instead, with its path (app/tools/thumbnail-tool.tsx), so a
 * landing there counts once whichever of the two effects runs first. A landing from one of our links that names
 * its source (`?src=newsletter`, a newsletter block's vote link: lib/newsletter.ts) carries the page's path and
 * that source, so those visits count apart from search and shared-link visits.
 */
export function countVisit(pathname: string, search = '') {
  if (isToolPath(pathname)) return
  const source = sourceFor(search)
  if (source === null) sendSignal('visit')
  else sendSignal('visit', pathname, source)
}

/** Counts one anonymous "visit" per browser session, on every page (mounted in the layout). */
export function VisitBeacon() {
  useEffect(() => {
    countVisit(location.pathname, location.search)
  }, [])
  return null
}
