'use client'

import { useEffect } from 'react'
import { sendSignal } from '@/lib/beacon'
import { isResultPath } from '@/lib/results'
import { isToolPath } from '@/lib/tools'

/**
 * A page load's visit. A tool page sends its own instead, with its path (app/tools/thumbnail-tool.tsx), so a
 * landing there counts once whichever of the two effects runs first. A published result's page (/results/<slug>)
 * is counted here with its path, so result pages count apart from the rest of the site.
 */
export function countVisit(pathname: string) {
  if (isToolPath(pathname)) return
  if (isResultPath(pathname)) sendSignal('visit', pathname)
  else sendSignal('visit')
}

/** Counts one anonymous "visit" per browser session, on every page (mounted in the layout). */
export function VisitBeacon() {
  useEffect(() => {
    countVisit(location.pathname)
  }, [])
  return null
}
