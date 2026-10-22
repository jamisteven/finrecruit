// Everything the /analytics page shows, computed from our own tables.
// One function per panel; all of them read with the service-role client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { keywordMatches, locationMatches } from './matchTarget'
import { apifyBudget, budgetMode, USD_PER_POST } from './apifyBudget'
import { widenedQueryFor } from './targetQueries'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const dayKey = (iso: string) => iso.slice(0, 10)
/** The last n UTC days, oldest first, as YYYY-MM-DD (so charts show zero days instead of skipping them). */
const dayRange = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * DAY).toISOString().slice(0, 10))

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

/** Same paging helper, exported for the CSV export route. */
export const fetchRaw = fetchAll

function topN(counts: Map<string, number>, n: number) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }))
}
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

// ---------------------------------------------------------------- members

export async function membersPanel(db: Db) {
  const [profiles, targets, queries, checkouts, jobs, visits, priorityRuns] = await Promise.all([
    fetchAll(db, 'profiles', 'id, email, pass_expires_at, created_at, signup_device', (q: Q) => q.not('pass_expires_at', 'is', null)),
    fetchAll(db, 'user_targets', 'user_id, keyword, location, created_at', () => undefined),
    fetchAll(db, 'priority_queries', 'query, keyword, location, active, last_run_at, user_count', () => undefined),
    fetchAll(db, 'checkout_events', '*', (q: Q) => q.not('paid_at', 'is', null)),
    fetchAll(db, 'jobs', 'id, title, location, work_type, extracted_at, quality, employer_type', (q: Q) => q.gte('extracted_at', ago(14)).or('quality.is.null,quality.neq.low')),
    fetchAll(db, 'visits', 'user_id, visited_at', (q: Q) => q.not('user_id', 'is', null).gte('visited_at', ago(30))),
    fetchAll(db, 'ingest_runs', 'query, run_at, posts_returned, jobs_inserted', (q: Q) => q.eq('pipeline', 'priority').gte('run_at', ago(30)).order('run_at', { ascending: false })),
  ])
  const now = Date.now()
  // slow lane = the last two runs each returned a real batch and kept <= 1 (see lib/sweepBudget findDuds)
  const lastTwo = new Map<string, Row[]>()
  for (const r of priorityRuns) { const k = String(r.query).toLowerCase(); const a = lastTwo.get(k) ?? []; if (a.length < 2) { a.push(r); lastTwo.set(k, a) } }
  const isDud = (query: string) => { const a = lastTwo.get(query.toLowerCase()) ?? []; return a.length === 2 && a.every((r) => (r.posts_returned ?? 0) >= 10 && (r.jobs_inserted ?? 0) <= 1) }
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
      const unique7 = new Set<string>()   // each role once, however many of their targets it fits (what the feed counts)
      const rows = mine.map((t) => {
        const q = qByKey.get(`${String(t.keyword).toLowerCase()}|${String(t.location ?? '').toLowerCase()}`)
        let exact7 = 0, exact14 = 0, agency14 = 0, anywhere14 = 0
        for (const j of jobs) {
          if (!keywordMatches(t.keyword, j.title ?? '', null)) continue
          anywhere14++
          if (locationMatches(t.location, j.location, j.work_type)) {
            if (j.employer_type === 'agency') { agency14++; continue }
            exact14++; if (j.extracted_at >= ago(7)) { exact7++; unique7.add(String(j.id)) }
          }
        }
        const lastRun = q?.last_run_at ? new Date(q.last_run_at).getTime() : null
        const dud = q ? isDud(String(q.query)) : false
        const ageDays = lastRun === null ? null : (now - lastRun) / DAY
        // a problem = something to fix; the slow lane is working as designed (4-day cooldown)
        const flag = !q ? 'no query' : !q.active ? 'inactive' : lastRun === null ? 'never ran'
          : dud ? (ageDays! > 5 ? 'stale' : null) : (ageDays! > 2 ? 'stale' : null)
        return {
          keyword: t.keyword, location: t.location, exact7, exact14, agency14, anywhere14,
          query: q?.query ?? null, active: q?.active ?? null, lastRunAt: q?.last_run_at ?? null,
          slowLane: dud, flag,
        }
      })
      // what their feed shows, counted the way the feed counts it (app/page.tsx): roles that fit a target's
      // keyword AND place (direct, then via agencies), then same-keyword roles in other places. 14 days.
      const feed = { exact: 0, agency: 0, rough: 0 }
      for (const j of jobs) {
        const kw = mine.filter((t) => keywordMatches(t.keyword, j.title ?? '', null))
        if (!kw.length) continue
        if (kw.some((t) => locationMatches(t.location, j.location, j.work_type))) { if (j.employer_type === 'agency') feed.agency++; else feed.exact++ }
        else feed.rough++
      }
      // the region-level query each of their cities earns (San Antonio / Austin -> Texas), and whether it exists
      const wanted = [...new Set(mine.map((t) => widenedQueryFor({ keyword: t.keyword, location: t.location })).filter((q): q is string => !!q).map((q) => q.toLowerCase()))]
      const byText = new Map(queries.map((q) => [String(q.query).toLowerCase(), q]))
      const widened = wanted.filter((w) => byText.has(w)).map((w) => {
        const q = byText.get(w)!
        return { query: q.query, active: q.active, lastRunAt: q.last_run_at ?? null,
          stale: !q.active || !q.last_run_at || now - new Date(q.last_run_at).getTime() > 2 * DAY }
      })
      const widenedMissing = wanted.some((w) => !byText.has(w))
      return {
        widened, widenedMissing, feed,
        email: p.email, plan: paid[0]?.plan ?? null, paidAt: paid[0]?.paid_at ?? null, payments: paid.length,
        expiresAt: p.pass_expires_at, daysLeft: Math.ceil((exp - now) / DAY), active: exp > now,
        device: p.signup_device ?? null, lastVisit: lastVisit.get(p.id) ?? null,
        targets: rows, exact7: unique7.size, flags: rows.filter((r) => r.flag).length,
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.daysLeft - a.daysLeft)
  return { members, active: members.filter((m) => m.active).length, expiring7: members.filter((m) => m.active && m.daysLeft <= 7) }
}

