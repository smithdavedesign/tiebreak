import { getAccount } from '@/lib/credits'
import { readVoter } from '@/lib/http'
import { getPlan } from '@/lib/plans'

/** GET /account → 200 { account, plan } — the caller's posting credits and plan. Never mints an account. */
export async function GET(request: Request) {
  const id = readVoter(request.headers.get('cookie'))
  const [account, plan] = await Promise.all([getAccount(id), getPlan(id)])
  return Response.json({ account, plan }, { headers: { 'cache-control': 'no-store' } })
}
