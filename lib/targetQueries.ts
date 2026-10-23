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

// Query rows are matched case-insensitively: the widening ladder writes
// "Remote" and "United Kingdom", the onboarding toggle writes "remote", and the
// two used to become separate rows that Apify ran twice. ilike with the
// wildcards escaped is an exact match that ignores case.
const exact = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

async function findQuery(db: Db, queryText: string) {
  const { data } = await db.from('priority_queries')
    .select('id, user_count').ilike('query', exact(queryText)).limit(1).maybeSingle()
  return data
}

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
  const existing = await findQuery(db, queryText)
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
      const pq = await findQuery(db, queryText)
      if (!pq) continue
      const next = Math.max(0, (pq.user_count as number) - 1)
      await db.from('priority_queries')
        .update({ user_count: next, active: next > 0 })
        .eq('id', pq.id)
    }
  }
}

/**
 * Members whose pass ended more than LAPSE_GRACE_DAYS ago still holding targets: release
 * their queries and remove the targets. Called from the priority cron.
 *
 * This is housekeeping, not what stops the spending: queries stop running the moment a
 * pass ends (see activeMemberQueries). The grace only decides how long a returning member
 * finds their searches still set up, and keeping the rows costs nothing.
 */
export const LAPSE_GRACE_DAYS = 30

export async function releaseLapsedMembers(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - LAPSE_GRACE_DAYS * 86_400_000).toISOString()
  const { data: lapsed } = await db.from('profiles')
    .select('id, email, pass_expires_at')
    .lt('pass_expires_at', cutoff)
  if (!lapsed?.length) return 0
  let released = 0
  for (const p of lapsed) {
    const { data: theirs } = await db.from('user_targets').select('keyword, location').eq('user_id', p.id)
    if (!theirs?.length) continue
    await releaseTargets(db, theirs as Target[])
    await db.from('user_targets').delete().eq('user_id', p.id)
    console.log(`[targets] released ${theirs.length} targets for lapsed member ${p.email} (pass ended ${p.pass_expires_at})`)
    released++
  }
  return released
}

/**
 * A member is active when their pass is valid and they have opened the site in the last
 * ACTIVE_DAYS. Only active members' searches run on the schedule; a quiet member's targets
 * are kept, and their searches catch up the next time they visit (see staleQueriesFor).
 */
export const ACTIVE_DAYS = 3

/** Query texts, lower-cased, that an active member wants right now. */
export async function activeMemberQueries(db: Db): Promise<Set<string>> {
  const out = new Set<string>()
  const { data: members } = await db.from('profiles').select('id').gt('pass_expires_at', new Date().toISOString())
  const ids = (members ?? []).map((m) => m.id as string)
  if (!ids.length) return out
  const since = new Date(Date.now() - ACTIVE_DAYS * 86_400_000).toISOString()
  // One cheap lookup per member rather than reading every visit row (PostgREST caps a read at 1,000 rows)
  const seen = await Promise.all(ids.map(async (id) => {
    const { data } = await db.from('visits').select('user_id').eq('user_id', id).gte('visited_at', since).limit(1)
    return data?.length ? id : null
  }))
  const activeIds = seen.filter((x): x is string => !!x)
  if (!activeIds.length) return out
  const { data: targets } = await db.from('user_targets').select('keyword, location').in('user_id', activeIds)
  for (const t of targets ?? []) for (const q of queriesForTarget(t as Target)) out.add(q.toLowerCase())
  return out
}

/** This member's queries that have never run, or not within maxAgeMs. Uses each row's stored text. */
export async function staleQueriesFor(db: Db, userId: string, maxAgeMs = 12 * 3600_000): Promise<string[]> {
  const { data: targets } = await db.from('user_targets').select('keyword, location').eq('user_id', userId)
  if (!targets?.length) return []
  const texts = new Set<string>()
  for (const t of targets) for (const q of queriesForTarget(t as Target)) texts.add(q)
  const cutoff = Date.now() - maxAgeMs
  const rows = await Promise.all([...texts].map(async (q) => {
    const { data } = await db.from('priority_queries')
      .select('query, last_run_at').ilike('query', exact(q)).limit(1).maybeSingle()
    return data
  }))
  return rows
    .filter((r): r is { query: string; last_run_at: string | null } => !!r)
    .filter((r) => !r.last_run_at || Date.parse(r.last_run_at) < cutoff)
    .map((r) => String(r.query))
}
