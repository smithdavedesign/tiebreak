// Polls: validation, the close rule, the public feed, reports, the CSV export
// and their SQL (credits and plans have their own modules). Route handlers and
// pages call these; nothing here knows about HTTP.
import { randomBytes } from 'node:crypto'
import { accountOf, lockAccount, type AccountView } from './credits'
import { toCsv } from './csv'
import { getDb, type Sql } from './db'
import {
  FEED_PAGE_SIZE,
  MAX_HOURS,
  MAX_OPTION_TEXT_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_TARGET,
  MAX_URL_LENGTH,
  MIN_HOURS,
  MIN_OPTIONS,
  MIN_TARGET,
  OPTION_LETTERS,
  REPORTS_TO_HIDE,
} from './limits'
import { planOf } from './plans'

const HOUR_MS = 60 * 60 * 1000

const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/

export type Status = 'open' | 'closed' | 'no_result'

/**
 * unlisted: only people with the link (free). public: also in the feed (costs
 * a posting credit). private: link only, and only the creator sees the result (Pro).
 */
export const VISIBILITIES = ['unlisted', 'public', 'private'] as const
export type Visibility = (typeof VISIBILITIES)[number]

// What creating each visibility takes: posting credits spent, and whether it's
// a Pro feature. A Record, so a new visibility can't be added without deciding both.
const REQUIRES: Record<Visibility, { credits: number; pro: boolean }> = {
  unlisted: { credits: 0, pro: false },
  public: { credits: 1, pro: false },
  private: { credits: 0, pro: true },
}

export interface Option {
  text: string | null
  imageUrl: string | null
}

export interface NewPoll {
  question: string
  options: Option[]
  target: number
  durationHours: number
  visibility: Visibility
}

export interface PollView {
  id: string
  question: string
  options: Option[]
  target: number
  visibility: Visibility
  status: Status
  /** Index of the winning option; null while open, on a tie, or with no votes. */
  winner: number | null
  voteCount: number
  /** Votes per option, revealed only once the poll has closed. */
  tally: number[] | null
  /** The option this voter picked, if they voted. */
  myVote: number | null
  /** True when the caller created this poll. Who created it is never exposed. */
  mine: boolean
  createdAt: string
  closesAt: string
  closedAt: string | null
}

interface PollRow {
  id: string
  question: string
  options: Option[]
  target: number
  visibility: Visibility
  creator_id: string | null
  status: Status
  winner: number | null
  created_at: Date | string
  closes_at: Date | string
  closed_at: Date | string | null
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

const isVisibility = (value: unknown): value is Visibility =>
  (VISIBILITIES as readonly unknown[]).includes(value)

function parseImageUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function parseOption(value: unknown): Option | undefined {
  const raw = typeof value === 'string' ? { text: value } : value
  if (!isRecord(raw)) return undefined
  if (raw.text !== undefined && raw.text !== null && typeof raw.text !== 'string') return undefined
  const text = typeof raw.text === 'string' && raw.text.trim() !== '' ? raw.text.trim() : null
  const imageUrl = parseImageUrl(raw.imageUrl)
  if (imageUrl === undefined) return undefined
  if (text === null && imageUrl === null) return undefined
  if (text !== null && text.length > MAX_OPTION_TEXT_LENGTH) return undefined
  return { text, imageUrl }
}

export function parseNewPoll(input: unknown): Parsed<NewPoll> {
  if (!isRecord(input)) return { ok: false, error: 'Send a JSON object' }

  const { question = '', options, target, durationHours, visibility = 'unlisted' } = input
  if (typeof question !== 'string' || question.trim().length > MAX_QUESTION_LENGTH) {
    return { ok: false, error: `question must be text of at most ${MAX_QUESTION_LENGTH} characters` }
  }
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return { ok: false, error: `options must list ${MIN_OPTIONS} to ${MAX_OPTIONS} choices` }
  }
  const parsedOptions: Option[] = []
  for (const [i, option] of options.entries()) {
    const parsed = parseOption(option)
    if (!parsed) {
      return {
        ok: false,
        error: `option ${i + 1} needs text (at most ${MAX_OPTION_TEXT_LENGTH} characters) or an https image URL`,
      }
    }
    parsedOptions.push(parsed)
  }
  if (!isIntIn(target, MIN_TARGET, MAX_TARGET)) {
    return { ok: false, error: `target must be a whole number from ${MIN_TARGET} to ${MAX_TARGET}` }
  }
  if (!isIntIn(durationHours, MIN_HOURS, MAX_HOURS)) {
    return { ok: false, error: `durationHours must be a whole number from ${MIN_HOURS} to ${MAX_HOURS}` }
  }
  if (!isVisibility(visibility)) {
    return { ok: false, error: `visibility must be one of: ${VISIBILITIES.join(', ')}` }
  }
  return {
    ok: true,
    value: { question: question.trim(), options: parsedOptions, target, durationHours, visibility },
  }
}

