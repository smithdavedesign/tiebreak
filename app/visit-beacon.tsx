'use client'

import { useEffect } from 'react'
import { sendSignal, visitPath } from '@/lib/beacon'

/**
 * Counts one anonymous "visit" per browser session, on every page (mounted in the layout). A session that
 * lands on a page counted apart (the Etsy photo test) says so with its path.
 */
export function VisitBeacon() {
  useEffect(() => {
    sendSignal('visit', visitPath(location.pathname))
  }, [])
  return null
}
