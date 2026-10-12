import { ApiError, VOTER_HEADER, createApi, type VoterStore } from '../src/lib/api'

function memoryStore(initial: string | null = null): VoterStore & { value: string | null } {
  const s = { value: initial, get: async () => s.value, set: async (id: string) => void (s.value = id) }
  return s
}

const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...init.headers } })

describe('api client', () => {
  it('stores the id the server mints and sends it on later requests', async () => {
    const store = memoryStore()
    const seen: (string | null)[] = []
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get(VOTER_HEADER))
      return seen.length === 1
        ? json({ id: 'abcdefghijkl', shareUrl: 'x', poll: {} }, { status: 201, headers: { [VOTER_HEADER]: '00000000-0000-4000-8000-000000000001' } })
        : json({ polls: [] })
    })
    const api = createApi('https://example.test/', store, fetchMock)
    await api.create({ question: 'q', options: [{ text: 'a' }, { text: 'b' }], target: 3, durationHours: 24, visibility: 'unlisted' })
    await api.feed()
    expect(seen).toEqual([null, '00000000-0000-4000-8000-000000000001'])
    expect(store.value).toBe('00000000-0000-4000-8000-000000000001')
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/polls')
  })

  it('sends JSON bodies and the right paths', async () => {
    const fetchMock = jest.fn(async () => json({ poll: { id: 'p' }, account: { credits: 0 } }, { status: 201 }))
    const api = createApi('https://example.test', memoryStore('00000000-0000-4000-8000-000000000002'), fetchMock)
    await api.vote('abc/def', 1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/polls/abc%2Fdef/votes')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"option":1}')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })

  it("turns an error response into ApiError with the server's message", async () => {
    const api = createApi('https://example.test', memoryStore(), async () => json({ error: 'You already voted on this poll' }, { status: 409 }))
    await expect(api.vote('abcdefghijkl', 0)).rejects.toEqual(expect.objectContaining({ status: 409, message: 'You already voted on this poll' }))
    await expect(api.vote('abcdefghijkl', 0)).rejects.toBeInstanceOf(ApiError)
  })
})