/** The verdict for a final tally: the single top option wins; a tie for first has no winner. */
export function decide(tally: number[]): { status: 'closed' | 'no_result'; winner: number | null } {
  const top = Math.max(0, ...tally)
  if (top === 0) return { status: 'no_result', winner: null }
  const leaders = tally.flatMap((count, i) => (count === top ? [i] : []))
  return { status: 'closed', winner: leaders.length === 1 ? leaders[0] : null }
}

const iso = (value: Date | string) => new Date(value).toISOString()
const isPastDeadline = (row: PollRow, now: Date) => now.getTime() >= new Date(row.closes_at).getTime()

async function tallyOf(sql: Sql, row: PollRow): Promise<number[]> {
  const tally: number[] = row.options.map(() => 0)
  const { rows } = await sql.query<{ option_index: number; n: number }>(
    'SELECT option_index, count(*)::int AS n FROM votes WHERE poll_id = $1 GROUP BY option_index',
    [row.id],
  )
  for (const { option_index, n } of rows) tally[option_index] = n
  return tally
}

async function lockPoll(sql: Sql, id: string): Promise<PollRow | undefined> {
  const { rows } = await sql.query<PollRow>('SELECT * FROM polls WHERE id = $1 FOR UPDATE', [id])
  return rows[0]
}

/** Moves an open poll to its final status. Callers hold the row lock. */
async function close(sql: Sql, row: PollRow, tally: number[], now: Date): Promise<PollRow> {
  const { status, winner } = decide(tally)
  const { rows } = await sql.query<PollRow>(
    `UPDATE polls SET status = $2, winner = $3, closed_at = $4::timestamptz
      WHERE id = $1 AND status = 'open'
      RETURNING *`,
    [row.id, status, winner, now.toISOString()],
  )
  return rows[0] ?? row
}

/**
 * The public shape of a poll row. The winner and tally are only shown once the
 * poll has closed, and for a private poll only to its creator.
 */
function viewOf(
  row: PollRow,
  viewerId: string | null,
  counts: { voteCount: number; tally: number[] | null },
  myVote: number | null,
): PollView {
  const mine = viewerId !== null && row.creator_id === viewerId
  const hidden = row.status === 'open' || (row.visibility === 'private' && !mine)
  return {
    id: row.id,
    question: row.question,
    options: row.options,
    target: row.target,
    visibility: row.visibility,
    status: row.status,
    winner: hidden ? null : row.winner,
    voteCount: counts.voteCount,
    tally: hidden ? null : counts.tally,
    myVote,
    mine,
    createdAt: iso(row.created_at),
    closesAt: iso(row.closes_at),
    closedAt: row.closed_at === null ? null : iso(row.closed_at),
  }
}

async function toView(sql: Sql, row: PollRow, voterId: string | null): Promise<PollView> {
  const tally = await tallyOf(sql, row)
  let myVote: number | null = null
  if (voterId) {
    const { rows } = await sql.query<{ option_index: number }>(
      'SELECT option_index FROM votes WHERE poll_id = $1 AND voter_id = $2',
      [row.id, voterId],
    )
    myVote = rows[0]?.option_index ?? null
  }
  const voteCount = tally.reduce((sum, n) => sum + n, 0)
  return viewOf(row, voterId, { voteCount, tally }, myVote)
}

