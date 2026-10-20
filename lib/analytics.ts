// Everything the /analytics page shows, computed from our own tables.
// One function per panel; all of them read with the service-role client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { keywordMatches, locationMatches } from './matchTarget'
import { apifyBudget, budgetMode, USD_PER_POST } from './apifyBudget'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const dayKey = (iso: string) => iso.slice(0, 10)

/** PostgREST returns at most 1,000 rows per call; page through. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any

async function fetchAll(db: Db, table: string, columns: string, apply: (q: Q) => unknown): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    let q: Q = db.from(table).select(columns)
    q = apply(q) ?? q
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

function topN(counts: Map<string, number>, n: number) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }))
}
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

// ---------------------------------------------------------------- members

export async function membersPanel(db: Db) {
  const [profiles, targets, queries, checkouts, jobs, visits] = await Promise.all([
    fetchAll(db, 'profiles', 'id, email, pass_expires_at, created_at, signup_device', (q: Q) => q.not('pass_expires_at', 'is', null)),
    fetchAll(db, 'user_targets', 'user_id, keyword, location, created_at', () => undefined),
    fetchAll(db, 'priority_queries', 'query, keyword, location, active, last_run_at, user_count', () => undefined),
    fetchAll(db, 'checkout_events', '*', (q: Q) => q.not('paid_at', 'is', null)),
    fetchAll(db, 'jobs', 'id, title, location, work_type, extracted_at, quality', (q: Q) => q.gte('extracted_at', ago(14)).or('quality.is.null,quality.neq.low')),
    fetchAll(db, 'visits', 'user_id, visited_at', (q: Q) => q.not('user_id', 'is', null).gte('visited_at', ago(30))),
  ])
  const now = Date.now()
  const lastVisit = new Map<string, string>()
  for (const v of visits) if (!lastVisit.has(v.user_id) || v.visited_at > lastVisit.get(v.user_id)!) lastVisit.set(v.user_id, v.visited_at)
  const paidBy = new Map<string, Row[]>()
  for (const c of checkouts) { const arr = paidBy.get(c.user_id) ?? []; arr.push(c); paidBy.set(c.user_id, arr) }
  const qByKey = new Map(queries.map((q) => [`${String(q.keyword).toLowerCase()}|${String(q.location ?? '').toLowerCase()}`, q]))

  const members = profiles
    .map((p) => {
      const exp = new Date(p.pass_expires_at).getTime()
      const paid = (paidBy.get(p.id) ?? []).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))
      const mine = targets.filter((t) => t.user_id === p.id)
      const rows = mine.map((t) => {
        const q = qByKey.get(`${String(t.keyword).toLowerCase()}|${String(t.location ?? '').toLowerCase()}`)
        let exact7 = 0, exact14 = 0, anywhere14 = 0
        for (const j of jobs) {
          if (!keywordMatches(t.keyword, j.title ?? '', null)) continue
          anywhere14++
          if (locationMatches(t.location, j.location, j.work_type)) { exact14++; if (j.extracted_at >= ago(7)) exact7++ }
        }
        const lastRun = q?.last_run_at ? new Date(q.last_run_at).getTime() : null
        return {
          keyword: t.keyword, location: t.location, exact7, exact14, anywhere14,
          query: q?.query ?? null, active: q?.active ?? null, lastRunAt: q?.last_run_at ?? null,
          flag: !q ? 'no query' : !q.active ? 'inactive' : lastRun === null ? 'never ran' : now - lastRun > 2 * DAY ? 'stale' : null,
        }
      })
      return {
        email: p.email, plan: paid[0]?.plan ?? null, paidAt: paid[0]?.paid_at ?? null, payments: paid.length,
        expiresAt: p.pass_expires_at, daysLeft: Math.ceil((exp - now) / DAY), active: exp > now,
        device: p.signup_device ?? null, lastVisit: lastVisit.get(p.id) ?? null,
        targets: rows, exact7: rows.reduce((s, r) => s + r.exact7, 0), flags: rows.filter((r) => r.flag).length,
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.daysLeft - a.daysLeft)
  return { members, active: members.filter((m) => m.active).length, expiring7: members.filter((m) => m.active && m.daysLeft <= 7) }
}

// ---------------------------------------------------------------- demand

export async function demandPanel(db: Db) {
  const events = await fetchAll(db, 'search_events', 'visitor_id, user_id, term, locations, result_count, searched_at', (q: Q) => q.gte('searched_at', ago(90)))
  const paidIds = new Set((await fetchAll(db, 'profiles', 'id', (q: Q) => q.gt('pass_expires_at', new Date().toISOString()))).map((p) => p.id))
  const window = (days: number) => {
    const since = ago(days)
    const rows = events.filter((e) => e.searched_at >= since)
    const build = (subset: Row[]) => {
      const terms = new Map<string, number>(), locs = new Map<string, number>(), zero = new Map<string, number>()
      const seenTerm = new Set<string>()
      for (const e of subset) {
        const t = String(e.term ?? '').trim().toLowerCase()
        if (t) { const k = `${e.visitor_id}|${t}`; if (!seenTerm.has(k)) { seenTerm.add(k); bump(terms, t) } if (e.result_count === 0) bump(zero, t) }
        for (const l of (e.locations ?? [])) bump(locs, String(l).toLowerCase())
      }
      return { searches: subset.length, visitors: new Set(subset.map((e) => e.visitor_id)).size,
        terms: topN(terms, 15), locations: topN(locs, 15), zeroResult: topN(zero, 10),
        zeroShare: subset.length ? Math.round(100 * subset.filter((e) => e.result_count === 0).length / subset.length) : 0 }
    }
    return { all: build(rows), members: build(rows.filter((e) => e.user_id && paidIds.has(e.user_id))), free: build(rows.filter((e) => !(e.user_id && paidIds.has(e.user_id)))) }
  }
  return { d7: window(7), d30: window(30), d90: window(90) }
}

// ---------------------------------------------------------------- engagement

export async function engagementPanel(db: Db) {
  const [visits, searches, clicks, checkouts] = await Promise.all([
    fetchAll(db, 'visits', 'visitor_id, user_id, visited_at, referrer', (q: Q) => q.gte('visited_at', ago(30))),
    fetchAll(db, 'search_events', 'visitor_id, searched_at', (q: Q) => q.gte('searched_at', ago(30))),
    fetchAll(db, 'job_clicks', 'visitor_id, clicked_at', (q: Q) => q.gte('clicked_at', ago(30))),
    fetchAll(db, 'checkout_events', '*', () => undefined),
  ])
  const paidIds = new Set((await fetchAll(db, 'profiles', 'id', (q: Q) => q.gt('pass_expires_at', new Date().toISOString()))).map((p) => p.id))

  // sessions: one visitor on one day; span = first to last event that day
  const sessions = new Map<string, { member: boolean; times: number[] }>()
  const add = (visitor: string | null, iso: string, member = false) => {
    if (!visitor) return
    const k = `${visitor}|${dayKey(iso)}`
    const s = sessions.get(k) ?? { member, times: [] }
    s.member = s.member || member; s.times.push(new Date(iso).getTime()); sessions.set(k, s)
  }
  for (const v of visits) add(v.visitor_id, v.visited_at, !!(v.user_id && paidIds.has(v.user_id)))
  for (const s of searches) add(s.visitor_id, s.searched_at)
  for (const c of clicks) add(c.visitor_id, c.clicked_at)
  const spans = (member: boolean | null) => [...sessions.values()]
    .filter((s) => member === null || s.member === member)
    .map((s) => (Math.max(...s.times) - Math.min(...s.times)) / 1000)
  const summarise = (xs: number[]) => ({ sessions: xs.length, medianSec: Math.round(median(xs)), meanSec: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0, bounced: xs.length ? Math.round(100 * xs.filter((x) => x === 0).length / xs.length) : 0 })

  const byDay = new Map<string, { loads: number; visitors: Set<string> }>()
  for (const v of visits) { const d = byDay.get(dayKey(v.visited_at)) ?? { loads: 0, visitors: new Set() }; d.loads++; d.visitors.add(v.visitor_id); byDay.set(dayKey(v.visited_at), d) }
  const days = [...byDay.entries()].sort().map(([day, d]) => ({ day, loads: d.loads, visitors: d.visitors.size }))

  const daysSeen = new Map<string, Set<string>>()
  for (const v of visits) { const s = daysSeen.get(v.visitor_id) ?? new Set(); s.add(dayKey(v.visited_at)); daysSeen.set(v.visitor_id, s) }
  const visitors = daysSeen.size
  const returning = [...daysSeen.values()].filter((s) => s.size > 1).length

  const since30 = ago(30)
  const startedField = checkouts[0] && 'created_at' in checkouts[0] ? 'created_at' : 'paid_at'
  const started = checkouts.filter((c) => (c[startedField] ?? c.paid_at ?? '') >= since30)
  const funnel = {
    visitors, searched: new Set(searches.map((s) => s.visitor_id)).size, clickedJob: new Set(clicks.map((c) => c.visitor_id)).size,
    checkoutStarted: started.length, paid: started.filter((c) => c.paid_at).length,
  }
  const referrers = new Map<string, number>()
  for (const v of visits) { try { bump(referrers, v.referrer ? new URL(v.referrer).hostname.replace(/^www\./, '') : '(direct)') } catch { bump(referrers, '(other)') } }

  return { days, visitors, returning, returningShare: visitors ? Math.round(100 * returning / visitors) : 0,
    time: { all: summarise(spans(null)), members: summarise(spans(true)), free: summarise(spans(false)) }, funnel, referrers: topN(referrers, 10) }
}

// ---------------------------------------------------------------- supply

export async function supplyPanel(db: Db) {
  const [runs, logRows, budget] = await Promise.all([
    fetchAll(db, 'ingest_runs', 'pipeline, query, run_at, posts_returned, jobs_inserted, duplicates_skipped, rejected', (q: Q) => q.gte('run_at', ago(30))),
    fetchAll(db, 'classifier_log', 'created_at, model, decision, pipeline', (q: Q) => q.gte('created_at', ago(14)).not('model', 'like', '%backfill%')),
    apifyBudget(db),
  ])
  const byDay = new Map<string, { posts: number; kept: number; dup: number; rejected: number }>()
  for (const r of runs) {
    const d = byDay.get(dayKey(r.run_at)) ?? { posts: 0, kept: 0, dup: 0, rejected: 0 }
    d.posts += r.posts_returned ?? 0; d.kept += r.jobs_inserted ?? 0; d.dup += r.duplicates_skipped ?? 0; d.rejected += r.rejected ?? 0
    byDay.set(dayKey(r.run_at), d)
  }
  const days = [...byDay.entries()].sort().map(([day, d]) => ({ day, ...d, usd: +(d.posts * USD_PER_POST).toFixed(2) }))

  const since14 = ago(14)
  const perQuery = new Map<string, { pipeline: string; runs: number; posts: number; kept: number; dup: number }>()
  for (const r of runs) {
    if (r.run_at < since14) continue
    const k = `${r.pipeline}|${String(r.query).toLowerCase()}`
    const a = perQuery.get(k) ?? { pipeline: r.pipeline, runs: 0, posts: 0, kept: 0, dup: 0 }
    a.runs++; a.posts += r.posts_returned ?? 0; a.kept += r.jobs_inserted ?? 0; a.dup += r.duplicates_skipped ?? 0
    perQuery.set(k, a)
  }
  const yieldRows = [...perQuery.entries()].map(([k, a]) => ({ query: k.split('|')[1], ...a,
    keptPct: a.posts ? Math.round(100 * a.kept / a.posts) : 0, dupPct: a.posts ? Math.round(100 * a.dup / a.posts) : 0 }))
    .filter((r) => r.posts >= 20)
  const worst = [...yieldRows].sort((a, b) => a.keptPct - b.keptPct || b.posts - a.posts).slice(0, 12)
  const best = [...yieldRows].sort((a, b) => b.keptPct - a.keptPct || b.posts - a.posts).slice(0, 12)

  const classifier = new Map<string, number>()
  const haikuByDay = new Map<string, number>()
  for (const r of logRows) {
    bump(classifier, `${r.model === 'prefilter' ? 'prefilter' : r.model === 'gate' ? 'gate' : 'model'}:${r.decision ?? '?'}`)
    if (r.model !== 'prefilter' && r.model !== 'gate') bump(haikuByDay, dayKey(r.created_at))
  }
  const haikuDays = [...haikuByDay.entries()].sort().map(([day, calls]) => ({ day, calls, usd: +(calls * 0.002).toFixed(2) }))

  return { days, best, worst, classifier: topN(classifier, 20), haikuDays, budget: { ...budget, mode: budgetMode(budget).mode } }
}
