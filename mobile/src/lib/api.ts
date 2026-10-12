// Client for the tiebreak API (the Next.js app at the repo root, deployed on Vercel).
//
// The phone has no cookie jar it can rely on, so the anonymous account id travels in
// the x-tiebreak-voter header. The server mints one on the first write and sends it
// back in the same header; the client stores it and sends it from then on.

export type Status = 'open' | 'closed' | 'no_result'
export type Visibility = 'unlisted' | 'public' | 'private'

export interface Option {
  text: string | null
  imageUrl: string | null
}

export interface Poll {
  id: string
  question: string
  options: Option[]
  target: number
  visibility: Visibility
  status: Status
  /** Index of the winning option; null while open, on a tie, or with no votes. */
  winner: number | null
  voteCount: number
  /** Votes per option, only once the poll has closed. */
  tally: number[] | null
  /** The option this voter picked, if they voted. */
  myVote: number | null
  mine: boolean
  createdAt: string
  closesAt: string
  closedAt: string | null
}

export interface Account {
  credits: number
  countedVotes: number
  publicPolls: number
  votesToNextCredit: number
}

export interface NewPoll {
  question: string
  options: { text?: string; imageUrl?: string }[]
  target: number
  durationHours: number
  visibility: Visibility
}

export const VOTER_HEADER = 'x-tiebreak-voter'

/** Where the voter id is kept between launches (SecureStore in the app, a Map in tests). */
export interface VoterStore {
  get(): Promise<string | null>
  set(id: string): Promise<void>
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export function createApi(base: string, store: VoterStore, fetchImpl: Fetch = fetch) {
  const root = base.replace(/\/+$/, '')

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    const voter = await store.get()
    if (voter) headers[VOTER_HEADER] = voter
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetchImpl(root + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const minted = res.headers.get(VOTER_HEADER)
    if (minted && minted !== voter) await store.set(minted)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const message = data && typeof data.error === 'string' ? data.error : `Request failed (${res.status})`
      throw new ApiError(res.status, message)
    }
    return data as T
  }

  return {
    feed: () => request<{ polls: Poll[] }>('GET', '/polls').then((d) => d.polls),
    poll: (id: string) => request<{ poll: Poll }>('GET', `/polls/${encodeURIComponent(id)}`).then((d) => d.poll),
    vote: (id: string, option: number) =>
      request<{ poll: Poll; account: Account }>('POST', `/polls/${encodeURIComponent(id)}/votes`, { option }),
    create: (poll: NewPoll) => request<{ id: string; shareUrl: string; poll: Poll }>('POST', '/polls', poll),
    report: (id: string) => request<{ reported: true }>('POST', `/polls/${encodeURIComponent(id)}/reports`, {}),
    account: () => request<{ account: Account; plan: 'free' | 'pro' }>('GET', '/account'),
  }
}

export type Api = ReturnType<typeof createApi>
