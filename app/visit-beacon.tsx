'use client'

import { useEffect } from 'react'
import { sendSignal, sourceFor } from '@/lib/beacon'
import { isToolPath } from '@/lib/tools'

/** A poll page's path (/p/<id>, lib/polls.ts ID_PATTERN). */
const POLL_PATH = /^\/p\/[A-Za-z0-9_-]{12}$/

/**
 * A page load's visit. A tool page sends its own instead, with its path (app/tools/thumbnail-tool.tsx), so a
 * landing there counts once whichever of the two effects runs first. A poll page opened from one of its newsletter
 * links (`?src=newsletter`, lib/newsletter.ts) sends its path and that source, so those visits count apart.
 */
export function countVisit(pathname: string, search = '') {
  if (isToolPath(pathname)) return
  const source = POLL_PATH.test(pathname) ? sourceFor(search) : null
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
