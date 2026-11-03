import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@/lib/supabase'
import { logSubscriptionEvent, memberOf, iso } from '@/lib/subscriptionLog'

export const runtime = 'nodejs'
export const maxDuration = 120

// One-off catch-up for the churn log (supabase/2026-11-04-subscription-events.sql): reads every subscription from
// Stripe and records when it started, when a cancel was scheduled, and when it ended, using the dates Stripe holds.
// Safe to run again: each row has a fixed id, so nothing is stored twice. Renewals are not backfilled (the first
// ones fall due in November); from here on the webhook logs them as they happen.
//
//   curl -X POST https://www.backchanneljobs.com/api/stripe/backfill-subscriptions -H "x-ingest-secret: $INGEST_SECRET"
export async function POST(req: NextRequest) {
  if (!process.env.INGEST_SECRET || req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const stripe = new Stripe(key)
  const db = createServerClient()
  const counts = { subscriptions: 0, started: 0, cancel_scheduled: 0, ended: 0 }

  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) {
    counts.subscriptions++
    const customer = typeof sub.customer === 'object' && sub.customer && !('deleted' in sub.customer && sub.customer.deleted) ? (sub.customer as Stripe.Customer) : null
    const who = await memberOf(db, sub.id, customer?.id ?? null)
    const base = { stripe_subscription_id: sub.id, user_id: who.id, email: who.email ?? customer?.email ?? null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const periodEnd = iso(sub.cancel_at ?? (sub as any).items?.data?.[0]?.current_period_end ?? (sub as any).current_period_end)

    await logSubscriptionEvent(db, { ...base, stripe_event_id: `backfill:started:${sub.id}`, kind: 'started', occurred_at: iso(sub.start_date ?? sub.created) as string })
    counts.started++

    if (sub.status === 'canceled') {
      await logSubscriptionEvent(db, {
        ...base, stripe_event_id: `backfill:ended:${sub.id}`, kind: 'ended',
        occurred_at: iso(sub.ended_at ?? sub.canceled_at ?? sub.created) as string, period_end: iso(sub.ended_at),
        reason: sub.cancellation_details?.feedback ?? sub.cancellation_details?.reason ?? null,
        comment: sub.cancellation_details?.comment ?? null,
      })
      counts.ended++
    } else if (sub.cancel_at_period_end || sub.cancel_at) {
      // canceled_at is when the member clicked cancel, even though access runs on to the period end
      await logSubscriptionEvent(db, {
        ...base, stripe_event_id: `backfill:cancel:${sub.id}`, kind: 'cancel_scheduled',
        occurred_at: iso(sub.canceled_at ?? sub.created) as string, period_end: periodEnd,
        reason: sub.cancellation_details?.feedback ?? sub.cancellation_details?.reason ?? null,
        comment: sub.cancellation_details?.comment ?? null,
      })
      counts.cancel_scheduled++
    }
  }
  return NextResponse.json({ ok: true, ...counts })
}