// ---------------------------------------------------------------- demand

export async function demandPanel(db: Db) {
  const events = await fetchAll(db, 'search_events', 'visitor_id, user_id, term, locations, result_count, searched_at', (q: Q) => q.gte('searched_at', ago(90)))
  const paidIds = new Set((await fetchAll(db, 'profiles', 'id', (q: Q) => q.gt('pass_expires_at', new Date().toISOString()))).map((p) => p.id))
  const window = (days_: number) => {
    const since = ago(days_)
    const rows = events.filter((e) => e.searched_at >= since)
    const build = (subset: Row[]) => {
      const terms = new Map<string, number>(), locs = new Map<string, number>(), zero = new Map<string, number>()
      const seenTerm = new Set<string>()
      for (const e of subset) {
        const t = String(e.term ?? '').trim().toLowerCase()
        if (t) { const k = `${e.visitor_id}|${t}`; if (!seenTerm.has(k)) { seenTerm.add(k); bump(terms, t) } if (e.result_count === 0) bump(zero, t) }
        for (const l of (e.locations ?? [])) bump(locs, String(l).toLowerCase())
      }
      const perDay = new Map<string, { searches: number; zero: number; people: Set<string> }>()
      for (const e of subset) {
        const d = perDay.get(dayKey(e.searched_at)) ?? { searches: 0, zero: 0, people: new Set<string>() }
        d.searches++; if (e.result_count === 0) d.zero++; d.people.add(e.visitor_id); perDay.set(dayKey(e.searched_at), d)
      }
      const days = dayRange(days_).map((day) => ({ day, searches: perDay.get(day)?.searches ?? 0, zero: perDay.get(day)?.zero ?? 0, people: perDay.get(day)?.people.size ?? 0 }))
      return { searches: subset.length, visitors: new Set(subset.map((e) => e.visitor_id)).size, days,
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
  const distinctPerDay = (rows: Row[], field: string, who: string) => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) { const k = dayKey(r[field]); const s = m.get(k) ?? new Set<string>(); s.add(r[who]); m.set(k, s) }
    return m
  }
  const searchersByDay = distinctPerDay(searches, 'searched_at', 'visitor_id')
  const clickersByDay = distinctPerDay(clicks, 'clicked_at', 'visitor_id')
  const days = dayRange(30).map((day) => ({
    day, loads: byDay.get(day)?.loads ?? 0, visitors: byDay.get(day)?.visitors.size ?? 0,
    searched: searchersByDay.get(day)?.size ?? 0, clicked: clickersByDay.get(day)?.size ?? 0,
  }))

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
  const [runs, logRows, budget, jobRows] = await Promise.all([
    fetchAll(db, 'ingest_runs', 'pipeline, query, run_at, posts_returned, jobs_inserted, duplicates_skipped, rejected', (q: Q) => q.gte('run_at', ago(30))),
    fetchAll(db, 'classifier_log', 'created_at, model, decision, pipeline', (q: Q) => q.gte('created_at', ago(14)).not('model', 'like', '%backfill%')),
    apifyBudget(db),
    fetchAll(db, 'jobs', 'extracted_at, sector, employer_type', (q: Q) => q.gte('extracted_at', ago(30)).or('quality.is.null,quality.neq.low')),
  ])
  // what the feed is made of: roles added per day split direct / agency, and by sector
  const mix = new Map<string, { direct: number; agency: number }>()
  const sectorCounts = new Map<string, number>()
  for (const j of jobRows) {
    const d = mix.get(dayKey(j.extracted_at)) ?? { direct: 0, agency: 0 }
    if (j.employer_type === 'agency') d.agency++; else d.direct++
    mix.set(dayKey(j.extracted_at), d)
    bump(sectorCounts, String(j.sector ?? 'other'))
  }
  const jobDays = dayRange(30).map((day) => ({ day, direct: mix.get(day)?.direct ?? 0, agency: mix.get(day)?.agency ?? 0 }))
  const sectors = topN(sectorCounts, 20)

  const byDay = new Map<string, { posts: number; kept: number; dup: number; rejected: number }>()
  for (const r of runs) {
    const d = byDay.get(dayKey(r.run_at)) ?? { posts: 0, kept: 0, dup: 0, rejected: 0 }
    d.posts += r.posts_returned ?? 0; d.kept += r.jobs_inserted ?? 0; d.dup += r.duplicates_skipped ?? 0; d.rejected += r.rejected ?? 0
    byDay.set(dayKey(r.run_at), d)
  }
  const days = dayRange(30).map((day) => {
    const d = byDay.get(day) ?? { posts: 0, kept: 0, dup: 0, rejected: 0 }
    return { day, ...d, usd: +(d.posts * USD_PER_POST).toFixed(2) }
  })

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

  return { days, jobDays, sectors, best, worst, classifier: topN(classifier, 20), haikuDays, budget: { ...budget, mode: budgetMode(budget).mode } }
}

// ---------------------------------------------------------------- growth

// First-payment prices, to estimate revenue from checkout_events (renewals never create a row, so
// recurring revenue is not in this number).
const FIRST_PAYMENT_USD: Record<string, number> = { monthly: 9, quarter: 39, pass: 9 }
const quiet = async (p: Promise<Row[]>): Promise<Row[]> => { try { return await p } catch { return [] } }

export async function growthPanel(db: Db) {
  const since = ago(90)
  const [profiles, checkouts, offerViews, visits] = await Promise.all([
    fetchAll(db, 'profiles', 'id, email, created_at, pass_expires_at, signup_device', (q: Q) => q.order('created_at', { ascending: true })),
    fetchAll(db, 'checkout_events', '*', (q: Q) => q.order('created_at', { ascending: true })),
    quiet(fetchAll(db, 'offer_views', 'visitor_id, src, has_pass, created_at', (q: Q) => q.gte('created_at', since).order('created_at', { ascending: true }))),
    fetchAll(db, 'visits', 'visitor_id, visited_at', (q: Q) => q.gte('visited_at', since).order('visited_at', { ascending: true })),
  ])

  // each paying member's first payment (checkout row if there is one, otherwise the account date)
  const firstPay = new Map<string, { at: string; plan: string | null }>()
  for (const c of checkouts) {
    if (!c.paid_at || !c.user_id) continue
    const cur = firstPay.get(c.user_id)
    if (!cur || c.paid_at < cur.at) firstPay.set(c.user_id, { at: c.paid_at, plan: c.plan ?? null })
  }
  const paying = profiles.filter((p) => p.pass_expires_at)
  const paidList = paying.map((p) => {
    const f = firstPay.get(p.id)
    return { email: p.email as string, at: (f?.at ?? p.created_at) as string, plan: f?.plan ?? null, device: (p.signup_device ?? null) as string | null, created: p.created_at as string }
  }).sort((a, b) => a.at.localeCompare(b.at))

  const range = dayRange(90)
  const tally = (rows: Row[], field: string) => { const m = new Map<string, number>(); for (const r of rows) if (r[field]) bump(m, dayKey(r[field])); return m }
  const distinct = (rows: Row[], field: string, who: string) => { const m = new Map<string, Set<string>>(); for (const r of rows) { const k = dayKey(r[field]); const s = m.get(k) ?? new Set<string>(); s.add(r[who]); m.set(k, s) } return m }
  const signupsByDay = tally(profiles, 'created_at')
  const paidByDay = new Map<string, number>(); for (const p of paidList) bump(paidByDay, dayKey(p.at))
  const startedByDay = tally(checkouts, 'created_at')
  const visitorsByDay = distinct(visits, 'visited_at', 'visitor_id')
  const offerByDay = distinct(offerViews.filter((o) => !o.has_pass), 'created_at', 'visitor_id')
  const revByDay = new Map<string, number>()
  for (const c of checkouts) if (c.paid_at) bump(revByDay, dayKey(c.paid_at), FIRST_PAYMENT_USD[c.plan] ?? 0)
  let cum = paidList.filter((p) => dayKey(p.at) < range[0]).length
  const days = range.map((day) => {
    cum += paidByDay.get(day) ?? 0
    return {
      day, visitors: visitorsByDay.get(day)?.size ?? 0, offerViewers: offerByDay.get(day)?.size ?? 0,
      checkouts: startedByDay.get(day) ?? 0, signups: signupsByDay.get(day) ?? 0, paid: paidByDay.get(day) ?? 0,
      revenueUsd: revByDay.get(day) ?? 0, payingMembers: cum,
    }
  })

  // when visitors are on the site: weekday (0 = Sunday) x hour, UTC. The page re-bases it to a time zone.
  const visitMatrix = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const v of visits) { const d = new Date(v.visited_at); visitMatrix[d.getUTCDay()][d.getUTCHours()]++ }

  // which link on the site sent people to /offer, and what became of them (30 days)
  const since30 = ago(30)
  const srcs = new Map<string, { views: number; people: Set<string>; started: number; paid: number }>()
  const slot = (k: string) => { let a = srcs.get(k); if (!a) { a = { views: 0, people: new Set<string>(), started: 0, paid: 0 }; srcs.set(k, a) } return a }
  for (const o of offerViews) if (!o.has_pass && o.created_at >= since30) { const a = slot(o.src || '(none)'); a.views++; a.people.add(o.visitor_id) }
  for (const c of checkouts) if ((c.created_at ?? '') >= since30) { const a = slot(c.src || '(none)'); a.started++; if (c.paid_at) a.paid++ }
  const offerSources = [...srcs.entries()].map(([src, a]) => ({
    src, views: a.views, people: a.people.size, started: a.started, paid: a.paid,
    startPct: a.people.size ? +(100 * a.started / a.people.size).toFixed(1) : 0,
  })).sort((a, b) => b.people - a.people || b.started - a.started)

  const plans = new Map<string, { n: number; usd: number }>()
  for (const c of checkouts) if (c.paid_at) { const a = plans.get(c.plan ?? '?') ?? { n: 0, usd: 0 }; a.n++; a.usd += FIRST_PAYMENT_USD[c.plan] ?? 0; plans.set(c.plan ?? '?', a) }
  const devices = new Map<string, number>(); for (const p of paidList) bump(devices, p.device ?? 'unknown')

  // account created -> first payment
  const gaps = paidList.map((p) => (new Date(p.at).getTime() - new Date(p.created).getTime()) / 60_000).filter((m) => m >= 0)
  const timeToPay = { n: gaps.length, medianMin: Math.round(median(gaps)), within1h: gaps.length ? Math.round(100 * gaps.filter((m) => m <= 60).length / gaps.length) : 0 }

  return {
    totals: { profiles: profiles.length, paying: paying.length, payingPct: profiles.length ? +(100 * paying.length / profiles.length).toFixed(1) : 0,
      revenue90Usd: days.reduce((s, d) => s + d.revenueUsd, 0) },
    days,
    // raw event times, so the page can re-bucket them into any time zone
    signups: profiles.map((p) => ({ at: p.created_at as string, paying: !!p.pass_expires_at })),
    payments: paidList.map((p) => ({ email: p.email, at: p.at, plan: p.plan, device: p.device })),
    visitMatrix, offerSources, timeToPay,
    plans: [...plans.entries()].map(([plan, a]) => ({ plan, payments: a.n, estUsd: a.usd })),
    devices: topN(devices, 6),
  }
}
