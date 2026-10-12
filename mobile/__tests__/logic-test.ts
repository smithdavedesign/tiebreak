import { pollIdFrom, shareUrl } from '../src/lib/links'
import { SWIPE_THRESHOLD, canSwipe, swipeChoice } from '../src/lib/swipe'
import { toNewPoll, type Draft } from '../src/lib/validate'

describe('swipe (same rule as the web app)', () => {
  it('left past the threshold is A, right is B, in between is nothing', () => {
    expect(swipeChoice(-SWIPE_THRESHOLD)).toBe(0)
    expect(swipeChoice(SWIPE_THRESHOLD + 40)).toBe(1)
    expect(swipeChoice(SWIPE_THRESHOLD - 1)).toBeNull()
    expect(swipeChoice(Number.NaN)).toBeNull()
  })
  it('only two-option polls are swiped', () => {
    expect(canSwipe(2)).toBe(true)
    expect(canSwipe(3)).toBe(false)
  })
})

describe('share links', () => {
  it('reads the id from web links, app links and bare ids', () => {
    expect(pollIdFrom('https://tiebreak-phi.vercel.app/p/AbCdEf_-1234')).toBe('AbCdEf_-1234')
    expect(pollIdFrom('tiebreak://p/AbCdEf_-1234?x=1')).toBe('AbCdEf_-1234')
    expect(pollIdFrom('AbCdEf_-1234')).toBe('AbCdEf_-1234')
    expect(pollIdFrom('https://example.com/feed')).toBeNull()
  })
  it('builds the web share URL', () => {
    expect(shareUrl('https://tiebreak-phi.vercel.app/', 'AbCdEf_-1234')).toBe('https://tiebreak-phi.vercel.app/p/AbCdEf_-1234')
  })
})

describe('create form (mirrors the server checks)', () => {
  const base: Draft = { question: ' Which? ', options: [{ text: 'Red', imageUrl: '' }, { text: '', imageUrl: 'https://img.test/b.png' }], target: '10', durationHours: '24', visibility: 'unlisted' }
  it('builds the request body, dropping empty fields and blank options', () => {
    const r = toNewPoll({ ...base, options: [...base.options, { text: ' ', imageUrl: '' }] })
    expect(r).toEqual({ ok: true, value: { question: 'Which?', options: [{ text: 'Red' }, { imageUrl: 'https://img.test/b.png' }], target: 10, durationHours: 24, visibility: 'unlisted' } })
  })
  it('rejects what the server would', () => {
    expect(toNewPoll({ ...base, options: [base.options[0]] }).ok).toBe(false)
    expect(toNewPoll({ ...base, target: '0' }).ok).toBe(false)
    expect(toNewPoll({ ...base, target: '2.5' }).ok).toBe(false)
    expect(toNewPoll({ ...base, durationHours: '169' }).ok).toBe(false)
    expect(toNewPoll({ ...base, options: [base.options[0], { text: '', imageUrl: 'http://img.test/x.png' }] }).ok).toBe(false)
    expect(toNewPoll({ ...base, question: 'x'.repeat(141) }).ok).toBe(false)
  })
})
