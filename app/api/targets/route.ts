import { NextRequest, NextResponse, after } from 'next/server'
import { memberStatus } from '@/lib/targetStatus'
import { sendEmail, searchesReadyEmail } from '@/lib/email'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'
import { normaliseKeyword } from '@/lib/normaliseKeyword'
import { distilForQuery, keywordMatches, locationMatches, titleSearchGroups, titleFilter } from '@/lib/matchTarget'
import { claimQuery, releaseTargets, widerLocation } from '@/lib/targetQueries'

export const runtime = 'nodejs'

// Below this many matching roles in the last 30 days, a target earns its own
// Apify query. Above it, the feed already covers them.
const COVERAGE_THRESHOLD = 25

/**
 * How many roles from the last 30 days the member's feed would show for this target. It counts the way the feed
 * does (title only, the same role-family and place rules), so "covered" means the member really sees that many.
 * It used to match the keyword in the title OR the summary, which called thin targets covered because of roles
 * the feed never shows. Stops early once the threshold is reached.
 */
async function feedCoverage(db: ReturnType<typeof createServerClient>, keyword: string, location: string | null): Promise<number> {
  const groups = titleSearchGroups(keyword)
  if (!groups) return 0
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  let found = 0
  for (let from = 0; from < 5000; from += 1000) {
    let q = db.from('jobs').select('title, location, work_type')
      .eq('is_verified_job', true)
      .neq('sector', 'other')
      .or('quality.is.null,quality.neq.low')
      .gte('posted_at', since)
    for (const g of groups) q = q.or(g.map(titleFilter).join(','))
    const { data } = await q.order('posted_at', { ascending: false }).range(from, from + 999)
    const rows = data ?? []
    for (const j of rows) {
      if (keywordMatches(keyword, j.title ?? '', null) && locationMatches(location, j.location ?? null, j.work_type ?? null)) found++
    }
    if (found >= COVERAGE_THRESHOLD || rows.length < 1000) break
  }
  return found
}

