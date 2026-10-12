'use client'

import { useEffect } from 'react'
import { SIGNAL_URL } from '@/lib/site'

/**
 * Counts one anonymous home-page view in RepoHQ (no cookies; the privacy page says so).
 * Sent as text/plain so the browser needs no CORS preflight; the endpoint parses the JSON body.
 */
export function VisitBeacon() {
  useEffect(() => {
    const body = JSON.stringify({ slug: 'tiebreak', kind: 'view', referrer: document.referrer || null })
    fetch(SIGNAL_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(() => {})
  }, [])
  return null
}
