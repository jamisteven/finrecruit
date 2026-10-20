// What a member's searches are doing right now: for each target, whether its
// query has run since they saved it, when, and how many roles in the feed match.
// Used by the onboarding progress screen, the matches-tab status line, and the
// "your searches have run" email.

import type { SupabaseClient } from '@supabase/supabase-js'
import { keywordMatches, locationMatches } from './matchTarget'
import { primaryQuery, widenedQueryFor } from './targetQueries'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export type TargetStatus = {
  keyword: string
  location: string | null
  query: string
  lastRunAt: string | null
  ranSinceSave: boolean
  exact: number        // roles in the last 14 days matching role + place
  nearby: number       // same role, anywhere (the fallback)
  newSinceYesterday: number
  widened: { query: string; lastRunAt: string | null } | null
}

export type MemberStatus = {
  savedAt: string | null
  targets: TargetStatus[]
  pending: number           // queries not yet run since the save
  checkedAt: string | null  // most recent run across all their queries
  exactTotal: number
  newTotal: number
}

const DAY = 86_400_000

export async function memberStatus(db: Db, userId: string): Promise<MemberStatus> {
  const { data: targets } = await db.from('user_targets')
    .select('keyword, location, created_at').eq('user_id', userId).order('created_at')
  if (!targets?.length) return { savedAt: null, targets: [], pending: 0, checkedAt: null, exactTotal: 0, newTotal: 0 }

  const savedAt = targets.reduce((m, t) => (t.created_at > m ? t.created_at : m), targets[0].created_at as string)
  const texts = new Set<string>()
  for (const t of targets) { texts.add(primaryQuery(t).toLowerCase()); const w = widenedQueryFor(t); if (w) texts.add(w.toLowerCase()) }

  const [{ data: queries }, { data: jobs }] = await Promise.all([
    db.from('priority_queries').select('query, last_run_at, active'),
    db.from('jobs').select('title, location, work_type, extracted_at')
      .gte('extracted_at', new Date(Date.now() - 14 * DAY).toISOString())
      .or('quality.is.null,quality.neq.low').limit(5000),
  ])
  const byText = new Map<string, { last_run_at: string | null; active: boolean }>()
  for (const q of queries ?? []) { const k = String(q.query).toLowerCase(); if (texts.has(k)) byText.set(k, q) }

  const since = new Date(Date.now() - DAY).toISOString()
  const rows: TargetStatus[] = targets.map((t) => {
    const q = primaryQuery(t); const qi = byText.get(q.toLowerCase())
    const w = widenedQueryFor(t); const wi = w ? byText.get(w.toLowerCase()) : undefined
    let exact = 0, nearby = 0, fresh = 0
    for (const j of jobs ?? []) {
      if (!keywordMatches(t.keyword, j.title ?? '', null)) continue
      nearby++
      if (locationMatches(t.location, j.location, j.work_type)) { exact++; if (j.extracted_at >= since) fresh++ }
    }
    return {
      keyword: t.keyword, location: t.location, query: q,
      lastRunAt: qi?.last_run_at ?? null,
      ranSinceSave: !!qi?.last_run_at && qi.last_run_at >= savedAt,
      exact, nearby, newSinceYesterday: fresh,
      widened: w ? { query: w, lastRunAt: wi?.last_run_at ?? null } : null,
    }
  })
  const runs = rows.flatMap((r) => [r.lastRunAt, r.widened?.lastRunAt ?? null]).filter((x): x is string => !!x)
  return {
    savedAt,
    targets: rows,
    pending: rows.filter((r) => !r.ranSinceSave).length,
    checkedAt: runs.length ? runs.sort().at(-1)! : null,
    exactTotal: rows.reduce((s, r) => s + r.exact, 0),
    newTotal: rows.reduce((s, r) => s + r.newSinceYesterday, 0),
  }
}
