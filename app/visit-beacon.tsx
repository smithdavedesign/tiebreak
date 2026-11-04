'use client'

import { useEffect } from 'react'
import { sendSignal } from '@/lib/beacon'
import { isResultPath } from '@/lib/results'
import { isToolPath } from '@/lib/tools'

/**
 * A page load's visit. A tool page sends its own instead, with its path (app/tools/thumbnail-tool.tsx), and so
 * does a result page (PathVisit), so a landing there counts once whichever of the two effects runs first.
 */
export function countVisit(pathname: string) {
  if (!isToolPath(pathname) && !isResultPath(pathname)) sendSignal('visit')
}

/** A page counted under its own path (a public result page): once per session for that path, as its visit. */
export function PathVisit({ path }: { path: string }) {
  useEffect(() => {
    sendSignal('visit', path)
  }, [path])
  return null
}

/** Counts one anonymous "visit" per browser session, on every page (mounted in the layout). */
export function VisitBeacon() {
  useEffect(() => {
    countVisit(location.pathname)
  }, [])
  return null
}
