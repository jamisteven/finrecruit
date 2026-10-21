// Every table behind the /analytics page as flat rows, for CSV / zip download.
// Admin-only (the route checks). Panels are reused so the files always agree with what the page shows;
// the raw event tables are added where a spreadsheet is more useful than a chart.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DATASETS } from './analyticsDatasets'
import { membersPanel, demandPanel, engagementPanel, supplyPanel, growthPanel, fetchRaw } from './analytics'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export async function buildDataset(db: Db, name: string, cache: Cache = {}): Promise<Row[]> {
  const get = <T,>(k: string, f: () => Promise<T>): Promise<T> => ((cache[k] ??= f()) as Promise<T>)
  const members = () => get('members', () => membersPanel(db))
  const growth = () => get('growth', () => growthPanel(db))
  const demand = () => get('demand', () => demandPanel(db))
  const engagement = () => get('engagement', () => engagementPanel(db))
  const supply = () => get('supply', () => supplyPanel(db))

  switch (name) {
    case 'members': {
      const m = await members()
      return m.members.map((x) => ({ email: x.email, active: x.active, plan: x.plan, last_paid_at: x.paidAt, payments: x.payments, expires_at: x.expiresAt, days_left: x.daysLeft, device: x.device, last_visit: x.lastVisit, targets: x.targets.length, exact_matches_7d: x.exact7, target_problems: x.flags }))
    }
    case 'member_targets': {
      const m = await members()
      return m.members.flatMap((x) => x.targets.map((t) => ({ email: x.email, role: t.keyword, location: t.location, exact_7d: t.exact7, exact_14d: t.exact14, agency_14d: t.agency14, anywhere_14d: t.anywhere14, query: t.query, query_active: t.active, last_run_at: t.lastRunAt, slow_lane: t.slowLane, problem: t.flag })))
    }
    case 'accounts': {
      const [profiles, g] = await Promise.all([fetchRaw(db, 'profiles', 'id, email, created_at, pass_expires_at, signup_device', (q) => q.order('created_at', { ascending: true })), growth()])
      const first = new Map(g.payments.map((p) => [p.email, p]))
      return profiles.map((p) => ({ email: p.email, created_at: p.created_at, paying: !!p.pass_expires_at, pass_expires_at: p.pass_expires_at, device: p.signup_device, first_payment_at: first.get(p.email)?.at ?? null, first_plan: first.get(p.email)?.plan ?? null }))
    }
    case 'checkouts': {
      const rows = await fetchRaw(db, 'checkout_events', '*', (q) => q.order('created_at', { ascending: true }))
      return rows.map((r) => { const { user_agent: _ua, ...rest } = r; void _ua; return rest })
    }
    case 'growth_daily': return (await growth()).days
    case 'visit_heatmap_utc': {
      const g = await growth()
      return g.visitMatrix.flatMap((hours, weekday) => hours.map((visits, hour) => ({ weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday], hour_utc: hour, page_loads: visits })))
    }
    case 'offer_sources': return (await growth()).offerSources
    case 'searches': return fetchRaw(db, 'search_events', 'searched_at, term, locations, result_count, visitor_id, user_id', (q) => q.gte('searched_at', new Date(Date.now() - 90 * 86_400_000).toISOString()).order('searched_at', { ascending: true }))
    case 'demand_terms': {
      const d = await demand()
      const out: Row[] = []
      for (const win of ['d7', 'd30', 'd90'] as const) for (const seg of ['all', 'members', 'free'] as const) {
        const x = d[win][seg]
        for (const [kind, list] of [['term', x.terms], ['location', x.locations], ['no_results', x.zeroResult]] as const)
          for (const r of list) out.push({ window_days: win.slice(1), segment: seg, kind, key: r.key, count: r.count })
      }
      return out
    }
    case 'demand_daily': return (await demand()).d30.all.days
    case 'engagement_daily': return (await engagement()).days
    case 'engagement_summary': {
      const e = await engagement()
      return [{ visitors_30d: e.visitors, returning_share_pct: e.returningShare, searched: e.funnel.searched, clicked_job: e.funnel.clickedJob, checkout_started: e.funnel.checkoutStarted, paid: e.funnel.paid,
        median_active_sec_all: e.time.all.medianSec, mean_active_sec_all: e.time.all.meanSec, bounced_pct_all: e.time.all.bounced, median_active_sec_members: e.time.members.medianSec, median_active_sec_free: e.time.free.medianSec }]
    }
    case 'referrers': return (await engagement()).referrers.map((r) => ({ referrer: r.key, visits: r.count }))
    case 'supply_daily': return (await supply()).days
    case 'job_mix_daily': return (await supply()).jobDays
    case 'sectors': return (await supply()).sectors.map((r) => ({ sector: r.key, roles: r.count }))
    case 'ingest_runs': return fetchRaw(db, 'ingest_runs', '*', (q) => q.gte('run_at', new Date(Date.now() - 30 * 86_400_000).toISOString()).order('run_at', { ascending: true }))
    case 'query_yield_14d': { const s = await supply(); return [...s.best, ...s.worst.filter((w) => !s.best.some((b) => b.pipeline === w.pipeline && b.query === w.query))] }
    case 'classifier_outcomes': return (await supply()).classifier.map((r) => ({ outcome: r.key, count: r.count }))
    default: throw new Error(`unknown dataset: ${name}`)
  }
}

export { DATASETS }
type Cache = Record<string, Promise<unknown> | undefined>