export function isPollId(id: string) {
  return ID_PATTERN.test(id)
}

export type CreateResult =
  | { kind: 'ok'; poll: PollView }
  | { kind: 'no_credits'; account: AccountView }
  | { kind: 'needs_pro' }

/**
 * Creates a poll owned by `creatorId`. Unlisted polls are free; a private poll
 * needs Pro; a public poll spends one posting credit, checked and spent under
 * the account's lock so concurrent posts can't spend the same credit twice.
 *
 *   BEGIN; lock(account); count credits; < cost → 403; INSERT; COMMIT
 *
 * The Pro check needs no lock: an account never goes from Pro back to free.
 */
export async function createPoll(poll: NewPoll, creatorId: string, now = new Date()): Promise<CreateResult> {
  const db = await getDb()
  const { credits: cost, pro } = REQUIRES[poll.visibility]
  if (pro && (await planOf(db, creatorId)) !== 'pro') return { kind: 'needs_pro' }

  const insert = async (sql: Sql): Promise<CreateResult> => {
    const id = randomBytes(9).toString('base64url')
    const closesAt = new Date(now.getTime() + poll.durationHours * HOUR_MS)
    const { rows } = await sql.query<PollRow>(
      `INSERT INTO polls (id, question, options, target, closes_at, created_at, visibility, creator_id)
       VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz, $6::timestamptz, $7, $8)
       RETURNING *`,
      [
        id,
        poll.question,
        JSON.stringify(poll.options),
        poll.target,
        closesAt.toISOString(),
        now.toISOString(),
        poll.visibility,
        creatorId,
      ],
    )
    return { kind: 'ok', poll: viewOf(rows[0], creatorId, { voteCount: 0, tally: null }, null) }
  }

  if (cost === 0) return insert(db)
  return db.transaction(async (tx): Promise<CreateResult> => {
    await lockAccount(tx, creatorId)
    const account = await accountOf(tx, creatorId)
    if (account.credits < cost) return { kind: 'no_credits', account }
    return insert(tx)
  })
}

/** Reads a poll, closing it first if its deadline has passed. Null if it doesn't exist. */
export async function getPoll(id: string, voterId: string | null, now = new Date()): Promise<PollView | null> {
  if (!isPollId(id)) return null
  const db = await getDb()
  const { rows } = await db.query<PollRow>('SELECT * FROM polls WHERE id = $1', [id])
  let row = rows[0]
  if (!row) return null
  if (row.status === 'open' && isPastDeadline(row, now)) {
    row = await db.transaction(async (tx) => {
      const locked = (await lockPoll(tx, id)) ?? row
      return locked.status === 'open' ? close(tx, locked, await tallyOf(tx, locked), now) : locked
    })
  }
  return toView(db, row, voterId)
}

export type VoteResult =
  | { kind: 'ok'; poll: PollView }
  | { kind: 'not_found' | 'closed' | 'bad_option' | 'duplicate' }

/**
 * Records one vote and applies the close rule, atomically:
 * the poll row is locked, so concurrent votes are serialised and the
 * target can't be overshot.
 */
export async function castVote(
  id: string,
  voterId: string,
  option: number,
  now = new Date(),
): Promise<VoteResult> {
  if (!isPollId(id)) return { kind: 'not_found' }
  const db = await getDb()
  return db.transaction(async (tx): Promise<VoteResult> => {
    const row = await lockPoll(tx, id)
    if (!row) return { kind: 'not_found' }
    if (row.status !== 'open') return { kind: 'closed' }
    if (isPastDeadline(row, now)) {
      await close(tx, row, await tallyOf(tx, row), now)
      return { kind: 'closed' }
    }
    if (!isIntIn(option, 0, row.options.length - 1)) return { kind: 'bad_option' }

    const inserted = await tx.query(
      `INSERT INTO votes (poll_id, voter_id, option_index, created_at)
       VALUES ($1, $2, $3, $4::timestamptz)
       ON CONFLICT (poll_id, voter_id) DO NOTHING
       RETURNING option_index`,
      [id, voterId, option, now.toISOString()],
    )
    if (inserted.rows.length === 0) return { kind: 'duplicate' }

    const tally = await tallyOf(tx, row)
    const total = tally.reduce((sum, n) => sum + n, 0)
    const current = total >= row.target ? await close(tx, row, tally, now) : row
    return { kind: 'ok', poll: await toView(tx, current, voterId) }
  })
}

