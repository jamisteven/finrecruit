// How many posts to buy from Apify for a query, and whether a member query is
// worth re-running yet. Apify charges per post returned, before we can see the
// text, so the only lever on that bill is asking for fewer posts from queries
// whose last visit was mostly repeats or mostly junk.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export const FULL_BATCH = 20
// A query's very first visit reaches back through the month of posts, so a new member starts with a full
// feed instead of only the newest 20. Later visits go back to the small top-ups below.
export const FIRST_BATCH = 70
const TINY_BATCH = 5

type Run = { query: string; posts_returned: number | null; jobs_inserted: number | null; duplicates_skipped: number | null; run_at: string }

/**
 * Batch size for the next visit to `query`, sized from how many NEW posts the last
 * visit found (returned minus already-seen), with headroom:
 *   next = clamp(ceil(new * 1.5) + 2, 5, 20)
 * A full batch that was all new means we may have hit the cap and missed some, so
 * it stays at 20. A full batch with nothing new drops to 5. A query with no history
 * gets the full batch. (The old rule used the share of repeats, which starved busy
 * queries: 10 new + 10 repeats read as "50% repeats" and asked for 5 next time.)
 */
export async function batchSizeFor(db: Db, pipeline: string, query: string, opts: { firstBatch?: number } = {}): Promise<{ maxPosts: number; why: string }> {
  const { data } = await db.from('ingest_runs')
    .select('query, posts_returned, jobs_inserted, duplicates_skipped, run_at')
    .eq('pipeline', pipeline).ilike('query', query)
    .order('run_at', { ascending: false }).limit(1)
  const last = (data as Run[] | null)?.[0]
  if (!last || !last.posts_returned) return { maxPosts: opts.firstBatch ?? FULL_BATCH, why: 'no history' }
  const returned = last.posts_returned
  const fresh = Math.max(0, returned - (last.duplicates_skipped ?? 0))
  if (returned >= FULL_BATCH && fresh >= returned) return { maxPosts: FULL_BATCH, why: `all ${fresh} new last run — may have missed some` }
  const next = Math.min(FULL_BATCH, Math.max(TINY_BATCH, Math.ceil(fresh * 1.5) + 2))
  return { maxPosts: next, why: `${fresh} new of ${returned} last run` }
}

/**
 * Member queries that LinkedIn barely has posts for ("market maker Switzerland")
 * shouldn't be bought every 12 hours. A query is a dud when each of its last two
 * runs returned a real batch (>=10 posts) and kept at most one job. Duds wait
 * DUD_COOLDOWN_DAYS between visits; the widened regional query covers the member
 * in the meantime.
 */
export const DUD_COOLDOWN_DAYS = 4

export async function findDuds(db: Db, pipeline: string, queries: string[]): Promise<Set<string>> {
  if (!queries.length) return new Set()
  const { data } = await db.from('ingest_runs')
    .select('query, posts_returned, jobs_inserted, duplicates_skipped, run_at')
    .eq('pipeline', pipeline).in('query', queries)
    .order('run_at', { ascending: false }).limit(queries.length * 6)
  const byQuery = new Map<string, Run[]>()
  for (const r of (data as Run[] | null) ?? []) {
    const k = r.query.toLowerCase()
    const arr = byQuery.get(k) ?? []
    if (arr.length < 2) { arr.push(r); byQuery.set(k, arr) }
  }
  const duds = new Set<string>()
  for (const q of queries) {
    const runs = byQuery.get(q.toLowerCase()) ?? []
    if (runs.length === 2 && runs.every((r) => (r.posts_returned ?? 0) >= 10 && (r.jobs_inserted ?? 0) <= 1)) duds.add(q)
  }
  return duds
}

/**
 * Kept-rate per query over the last 14 days: jobs inserted / posts returned.
 * Queries with fewer than 40 posts in the window are treated as unknown (null).
 */
export async function keptRates(db: Db, pipeline: string, queries: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(queries.map((q) => [q.toLowerCase(), null]))
  if (!queries.length) return out
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data } = await db.from('ingest_runs')
    .select('query, posts_returned, jobs_inserted')
    .eq('pipeline', pipeline).in('query', queries).gte('run_at', since)
  const agg = new Map<string, { posts: number; kept: number }>()
  for (const r of (data as { query: string; posts_returned: number | null; jobs_inserted: number | null }[] | null) ?? []) {
    const k = r.query.toLowerCase()
    const a = agg.get(k) ?? { posts: 0, kept: 0 }
    a.posts += r.posts_returned ?? 0; a.kept += r.jobs_inserted ?? 0
    agg.set(k, a)
  }
  for (const [k, a] of agg) if (a.posts >= 40) out.set(k, a.kept / a.posts)
  return out
}
