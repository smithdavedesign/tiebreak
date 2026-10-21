import { cookies } from 'next/headers'
import Link from 'next/link'
import { getAccount } from '@/lib/credits'
import { VOTER_COOKIE, isVoterId } from '@/lib/http'
import { GUIDES } from '@/lib/guides'
import { imagePath, isImageId } from '@/lib/images'
import { MAX_OPTIONS } from '@/lib/limits'
import { getPlan } from '@/lib/plans'
import { SITE_DESCRIPTION, pageMetadata } from '@/lib/site'
import { optionRange, toolBySlug } from '@/lib/tools'
import { CreatePollForm } from './create-poll-form'

export const metadata = pageMetadata('/', null, SITE_DESCRIPTION)

type Query = Record<string, string | string[] | undefined>

/**
 * A preview tool's hand-off (GROWTH.md, 2026-10-21): "Let strangers pick" uploads the images and opens
 * /?tool=<slug>&photo=<id>…, and the form starts with them as its options. Only well-formed photo ids count,
 * each once, at most MAX_OPTIONS; the tool, if it's one, only picks the question.
 */
function handOffFrom(query: Query) {
  const ids = [query.photo].flat().filter((id): id is string => typeof id === 'string' && isImageId(id))
  const photos = [...new Set(ids)].slice(0, MAX_OPTIONS)
  if (photos.length === 0) return null
  return { tool: typeof query.tool === 'string' ? toolBySlug(query.tool) : undefined, photos }
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<Query> } = {}) {
  const voter = (await cookies()).get(VOTER_COOKIE)?.value
  const viewer = isVoterId(voter) ? voter : null
  const [account, plan] = await Promise.all([getAccount(viewer), getPlan(viewer)])
  const handOff = handOffFrom((await searchParams) ?? {})

  return (
    <>
      <h1>Can&apos;t choose? Let them swipe.</h1>
      <p className="lede">
        Add 2–4 options (text, or photos straight from your phone), pick how many votes you need and how long
        to wait, then share the link.
        The poll closes at the vote target or the deadline, whichever comes first.
      </p>
      <p className="hint">
        Want strangers to vote too? <Link href="/feed">Vote in the public feed</Link> to earn credits for
        posting there.
      </p>
      {handOff && (
        <p className="notice">
          {handOff.photos.length === 1 ? 'Your image' : `Your ${handOff.photos.length} images`}
          {handOff.tool && ` from the ${handOff.tool.name}`} {handOff.photos.length === 1 ? 'is' : 'are'}{' '}
          {optionRange(handOff.photos.length)}. Add a question or text if you like, pick a vote target and a
          deadline, then create the poll.
        </p>
      )}
      <CreatePollForm
        account={account}
        plan={plan}
        prefill={handOff ? { question: handOff.tool?.question ?? '', photos: handOff.photos.map(imagePath) } : undefined}
      />
      <p className="hint guide-links">
        Not sure how to choose?{' '}
        {GUIDES.map((g, i) => (
          <span key={g.path}>
            {i > 0 && ' · '}
            <Link href={g.path}>{g.label}</Link>
          </span>
        ))}
      </p>
    </>
  )
}
