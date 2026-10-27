import { NextRequest, NextResponse, after } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'
import { staleQueriesFor } from '@/lib/targetQueries'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // the runs continue in the background (after) and take a few minutes

// A member who has been away has had their searches paused (see activeMemberQueries). When they open the site,
// catch their searches up straight away: every query of theirs that is more than 12 hours old runs now, so new
// roles arrive within minutes of the visit instead of waiting for the next cron pass.
const CHUNK = 4          // queries per run-priority call; the call runs up to four lanes and has a ~4 minute budget
const MAX_QUERIES = 24   // a member's whole set, with room to spare
const recentlyWoken = new Map<string, number>()   // per server instance: don't fire the same query twice in 15 minutes
const WAKE_COOLDOWN_MS = 15 * 60_000

export async function POST(req: NextRequest) {
  try {
    const { data: { user } } = await (await getSessionClient()).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })

    const db = createServerClient()
    const { data: prof } = await db.from('profiles').select('pass_expires_at').eq('id', user.id).maybeSingle()
    if (!prof?.pass_expires_at || Date.parse(String(prof.pass_expires_at)) <= Date.now()) {
      return NextResponse.json({ running: 0 })   // no live pass, nothing to pay for
    }

    const now = Date.now()
    for (const [q, at] of recentlyWoken) if (now - at > WAKE_COOLDOWN_MS) recentlyWoken.delete(q)
    const stale = (await staleQueriesFor(db, user.id))
      .filter((q) => !recentlyWoken.has(q.toLowerCase()))
      .slice(0, MAX_QUERIES)
    if (!stale.length) return NextResponse.json({ running: 0 })
    for (const q of stale) recentlyWoken.set(q.toLowerCase(), now)

    const origin = new URL(req.url).origin
    after(async () => {
      const chunks: string[][] = []
      for (let i = 0; i < stale.length; i += CHUNK) chunks.push(stale.slice(i, i + CHUNK))
      await Promise.all(chunks.map((queries) => fetch(`${origin}/api/run-priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET ?? '' },
        body: JSON.stringify({ queries }),
      }).catch((e) => console.error('[wake] run-priority call failed', e))))
    })

    console.log(`[wake] ${user.id}: ${stale.length} stale quer${stale.length === 1 ? 'y' : 'ies'} started`)
    return NextResponse.json({ running: stale.length })
  } catch (e) {
    console.error('[wake] failed:', (e as Error).message)
    return NextResponse.json({ running: 0 })
  }
}
