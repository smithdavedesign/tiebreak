'use client'

import { useEffect } from 'react'
import { sendSignal } from '@/lib/beacon'

/**
 * A result page counts its own visit, under its path (as a tool page does); the layout's beacon leaves result
 * pages to it (app/visit-beacon.tsx), so a landing here sends one visit, whichever effect runs first.
 */
export function ResultVisit({ path }: { path: string }) {
  useEffect(() => {
    sendSignal('visit', path)
  }, [path])
  return null
}
