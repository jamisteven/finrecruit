import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export type SubscriptionEvent = {
  stripe_event_id: string
  stripe_subscription_id: string
  user_id?: string | null
  email?: string | null
  kind: 'started' | 'renewed' | 'cancel_scheduled' | 'cancel_undone' | 'ended'
  occurred_at: string
  period_end?: string | null
  reason?: string | null
  comment?: string | null
}

/**
 * Records one thing that happened to a subscription (supabase/2026-11-04-subscription-events.sql).
 * Never throws: this is bookkeeping, and a failure here must not make Stripe retry a payment event.
 * The unique Stripe event id means a retried event is stored once.
 */
export async function logSubscriptionEvent(db: Db, ev: SubscriptionEvent): Promise<void> {
  try {
    const { error } = await db.from('subscription_events').upsert(ev, { onConflict: 'stripe_event_id', ignoreDuplicates: true })
    if (error) console.error('[stripe] subscription log skipped:', error.message)
  } catch (e) {
    console.error('[stripe] subscription log failed:', (e as Error).message)
  }
}

export const iso = (sec?: number | null): string | null => (sec ? new Date(sec * 1000).toISOString() : null)

// Who a subscription belongs to, for the churn log (best effort: the log row is kept even if this finds nobody)
export async function memberOf(db: Db, subId: string, customerId: string | null): Promise<{ id: string | null; email: string | null }> {
  try {
    const { data } = await db.from('profiles').select('id, email').eq('stripe_subscription_id', subId).maybeSingle()
    if (data) return { id: data.id as string, email: (data.email as string | null) ?? null }
    if (customerId) {
      const { data: c } = await db.from('profiles').select('id, email').eq('stripe_customer_id', customerId).maybeSingle()
      if (c) return { id: c.id as string, email: (c.email as string | null) ?? null }
    }
  } catch { /* log without a member */ }
  return { id: null, email: null }
}
