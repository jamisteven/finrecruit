// The Apify queries a saved target claims, and the bookkeeping on the shared
// priority_queries rows when a target is added or released.
//
// Each query row carries user_count: how many members currently want it. A
// save bumps it for queries new to that member; dropping a target, clearing
// them all, or cancelling decrements it, and a row at zero goes inactive so
// the rotation stops spending credit on it. The same rules apply to the
// widened (region-level) query a thin city earns, which used to be bumped on
// every save and never released.

import type { SupabaseClient } from '@supabase/supabase-js'
import { distilForQuery } from '@/lib/matchTarget'
import { wideningLadder } from '@/lib/widenLocation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export type Target = { keyword: string; location: string | null }

/** The region a thin city widens to, if any. */
export function widerLocation(location: string | null): string | null {
  if (!location) return null
  const wider = wideningLadder(location)[1]
  if (!wider?.location || wider.location.toLowerCase() === location.toLowerCase()) return null
  return wider.location
}

export function primaryQuery(t: Target): string {
  const qk = distilForQuery(String(t.keyword))
  return t.location ? `hiring ${qk} ${t.location}` : `hiring ${qk}`
}

export function widenedQueryFor(t: Target): string | null {
  const wider = widerLocation(t.location)
  return wider ? `hiring ${distilForQuery(String(t.keyword))} ${wider}` : null
}

/** Every query text a target can have claimed: its own, and its region's. */
export function queriesForTarget(t: Target): string[] {
  const w = widenedQueryFor(t)
  return w ? [primaryQuery(t), w] : [primaryQuery(t)]
}

/**
 * Add one member's claim on a query, creating the row if needed.
 * Returns whether the row existed before.
 */
export async function claimQuery(db: Db, queryText: string, keyword: string, location: string | null, isNewForUser: boolean): Promise<boolean> {
  const { data: existing } = await db.from('priority_queries')
    .select('id, user_count').eq('query', queryText).maybeSingle()
  if (existing) {
    if (isNewForUser) {
      await db.from('priority_queries')
        .update({ user_count: (existing.user_count as number) + 1, active: true })
        .eq('id', existing.id)
    }
    return true
  }
  await db.from('priority_queries').insert({ query: queryText, keyword, location })
  return false
}

/** Release one member's claim on every query these targets hold. */
export async function releaseTargets(db: Db, targets: Target[]): Promise<void> {
  const seen = new Set<string>()
  for (const t of targets) {
    for (const queryText of queriesForTarget(t)) {
      // Two cities in one region share a widened query; one member, one claim
      if (seen.has(queryText)) continue
      seen.add(queryText)
      const { data: pq } = await db.from('priority_queries')
        .select('id, user_count').eq('query', queryText).maybeSingle()
      if (!pq) continue
      const next = Math.max(0, (pq.user_count as number) - 1)
      await db.from('priority_queries')
        .update({ user_count: next, active: next > 0 })
        .eq('id', pq.id)
    }
  }
}
