import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

const PASS_DAYS: Record<string, number> = { pass: 14, quarter: 90 }
// A renewal can land a little after the period rolls over; don't lock people out meanwhile.
const GRACE_MS = 24 * 3600_000

type Db = ReturnType<typeof createServerClient>

const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : (v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null)

// Find the account for a payment, or create one (checkout works without signing in first).
async function resolveUserId(db: Db, hint: string | null, email: string | null, customerId: string | null): Promise<string | null> {
  if (hint) return hint
  if (customerId) {
    const { data } = await db.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle()
    if (data) return data.id as string
  }
  if (!email) return null
  const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existing) return existing.id as string

  const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true })
  if (created?.user?.id) return created.user.id
  // Two events for the same purchase can race to create the account: look again.
  console.error('[stripe] user create failed:', error?.message)
  await new Promise((r) => setTimeout(r, 1000))
  const { data: again } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
  return (again?.id as string | undefined) ?? null
}

// Only ever move the expiry forward.
async function setExpiry(db: Db, userId: string, until: Date, extra: Record<string, unknown>) {
  const { data: cur } = await db.from('profiles').select('pass_expires_at').eq('id', userId).maybeSingle()
  const current = cur?.pass_expires_at ? new Date(cur.pass_expires_at as string) : null
  const next = current && current > until ? current : until
  const { error } = await db.from('profiles').update({ pass_expires_at: next.toISOString(), ...extra }).eq('id', userId)
  if (error) throw new Error(error.message)
  console.log('[stripe] pass set for', userId, 'until', next.toISOString())
}

// Subscription access runs to the end of the period that has been paid for.
async function grantFromSubscription(stripe: Stripe, db: Db, subId: string, userId: string, customerId: string | null) {
  const sub = await stripe.subscriptions.retrieve(subId)
  if (!['active', 'trialing', 'past_due'].includes(sub.status)) return
  // newer API versions keep the period on the item, older ones on the subscription
  const endSec: number | undefined =
    (sub as any).items?.data?.[0]?.current_period_end ?? (sub as any).current_period_end
  if (!endSec) throw new Error('subscription has no period end')
  await setExpiry(db, userId, new Date(endSec * 1000 + GRACE_MS), {
    stripe_subscription_id: sub.id,
    ...(customerId ? { stripe_customer_id: customerId } : {}),
  })
}

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY
  const whsec = process.env.STRIPE_WEBHOOK_SECRET
  if (!key || !whsec) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const raw = await req.text()
  const stripe = new Stripe(key)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, req.headers.get('stripe-signature') ?? '', whsec)
  } catch (e) {
    console.error('[stripe] bad signature:', (e as Error).message)
    return NextResponse.json({ error: 'bad signature' }, { status: 400 })
  }

  const db = createServerClient()

  try {
    // ── First payment (all plans) ──────────────────────────────────────────
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session
      const email = s.customer_details?.email ?? s.customer_email ?? null
      const customerId = idOf(s.customer)
      const plan = s.metadata?.plan ?? 'pass'

      const userId = await resolveUserId(db, s.metadata?.user_id ?? s.client_reference_id ?? null, email, customerId)
      if (!userId) {
        console.error('[stripe] could not resolve a user for session', s.id, email)
        return NextResponse.json({ error: 'user unresolved' }, { status: 500 })   // Stripe retries
      }

      if (s.mode === 'subscription') {
        const subId = idOf(s.subscription)
        if (subId) await grantFromSubscription(stripe, db, subId, userId, customerId)
      } else if (s.payment_status === 'paid') {
        // one-time purchase: extend from today, or from the current expiry if they still have days left
        const { data: cur } = await db.from('profiles').select('pass_expires_at, last_checkout_session').eq('id', userId).maybeSingle()
        if (cur?.last_checkout_session === s.id) return NextResponse.json({ received: true })   // retried event
        const base = cur?.pass_expires_at && new Date(cur.pass_expires_at as string) > new Date()
          ? new Date(cur.pass_expires_at as string) : new Date()
        const until = new Date(base.getTime() + (PASS_DAYS[plan] ?? 14) * 86400_000)
        await setExpiry(db, userId, until, {
          last_checkout_session: s.id,
          ...(customerId ? { stripe_customer_id: customerId } : {}),
        })
      }
      return NextResponse.json({ received: true })
    }

    // ── Renewals (and the first invoice) ───────────────────────────────────
    if (event.type === 'invoice.paid') {
      const inv = event.data.object as any
      const subId = idOf(inv.subscription ?? inv.parent?.subscription_details?.subscription)
      if (!subId) return NextResponse.json({ received: true })   // not a subscription invoice

      const customerId = idOf(inv.customer)
      const sub = await stripe.subscriptions.retrieve(subId)
      const userId = await resolveUserId(db, sub.metadata?.user_id ?? null, inv.customer_email ?? null, customerId)
      if (!userId) {
        console.error('[stripe] could not resolve a user for invoice', inv.id)
        return NextResponse.json({ error: 'user unresolved' }, { status: 500 })
      }
      await grantFromSubscription(stripe, db, subId, userId, customerId)
      return NextResponse.json({ received: true })
    }

    // ── Cancelled / ended: access simply runs out at the end of the paid period ─
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      await db.from('profiles').update({ stripe_subscription_id: null }).eq('stripe_subscription_id', sub.id)
      return NextResponse.json({ received: true })
    }
  } catch (e) {
    console.error('[stripe] webhook handler failed:', event.type, (e as Error).message)
    return NextResponse.json({ error: 'handler failed' }, { status: 500 })   // Stripe retries
  }

  return NextResponse.json({ received: true })
}