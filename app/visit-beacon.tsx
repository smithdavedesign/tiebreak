'use client'

import { useEffect } from 'react'
import { sendSignal } from '@/lib/beacon'
import { visitSource } from '@/lib/newsletter'
import { isToolPath } from '@/lib/tools'

/**
 * A page load's visit. A tool page sends its own instead, with its path (app/tools/thumbnail-tool.tsx), so a
 * landing there counts once whichever of the two effects runs first. A poll page opened from a newsletter
 * block's link (`?src=newsletter`) sends its path and that source, so those visits count apart.
 */
export function countVisit(pathname: string, search = '') {
  if (isToolPath(pathname)) return
  const source = visitSource(pathname, search)
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
