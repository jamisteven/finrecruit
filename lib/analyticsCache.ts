// Finished analytics panels, kept in the database so every server instance sees the same ones. Reading a panel
// from here costs a few hundred KB at most; building one reads thousands of rows. If the table has not been
// created yet (supabase/2026-11-02-analytics-egress.sql), every call is a quiet no-op and the page just builds each time.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export async function cacheGet(db: Db, key: string, ttlMs: number): Promise<{ at: number; out: Record<string, unknown> } | null> {
  try {
    // the age test is part of the query, so a stale row is never downloaded
    const { data, error } = await db.from('analytics_cache').select('payload, created_at')
      .eq('key', key).gte('created_at', new Date(Date.now() - ttlMs).toISOString()).maybeSingle()
    if (error || !data) return null
    return { at: Date.parse(data.created_at), out: data.payload as Record<string, unknown> }
  } catch { return null }
}

export async function cachePut(db: Db, key: string, out: Record<string, unknown>): Promise<void> {
  try { await db.from('analytics_cache').upsert({ key, payload: out, created_at: new Date().toISOString() }) } catch { /* no table yet */ }
}
