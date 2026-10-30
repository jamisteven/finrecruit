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
  exact: number        // roles in the last 14 days matching role + place (direct employers)
  agency: number       // the same, posted by agencies / staffing firms
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

// The last 14 days of roles, shared by every member's status call. Reading them cost ~0.75 MB of Supabase egress
// per call, and the site makes that call on every member page load (and the welcome page polls it every 6s), so
// the rows are kept in memory for a few minutes per server instance instead.
const JOBS_TTL_MS = 3 * 60_000
type StatusJob = { title: string | null; location: string | null; work_type: string | null; extracted_at: string; employer_type: string | null }
let jobsCache: { rows: StatusJob[]; at: number } | undefined
let jobsInflight: Promise<StatusJob[]> | undefined

async function recentJobs(db: Db): Promise<StatusJob[]> {
  if (jobsCache && Date.now() - jobsCache.at < JOBS_TTL_MS) return jobsCache.rows
  if (!jobsInflight) {
    jobsInflight = (async () => {
      const { data, error } = await db.from('jobs').select('title, location, work_type, extracted_at, employer_type')
        .gte('extracted_at', new Date(Date.now() - 14 * DAY).toISOString())
        .or('quality.is.null,quality.neq.low').limit(5000)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as StatusJob[]
      jobsCache = { rows, at: Date.now() }
      return rows
    })().finally(() => { jobsInflight = undefined })
  }
  try { return await jobsInflight } catch (e) {
    if (jobsCache) return jobsCache.rows   // serve stale rather than fail the page
    throw e
  }
}

export async function memberStatus(db: Db, userId: string): Promise<MemberStatus> {
  const { data: targets } = await db.from('user_targets')
    .select('keyword, location, created_at').eq('user_id', userId).order('created_at')
  if (!targets?.length) return { savedAt: null, targets: [], pending: 0, checkedAt: null, exactTotal: 0, newTotal: 0 }

  const savedAt = targets.reduce((m, t) => (t.created_at > m ? t.created_at : m), targets[0].created_at as string)
  const texts = new Set<string>()
  for (const t of targets) { texts.add(primaryQuery(t).toLowerCase()); const w = widenedQueryFor(t); if (w) texts.add(w.toLowerCase()) }

  const [{ data: queries }, jobs] = await Promise.all([
    db.from('priority_queries').select('query, last_run_at, active'),
    recentJobs(db),
  ])
  const byText = new Map<string, { last_run_at: string | null; active: boolean }>()
  for (const q of queries ?? []) { const k = String(q.query).toLowerCase(); if (texts.has(k)) byText.set(k, q) }

  const since = new Date(Date.now() - DAY).toISOString()
  const rows: TargetStatus[] = targets.map((t) => {
    const q = primaryQuery(t); const qi = byText.get(q.toLowerCase())
    const w = widenedQueryFor(t); const wi = w ? byText.get(w.toLowerCase()) : undefined
    let exact = 0, agency = 0, nearby = 0, fresh = 0
    for (const j of jobs) {
      if (!keywordMatches(t.keyword, j.title ?? '', null)) continue
      nearby++
      if (locationMatches(t.location, j.location, j.work_type)) {
        if (j.employer_type === 'agency') agency++
        else { exact++; if (j.extracted_at >= since) fresh++ }
      }
    }
    return {
      keyword: t.keyword, location: t.location, query: q,
      lastRunAt: qi?.last_run_at ?? null,
      ranSinceSave: !!qi?.last_run_at && qi.last_run_at >= savedAt,
      exact, agency, nearby, newSinceYesterday: fresh,
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

export type PreviewRow = { keyword: string; location: string; exact: number; agency: number; nearby: number }
export type PreviewPlace = { location: string; all: number }

/**
 * What a role + place would match today, before the member saves anything (the onboarding location step).
 * Counted exactly the way memberStatus counts, from the same cached 14-day slice, so it costs no extra reads.
 * `places` is how many roles of ANY title sit in each named place, so a thin country can be called thin.
 */
export async function previewCounts(db: Db, roles: string[], locations: string[]): Promise<{ rows: PreviewRow[]; places: PreviewPlace[] }> {
  const jobs = await recentJobs(db)
  const rows: PreviewRow[] = []
  for (const keyword of roles) {
    const byTitle = jobs.filter((j) => keywordMatches(keyword, j.title ?? '', null))
    for (const location of locations) {
      let exact = 0, agency = 0
      for (const j of byTitle) {
        if (!locationMatches(location, j.location, j.work_type)) continue
        if (j.employer_type === 'agency') agency++; else exact++
      }
      rows.push({ keyword, location, exact, agency, nearby: byTitle.length })
    }
  }
  const places = locations.filter((l) => l && l.toLowerCase() !== 'remote')
    .map((location) => ({ location, all: jobs.filter((j) => locationMatches(location, j.location, j.work_type)).length }))
  return { rows, places }
}

export type TargetCount = { keyword: string; location: string | null; exact: number; agency: number; fresh: number }

/**
 * Per-target counts for a list of saved searches, counted the way memberStatus counts but without its
 * priority_queries read: used where a lot of members are processed in one go (campaign emails).
 * `fresh` is direct-employer roles found in the last 48 hours, the window free members do not see yet.
 */
export async function countsForTargets(db: Db, targets: { keyword: string; location: string | null }[]): Promise<TargetCount[]> {
  const jobs = await recentJobs(db)
  const since = new Date(Date.now() - 2 * DAY).toISOString()
  return targets.map((t) => {
    let exact = 0, agency = 0, fresh = 0
    for (const j of jobs) {
      if (!keywordMatches(t.keyword, j.title ?? '', null)) continue
      if (!locationMatches(t.location, j.location, j.work_type)) continue
      if (j.employer_type === 'agency') agency++
      else { exact++; if (j.extracted_at >= since) fresh++ }
    }
    return { keyword: t.keyword, location: t.location, exact, agency, fresh }
  })
}
