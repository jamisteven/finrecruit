// How many posts to buy from Apify for a query, and whether a member query is
// worth re-running yet. Apify charges per post returned, before we can see the
// text, so the only lever on that bill is asking for fewer posts from queries
// whose last visit was mostly repeats or mostly junk.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export const FULL_BATCH = 20
const SMALL_BATCH = 10
const TINY_BATCH = 5

type Run = { query: string; posts_returned: number | null; jobs_inserted: number | null; duplicates_skipped: number | null; run_at: string }

/**
 * Batch size for the next visit to `query`, from its previous run in ingest_runs.
 *  - mostly repeats last time (>=50% already seen)  -> 5
 *  - a quarter or more repeats, or a dry query      -> 10
 *  - otherwise                                      -> 20
 * A query with no history gets the full batch.
 */
export async function batchSizeFor(db: Db, pipeline: string, query: string): Promise<{ maxPosts: number; why: string }> {
  const { data } = await db.from('ingest_runs')
    .select('query, posts_returned, jobs_inserted, duplicates_skipped, run_at')
    .eq('pipeline', pipeline).ilike('query', query)
    .order('run_at', { ascending: false }).limit(1)
  const last = (data as Run[] | null)?.[0]
  if (!last || !last.posts_returned) return { maxPosts: FULL_BATCH, why: 'no history' }
  const returned = last.posts_returned
  const dupShare = (last.duplicates_skipped ?? 0) / returned
  if (returned >= 10 && dupShare >= 0.5) return { maxPosts: TINY_BATCH, why: `${Math.round(dupShare * 100)}% repeats last run` }
  if (returned >= 10 && dupShare >= 0.25) return { maxPosts: SMALL_BATCH, why: `${Math.round(dupShare * 100)}% repeats last run` }
  if (returned < 5) return { maxPosts: SMALL_BATCH, why: `only ${returned} posts last run` }
  return { maxPosts: FULL_BATCH, why: 'fresh last run' }
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