export const maxDuration = 300

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
    // Up to 3 roles x (3 cities + remote), sent role-major by the form. Every
    // pair is stored as a target.
    type Pair = { keyword: string; location: string | null }
    const MAX_TARGETS = 12
    const seen = new Set<string>()
    const pairs: Pair[] = (body.pairs ?? [])
      .slice(0, MAX_TARGETS)
      .map((p: { keyword?: string; location?: string }) => ({
        keyword: normaliseKeyword(String(p.keyword ?? '')),
        location: String(p.location ?? '').trim().toLowerCase() || null,
      }))
      .filter((p: { keyword: string | null; location: string | null }): p is Pair => {
        if (!p.keyword) return false
        const key = `${p.keyword}|${p.location ?? ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

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
    // first save = onboarding; later saves are edits and don't get the welcome email
    const isFirstSave = (priorTargets ?? []).length === 0

    // A save replaces what they had. Anything they've dropped releases its
    // claim on the shared query, and a query nobody still wants goes quiet
    // rather than burning Apify credit forever.
    const keepKeys = new Set(pairs.map((p) => `${p.keyword}|${p.location ?? ''}`))
    const dropped = (priorTargets ?? []).filter(
      (t) => !keepKeys.has(`${t.keyword}|${t.location ?? ''}`))

    await releaseTargets(db, dropped as { keyword: string; location: string | null }[])

    // Plain delete + insert instead of upsert: a NULL location never matches
    // the unique index, so ignoreDuplicates couldn't dedupe those rows anyway.
    const { error: delErr } = await db.from('user_targets').delete().eq('user_id', user.id)
    if (delErr) throw delErr
    const { error: insErr } = await db.from('user_targets').insert(
      pairs.map((p) => ({ user_id: user.id, keyword: p.keyword, location: p.location }))
    )
    if (insErr) throw insErr

    // Every thin pair earns a query: a cap of 3 used to leave a member's second
    // city with no search at all (and an empty feed), which cost more than the
    // Apify runs it saved. The round-robin below still spreads partial coverage
    // across roles should the cap ever bind again.
    const MAX_PER_USER = MAX_TARGETS
    const byRole = new Map<string, Pair[]>()
    for (const p of pairs) byRole.set(p.keyword, [...(byRole.get(p.keyword) ?? []), p])
    const ordered: Pair[] = []
    for (let i = 0; ordered.length < pairs.length; i++) {
      for (const list of byRole.values()) if (list[i]) ordered.push(list[i])
    }

    const added: string[] = []
    const widened: string[] = []
    const covered: string[] = []
    const claimedWide = new Set<string>()
    const toRun: string[] = []   // the exact query texts to kick off now
    let queued = 0

    for (const p of ordered) {
      if (queued >= MAX_PER_USER) { covered.push(p.location ? `${p.keyword} / ${p.location}` : p.keyword); continue }
      // How much of this do we already hold?
      const count = await feedCoverage(db, p.keyword, p.location)
      const label = p.location ? `${p.keyword} / ${p.location}` : p.keyword

      if (count >= COVERAGE_THRESHOLD) { covered.push(label); continue }

      const qKeyword = distilForQuery(p.keyword)
      const queryText = p.location
        ? `hiring ${qKeyword} ${p.location}`
        : `hiring ${qKeyword}`

      // Someone re-saving the same target shouldn't bump the shared counter
      // (it drives retirement) or trigger another Apify run.
      const isNewForUser = !hadBefore.has(`${p.keyword}|${p.location ?? ''}`)
      const existed = await claimQuery(db, queryText, p.keyword, p.location, isNewForUser)
      if (!existed || isNewForUser) { added.push(label); toRun.push(queryText); queued++ }
      else covered.push(label)

      // The city they asked for is thin, so also watch the surrounding region.
      // Someone wanting ".net engineer" in San Jose gets California too, rather
      // than an empty tab while the roles sit in New York.
      if (p.location && count < 5) {
        const wider = widerLocation(p.location)
        if (wider) {
          const wideText = `hiring ${qKeyword} ${wider}`
          // One claim per member per region, however many of their cities widen to it
          const wideKey = `${p.keyword}|${wider}`
          const isNewWide = isNewForUser && !claimedWide.has(wideKey)
          claimedWide.add(wideKey)
          const existedWide = await claimQuery(db, wideText, p.keyword, wider, isNewWide)
          if (!existedWide || isNewWide) { widened.push(`${p.keyword} / ${wider}`); toRun.push(wideText) }
        }
      }
    }

    // Run EVERY new query now, not just the first batch: the first ten minutes after
    // paying are when a member decides whether this works. The response returns at
    // once; the runs continue in the background (`after`), in chunks of twelve that
    // run-priority handles two at a time, and when they're done the member gets the
    // "your searches have run" email with what landed.
    const origin = new URL(req.url).origin
    const email = user.email ?? null
    // Don't buy posts we already have: a query another member shares, or one this
    // member just re-saved, that ran in the last 12 hours is fresh — its results
    // are in the feed already. Only queries that have never run, or not recently, fire.
    const FRESH_MS = 12 * 3600_000
    let fireNow = toRun
    if (toRun.length > 0) {
      const { data: recent } = await db.from('priority_queries').select('query, last_run_at').in('query', toRun)
      const fresh = new Set((recent ?? [])
        .filter((q) => q.last_run_at && Date.now() - new Date(q.last_run_at as string).getTime() < FRESH_MS)
        .map((q) => String(q.query).toLowerCase()))
      fireNow = toRun.filter((q) => !fresh.has(q.toLowerCase()))
      if (fresh.size) console.log(`[targets] ${fresh.size} of ${toRun.length} queries ran <12h ago, not re-fired`)
    }
    if (fireNow.length > 0) {
      after(async () => {
        const chunks: string[][] = []
        for (let i = 0; i < fireNow.length; i += 12) chunks.push(fireNow.slice(i, i + 12))
        await Promise.all(chunks.map((queries) => fetch(`${origin}/api/run-priority`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET ?? '' },
          body: JSON.stringify({ queries }),
        }).catch((e) => console.error('[targets] run-priority call failed', e))))
        // Off unless SEARCHES_READY_EMAIL=true is set in Vercel (switched off Nov 4: its "twice a day" wording may no longer be true)
        if (email && isFirstSave && process.env.SEARCHES_READY_EMAIL === 'true') {
          try {
            const status = await memberStatus(db, user.id)
            const msg = searchesReadyEmail(status)
            await sendEmail(email, msg.subject, msg.html, msg.text)
          } catch (e) { console.error('[targets] ready email failed', e) }
        }
      })
    }

    console.log(`[targets] ${user.id}: ${added.length} queued, ${covered.length} covered, ${widened.length} widened; targets=${pairs.length}`)
    return NextResponse.json({ ok: true, added, covered, running: fireNow.length })
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

    const { releaseTargets } = await import('@/lib/targetQueries')
    await releaseTargets(db, (mine ?? []) as { keyword: string; location: string | null }[])

    await db.from('user_targets').delete().eq('user_id', user.id)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Could not clear' }, { status: 500 })
  }
}
