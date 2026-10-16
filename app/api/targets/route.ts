import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'
import { normaliseKeyword } from '@/lib/normaliseKeyword'
import { wideningLadder } from '@/lib/widenLocation'
import { distilForQuery } from '@/lib/matchTarget'

export const runtime = 'nodejs'

// Below this many matching roles in the last 30 days, a target earns its own
// Apify query. Above it, the feed already covers them.
const COVERAGE_THRESHOLD = 25

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })

    // Custom searches are a paid feature — a session alone isn't enough
    const { data: profile } = await createServerClient()
      .from('profiles').select('pass_expires_at').eq('id', user.id).maybeSingle()
    const hasPass = !!profile?.pass_expires_at && new Date(profile.pass_expires_at) > new Date()
    if (!hasPass) {
      return NextResponse.json({ error: 'Premium members only' }, { status: 403 })
    }

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

    // What they had before this save — used below so a re-save doesn't bump the
    // shared counter or fire another Apify run.
    const { data: priorTargets } = await db.from('user_targets')
      .select('keyword, location').eq('user_id', user.id)
    const hadBefore = new Set(
      (priorTargets ?? []).map((t) => `${t.keyword}|${t.location ?? ''}`))

    // A save replaces what they had. Anything they've dropped releases its
    // claim on the shared query, and a query nobody still wants goes quiet
    // rather than burning Apify credit forever.
    const keepKeys = new Set(pairs.map((p) => `${p.keyword}|${p.location ?? ''}`))
    const dropped = (priorTargets ?? []).filter(
      (t) => !keepKeys.has(`${t.keyword}|${t.location ?? ''}`))

    for (const t of dropped) {
      const queryText = t.location
        ? `hiring ${distilForQuery(String(t.keyword))} ${t.location}`
        : `hiring ${distilForQuery(String(t.keyword))}`
      const { data: pq } = await db.from('priority_queries')
        .select('id, user_count').eq('query', queryText).maybeSingle()
      if (!pq) continue
      const next = Math.max(0, (pq.user_count as number) - 1)
      await db.from('priority_queries')
        .update({ user_count: next, active: next > 0 })
        .eq('id', pq.id)
    }

    if (dropped.length > 0) {
      await db.from('user_targets').delete().eq('user_id', user.id)
    }

    await db.from('user_targets').upsert(
      pairs.map((p) => ({ user_id: user.id, keyword: p.keyword, location: p.location })),
      { onConflict: 'user_id,keyword,location', ignoreDuplicates: true }
    )

    // Cap how many queries one user can queue — the thinnest-covered pairs win
    const MAX_PER_USER = 3
    const added: string[] = []
    const widened: string[] = []
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

      const qKeyword = distilForQuery(p.keyword)
      const queryText = p.location
        ? `hiring ${qKeyword} ${p.location}`
        : `hiring ${qKeyword}`

      const { data: existing } = await db.from('priority_queries')
        .select('id, user_count').eq('query', queryText).maybeSingle()

      // Someone re-saving the same target shouldn't bump the shared counter
      // (it drives retirement) or trigger another Apify run.
      const isNewForUser = !hadBefore.has(`${p.keyword}|${p.location ?? ''}`)

      if (existing) {
        if (isNewForUser) {
          await db.from('priority_queries')
            .update({ user_count: (existing.user_count as number) + 1, active: true })
            .eq('id', existing.id)
        }
      } else {
        await db.from('priority_queries')
          .insert({ query: queryText, keyword: p.keyword, location: p.location })
      }
      if (!existing) added.push(label)
      else if (isNewForUser) added.push(label)
      else covered.push(label)

      // The city they asked for is thin, so also watch the surrounding region.
      // Someone wanting ".net engineer" in San Jose gets California too, rather
      // than an empty tab while the roles sit in New York.
      if (p.location && (count ?? 0) < 5) {
        const wider = wideningLadder(p.location)[1]
        if (wider?.location && wider.location.toLowerCase() !== p.location.toLowerCase()) {
          const wideText = `hiring ${qKeyword} ${wider.location}`
          const { data: existingWide } = await db.from('priority_queries')
            .select('id, user_count').eq('query', wideText).maybeSingle()
          if (existingWide) {
            await db.from('priority_queries')
              .update({ user_count: (existingWide.user_count as number) + 1, active: true })
              .eq('id', existingWide.id)
          } else {
            await db.from('priority_queries')
              .insert({ query: wideText, keyword: p.keyword, location: wider.location })
          }
          widened.push(`${p.keyword} / ${wider.location}`)
        }
      }
    }

    // Kick the new queries off now rather than waiting for the rotation, so a
    // user who just paid sees results within minutes. Fire and forget.
    if (added.length + widened.length > 0) {
      const origin = new URL(req.url).origin
      const queries = [...added, ...widened].map((label) => {
        const [k, l] = label.split(' / ')
        return l ? `hiring ${k} ${l}` : `hiring ${k}`
      })
      fetch(`${origin}/api/run-priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET ?? '' },
        body: JSON.stringify({ queries }),
      }).catch(() => {})
    }

    console.log(`[targets] ${user.id}: ${added.length} queued, ${covered.length} covered`)
    return NextResponse.json({ ok: true, added, covered })
  } catch (e) {
    console.error('[targets]', (e as Error).message)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
// Append to app/api/targets/route.ts — lets the settings page read and clear
// what a user has already asked for.
export async function GET() {
  try {
    const { getSessionClient } = await import('@/lib/supabase-session')
    const { createServerClient } = await import('@/lib/supabase')
    const { data: { user } } = await (await getSessionClient()).auth.getUser()
    if (!user) return Response.json({ error: 'Sign in first' }, { status: 401 })

    const { data } = await createServerClient()
      .from('user_targets')
      .select('keyword, location, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    return Response.json({ targets: data ?? [] })
  } catch {
    return Response.json({ targets: [] })
  }
}

export async function DELETE() {
  try {
    const { getSessionClient } = await import('@/lib/supabase-session')
    const { createServerClient } = await import('@/lib/supabase')
    const { data: { user } } = await (await getSessionClient()).auth.getUser()
    if (!user) return Response.json({ error: 'Sign in first' }, { status: 401 })

    const db = createServerClient()

    // Decrement the shared counter before dropping this user's rows, so a query
    // nobody still wants goes inactive rather than running forever.
    const { data: mine } = await db.from('user_targets')
      .select('keyword, location').eq('user_id', user.id)

    for (const t of mine ?? []) {
      const queryText = t.location
        ? `hiring ${t.keyword} ${t.location}`
        : `hiring ${t.keyword}`
      const { data: pq } = await db.from('priority_queries')
        .select('id, user_count').eq('query', queryText).maybeSingle()
      if (!pq) continue
      const next = (pq.user_count as number) - 1
      await db.from('priority_queries')
        .update({ user_count: Math.max(0, next), active: next > 0 })
        .eq('id', pq.id)
    }

    await db.from('user_targets').delete().eq('user_id', user.id)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Could not clear' }, { status: 500 })
  }
}
