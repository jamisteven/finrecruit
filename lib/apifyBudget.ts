// Spend the Apify plan, not more and not less.
//
// The subscription's prepaid usage does not roll over, so an unused dollar at
// month end is simply gone. This turns the plan into a target: how far is
// month-to-date spend from where it should be today, and how many more posts
// does that buy? ingest_runs is the ledger — every post we ever bought is a row.
//
// Env (Vercel):
//   APIFY_MONTHLY_BUDGET_USD  prepaid usage to aim for (default 29)
//   APIFY_CYCLE_DAY           day of month the billing cycle starts (default 1)

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export const USD_PER_POST = 0.002          // harvestapi post-search, Starter plan
const USD_PER_EMPTY_RUN = 0.001            // "0-result query" event
const SAFETY = 0.92                        // aim for 92% of the plan; the ledger misses a little

export type Budget = {
  cycleStart: string
  daysInCycle: number
  dayOfCycle: number
  spentUsd: number
  targetUsd: number        // the whole cycle's target (plan × safety)
  paceUsd: number          // what we should have spent by now
  headroomPosts: number    // posts we can buy today and stay on pace (negative = over)
}

function cycleBounds(now = new Date()): { start: Date; end: Date } {
  const cycleDay = Math.min(28, Math.max(1, parseInt(process.env.APIFY_CYCLE_DAY || '1', 10) || 1))
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  let start = new Date(Date.UTC(y, m, cycleDay))
  if (now < start) start = new Date(Date.UTC(y, m - 1, cycleDay))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, cycleDay))
  return { start, end }
}

export async function apifyBudget(db: Db): Promise<Budget> {
  const plan = parseFloat(process.env.APIFY_MONTHLY_BUDGET_USD || '29') || 29
  const { start, end } = cycleBounds()
  const now = new Date()
  const daysInCycle = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  const dayOfCycle = Math.min(daysInCycle, Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1)

  const { data } = await db.from('ingest_runs')
    .select('posts_returned')
    .gte('run_at', start.toISOString())
  const rows = (data as { posts_returned: number | null }[] | null) ?? []
  const posts = rows.reduce((s, r) => s + (r.posts_returned ?? 0), 0)
  const empties = rows.filter((r) => !r.posts_returned).length
  const spentUsd = posts * USD_PER_POST + empties * USD_PER_EMPTY_RUN

  const targetUsd = plan * SAFETY
  // pace is measured to the END of today, so a run late in the day isn't penalised
  const paceUsd = targetUsd * (dayOfCycle / daysInCycle)
  const headroomPosts = Math.floor((paceUsd - spentUsd) / USD_PER_POST)

  return { cycleStart: start.toISOString().slice(0, 10), daysInCycle, dayOfCycle, spentUsd, targetUsd, paceUsd, headroomPosts }
}

/**
 * How a sweep should behave given the budget. Overage costs the same per post as
 * the prepaid credit, so there is no cliff at the plan — the point is to put the
 * marginal dollar on the queries that keep the most roles:
 *  - well behind pace: add bonus queries (the best yielders) at full size
 *  - roughly on pace: run as planned
 *  - ahead of pace: skip this run's queries whose 14-day kept-rate is under
 *    minKeptRate; the good ones still run at full size
 *  - at the cycle's target: only queries keeping half or more of what they return
 */
export function budgetMode(b: Budget): { mode: 'catch-up' | 'on-pace' | 'ease-off' | 'stop'; bonusQueries: number; minKeptRate: number } {
  if (b.spentUsd >= b.targetUsd) return { mode: 'stop', bonusQueries: 0, minKeptRate: 0.5 }
  const behindUsd = b.paceUsd - b.spentUsd
  if (behindUsd > 2) return { mode: 'catch-up', bonusQueries: Math.min(4, Math.floor(behindUsd / 0.04)), minKeptRate: 0 }  // $0.04 = one 20-post run
  if (behindUsd < -1.5) return { mode: 'ease-off', bonusQueries: 0, minKeptRate: 0.45 }
  return { mode: 'on-pace', bonusQueries: 0, minKeptRate: 0 }
}
