// Pure M3 helpers: Stripe's webhook signature scheme, price labels and CSV cells.
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '@/lib/csv'
import { formatPrice, verifyStripeSignature } from '@/lib/stripe'
import { BOM } from './helpers'

const SECRET = ['whsec', 'Z9y8X7w6'.repeat(4)].join('_')
const NOW = 1_791_806_400_000 // 2026-10-12T12:00:00Z
const PAYLOAD = '{"id":"evt_1","type":"checkout.session.completed"}'

const v1 = (payload: string, t: number | string, secret = SECRET) =>
  createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
const t = Math.floor(NOW / 1000)

describe('verifyStripeSignature', () => {
  it('accepts a signature made with the endpoint secret', () => {
    expect(verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1(PAYLOAD, t)}`, SECRET, NOW)).toBe(true)
  })

  it('ignores spaces and unknown schemes around the v1 signature', () => {
    expect(verifyStripeSignature(PAYLOAD, `t=${t}, v0=abc, v1=${v1(PAYLOAD, t)}`, SECRET, NOW)).toBe(true)
  })

  it('accepts any one matching v1 signature', () => {
    const header = `t=${t},v1=${v1(PAYLOAD, t, 'old')},v1=${v1(PAYLOAD, t)}`
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, NOW)).toBe(true)
  })

  it('accepts a timestamp at the edge of the 5-minute tolerance', () => {
    expect(verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1(PAYLOAD, t)}`, SECRET, NOW + 300_000)).toBe(true)
  })

  it.each([
    ['a missing header', null],
    ['an empty header', ''],
    ['no timestamp', `v1=${v1(PAYLOAD, t)}`],
    ['no v1 signature', `t=${t}`],
    ['only a v0 signature', `t=${t},v0=${v1(PAYLOAD, t)}`],
    ['another secret', `t=${t},v1=${v1(PAYLOAD, t, 'other')}`],
    ['a signature over another body', `t=${t},v1=${v1(`${PAYLOAD} `, t)}`],
    ['a signature for another timestamp', `t=${t + 1},v1=${v1(PAYLOAD, t)}`],
    ['a stale timestamp', `t=${t - 301},v1=${v1(PAYLOAD, t - 301)}`],
    ['a future timestamp', `t=${t + 301},v1=${v1(PAYLOAD, t + 301)}`],
    ['a non-numeric timestamp', `t=soon,v1=${v1(PAYLOAD, 'soon')}`],
    ['a truncated signature', `t=${t},v1=${v1(PAYLOAD, t).slice(0, 10)}`],
    ['garbage', 'nonsense'],
  ])('rejects %s', (_name, header) => {
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, NOW)).toBe(false)
  })

  it('rejects everything when the secret is empty', () => {
    expect(verifyStripeSignature(PAYLOAD, `t=${t},v1=${v1(PAYLOAD, t, '')}`, '', NOW)).toBe(false)
  })
})

describe('formatPrice', () => {
  it('formats amounts in the smallest currency unit', () => {
    expect(formatPrice(900, 'usd')).toBe('$9.00')
    expect(formatPrice(1250, 'eur')).toBe('€12.50')
  })

  it('knows zero-decimal currencies', () => {
    expect(formatPrice(500, 'jpy')).toBe('¥500')
  })
})

describe('CSV', () => {
  it('leaves plain cells alone', () => {
    expect(csvCell('Red mug')).toBe('Red mug')
    expect(csvCell(3)).toBe('3')
    expect(csvCell(null)).toBe('')
  })

  it('quotes cells with commas, quotes or line breaks, doubling quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"')
  })

  it('stops spreadsheets from running cells as formulas', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tx')).toBe("'\tx")
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('a=b')).toBe('a=b')
  })

  it('writes a BOM, CRLF rows and a final line break', () => {
    expect(
      toCsv([
        ['a', 'b'],
        [1, null],
      ]),
    ).toBe(`${BOM}a,b\r\n1,\r\n`)
  })
})