/**
 * The public feed as one viewer sees it: open public polls before their
 * deadline, with fewer than REPORTS_TO_HIDE reports, minus the viewer's own
 * polls and the ones they already voted on or reported. Soonest deadline first.
 * Polls past their deadline are only filtered out here; reads and votes close them.
 */
export async function listFeed(viewerId: string | null, now = new Date()): Promise<PollView[]> {
  const db = await getDb()
  const { rows } = await db.query<PollRow & { vote_count: number }>(
    `SELECT p.*, (SELECT count(*)::int FROM votes v WHERE v.poll_id = p.id) AS vote_count
       FROM polls p
      WHERE p.visibility = 'public'
        AND p.status = 'open'
        AND p.closes_at > $2::timestamptz
        AND (SELECT count(*) FROM reports r WHERE r.poll_id = p.id) < $3
        AND ($1::text IS NULL OR (
              p.creator_id IS DISTINCT FROM $1::text
          AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.voter_id = $1::text)
          AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.poll_id = p.id AND r.reporter_id = $1::text)))
      ORDER BY p.closes_at, p.id
      LIMIT $4`,
    [viewerId, now.toISOString(), REPORTS_TO_HIDE, FEED_PAGE_SIZE],
  )
  return rows.map((row) => viewOf(row, viewerId, { voteCount: row.vote_count, tally: null }, null))
}

export type ReportResult = 'ok' | 'not_found' | 'duplicate'

/** Files one report per account per poll, in a single statement. */
export async function reportPoll(id: string, reporterId: string, now = new Date()): Promise<ReportResult> {
  if (!isPollId(id)) return 'not_found'
  const db = await getDb()
  const { rows } = await db.query<{ found: boolean; inserted: boolean }>(
    `WITH poll AS (SELECT id FROM polls WHERE id = $1),
          added AS (
            INSERT INTO reports (poll_id, reporter_id, created_at)
            SELECT id, $2, $3::timestamptz FROM poll
            ON CONFLICT (poll_id, reporter_id) DO NOTHING
            RETURNING 1)
     SELECT EXISTS (SELECT 1 FROM poll) AS found, EXISTS (SELECT 1 FROM added) AS inserted`,
    [id, reporterId, now.toISOString()],
  )
  const { found, inserted } = rows[0]
  if (!found) return 'not_found'
  return inserted ? 'ok' : 'duplicate'
}

export type ExportResult =
  | { kind: 'ok'; csv: string }
  | { kind: 'not_found' | 'not_creator' | 'needs_pro' | 'open' }

const EXPORT_COLUMNS =['vote', 'voted_at', 'option', 'option_text', 'option_image_url']

/**
 * Every vote on a closed poll as CSV, one row per vote in the order they were
 * cast (Pro, creator only). A poll past its deadline is closed first. Voter
 * ids are never exported: the id is the voter's account cookie.
 */
export async function exportVotes(id: string, requesterId: string | null, now = new Date()): Promise<ExportResult> {
  const poll = await getPoll(id, requesterId, now)
  if (!poll) return { kind: 'not_found' }
  if (!poll.mine) return { kind: 'not_creator' }
  const db = await getDb()
  if ((await planOf(db, requesterId)) !== 'pro') return { kind: 'needs_pro' }
  if (poll.status === 'open') return { kind: 'open' }

  const { rows } = await db.query<{ option_index: number; created_at: Date | string }>(
    'SELECT option_index, created_at FROM votes WHERE poll_id = $1 ORDER BY created_at, voter_id',
    [id],
  )
  const lines = rows.map(({ option_index, created_at }, i) => {
    const option = poll.options[option_index]
    return [i + 1, iso(created_at), OPTION_LETTERS[option_index], option.text, option.imageUrl]
  })
  return { kind: 'ok', csv: toCsv([EXPORT_COLUMNS, ...lines]) }
}
