'use client'

import { useEffect } from 'react'
import { sendSignal } from '@/lib/beacon'

/** Counts one anonymous "visit" per browser session, on every page (mounted in the layout). */
export function VisitBeacon() {
  useEffect(() => {
    sendSignal('visit')
  }, [])
  return null
}
