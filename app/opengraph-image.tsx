import { ImageResponse } from 'next/og'

// The share card for every page (1200×630), drawn with code at build time.
export const alt = 'tiebreak: post two options, let people swipe to pick one'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  const card = (letter: string, color: string, rotate: string) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 220,
        height: 300,
        borderRadius: 28,
        background: color,
        color: '#fff',
        fontSize: 140,
        fontWeight: 800,
        transform: `rotate(${rotate})`,
        boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
      }}
    >
      {letter}
    </div>
  )
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: '#F4F2EE', padding: 80, alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 24 }}>
          <div style={{ fontSize: 88, fontWeight: 800, color: '#1C1B19', letterSpacing: -2 }}>tiebreak</div>
          <div style={{ fontSize: 44, color: '#1C1B19', lineHeight: 1.2 }}>Can&apos;t choose? Let them swipe.</div>
          <div style={{ fontSize: 30, color: '#6B6862' }}>Post 2–4 options · share the link · get a verdict</div>
        </div>
        <div style={{ display: 'flex', gap: 28 }}>
          {card('A', '#E4572E', '-8deg')}
          {card('B', '#2E86AB', '8deg')}
        </div>
      </div>
    ),
    size,
  )
}
