'use client'

import { useEffect } from 'react'
import { sendSignal } from '@/lib/beacon'
import { isResultPath } from '@/lib/results'
import { isToolPath } from '@/lib/tools'

/**
 * A page load's visit. A tool page and a published result page send their own instead, with their path
 * (app/tools/thumbnail-tool.tsx, app/results/[slug]/result-visit.tsx), so a landing there counts once whichever
 * of the two effects runs first.
 */
export function countVisit(pathname: string) {
  if (!isToolPath(pathname) && !isResultPath(pathname)) sendSignal('visit')
}

/** Counts one anonymous "visit" per browser session, on every page (mounted in the layout). */
export function VisitBeacon() {
  useEffect(() => {
    countVisit(location.pathname)
  }, [])
  return null
}
