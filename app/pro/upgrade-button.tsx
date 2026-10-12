'use client'

import { useState } from 'react'

/** Starts Stripe Checkout: POST /checkout, then on to Stripe's hosted payment page. */
export function UpgradeButton({ price }: { price: string | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upgrade() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const body = await res.json().catch(() => null)
      if (res.ok && typeof body?.url === 'string') {
        window.location.assign(body.url)
        return
      }
      // Already Pro (paid in another tab): show it.
      if (res.status === 409) {
        window.location.reload()
        return
      }
      setError(body?.error ?? 'Something went wrong. Try again.')
    } catch {
      setError('Network error. Try again.')
    }
    setBusy(false)
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => void upgrade()}>
        {busy ? 'Opening Stripe…' : price ? `Get Pro for ${price}` : 'Get Pro'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
