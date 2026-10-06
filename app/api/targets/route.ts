import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'
import { normaliseKeyword } from '@/lib/normaliseKeyword'

export const runtime = 'nodejs'

// Below this many matching roles in the last 30 days, a target earns its own
// Apify query. Above it, the feed already covers them.
const COVERAGE_THRESHOLD = 25

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })

    const body = await req.json()
    // Three explicit keyword+location pairs, not a matrix
    type Pair = { keyword: string; location: string | null }
    const pairs: Pair[] = (body.pairs ?? [])
      .slice(0, 3)
      .map((p: { keyword?: string; location?: string }) => ({
        keyword: normaliseKeyword(String(p.keyword ?? '')),
        location: String(p.location ?? '').trim().toLowerCase() || null,
      }))
      .filter((p: { keyword: string | null; location: string | null }): p is Pair => !!p.keyword)

    if (pairs.length === 0) {
      return NextResponse.json(
        { error: 'Name a specific role — bare words like "finance" are too broad to search' },
        { status: 400 }
      )
    }

    const db = createServerClient()

    await db.from('user_targets').upsert(
      pairs.map((p) => ({ user_id: user.id, keyword: p.keyword, location: p.location })),
      { onConflict: 'user_id,keyword,location', ignoreDuplicates: true }
    )

    // Cap how many queries one user can queue — the thinnest-covered pairs win
    const MAX_PER_USER = 3
    const added: string[] = []
    const covered: string[] = []

    for (const p of pairs) {
      // How much of this do we already hold?
      let q = db.from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('is_verified_job', true)
        .neq('sector', 'other')
        .or('quality.is.null,quality.neq.low')
        .gte('posted_at', new Date(Date.now() - 30 * 86400_000).toISOString())
        .or(`title.ilike.%${p.keyword}%,summary.ilike.%${p.keyword}%`)
      if (p.location) q = q.ilike('location', `%${p.location}%`)

      const { count } = await q
      const label = p.location ? `${p.keyword} / ${p.location}` : p.keyword

      if ((count ?? 0) >= COVERAGE_THRESHOLD) { covered.push(label); continue }

      const queryText = p.location
        ? `hiring ${p.keyword} ${p.location}`
        : `hiring ${p.keyword}`

      const { data: existing } = await db.from('priority_queries')
        .select('id, user_count').eq('query', queryText).maybeSingle()

      if (existing) {
        await db.from('priority_queries')
          .update({ user_count: (existing.user_count as number) + 1, active: true })
          .eq('id', existing.id)
      } else {
        await db.from('priority_queries')
          .insert({ query: queryText, keyword: p.keyword, location: p.location })
      }
      added.push(label)
    }

    console.log(`[targets] ${user.id}: ${added.length} queued, ${covered.length} covered`)
    return NextResponse.json({ ok: true, added, covered })
  } catch (e) {
    console.error('[targets]', (e as Error).message)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
