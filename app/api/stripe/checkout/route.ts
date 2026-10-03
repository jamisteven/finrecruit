import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSessionClient } from '@/lib/supabase-session'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

type Plan = 'monthly' | 'quarter' | 'pass'

// Price / coupon IDs are not secrets. Env vars override them if you ever rotate.
const PRICES: Record<Plan, string | undefined> = {
  monthly: process.env.STRIPE_PRICE_MONTHLY ?? 'price_1UM731Gvp4wVTRq8vzu1iADF',   // $15 / month, recurring
  quarter: process.env.STRIPE_PRICE_QUARTER ?? 'price_1UM747Gvp4wVTRq88qxWobVJ',   // $39, one-time, 90 days
  pass: process.env.STRIPE_PRICE_ID,                                                // legacy $9 / 14-day pass
}
const INTRO_COUPON = process.env.STRIPE_COUPON_INTRO ?? 'ulbQ9TrL'                 // $6 off, once: first month = $9
const PORTAL_CONFIG = process.env.STRIPE_PORTAL_CONFIG ?? 'bpc_1UM7AGGvp4wVTRq8O7aN7d2x'

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })

  const body = await req.json().catch(() => null)
  const plan: Plan = body?.plan === 'quarter' || body?.plan === 'pass' ? body.plan : 'monthly'

  // Who is buying, on what, and how they found us (all best-effort, never blocks checkout)
  const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v ? v.slice(0, n) : null)
  const userAgent = clip(req.headers.get('user-agent'), 400)
  const uaDevice = /iPad|Tablet/i.test(userAgent ?? '') || (/Android/i.test(userAgent ?? '') && !/Mobi/i.test(userAgent ?? ''))
    ? 'tablet' : /Mobi|iPhone|Android/i.test(userAgent ?? '') ? 'mobile' : 'desktop'
  const device = ['mobile', 'tablet', 'desktop'].includes(body?.device) ? (body.device as string) : uaDevice
  const visitorId = clip(body?.visitor_id, 80)
  const attr = (body?.attribution && typeof body.attribution === 'object' ? body.attribution : {}) as Record<string, unknown>
  const price = PRICES[plan]
  if (!price) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })

  // If they happen to be signed in, pre-fill and tag the session
  let email: string | undefined
  let userId: string | undefined
  try {
    const { data: { user } } = await (await getSessionClient()).auth.getUser()
    email = user?.email ?? undefined
    userId = user?.id ?? undefined
  } catch { /* anonymous checkout is fine */ }

  const origin = new URL(req.url).origin
  const stripe = new Stripe(key)

  // Reuse their Stripe customer so every purchase sits under one billing record
  // (the billing portal manages one customer per account).
  let customerId: string | undefined
  let subscriptionId: string | undefined
  if (userId) {
    try {
      const { data: profile } = await createServerClient()
        .from('profiles').select('stripe_customer_id, stripe_subscription_id').eq('id', userId).maybeSingle()
      const cid = profile?.stripe_customer_id as string | undefined
      if (cid) {
        const c = await stripe.customers.retrieve(cid)
        if (!('deleted' in c && c.deleted)) customerId = cid
      }
      subscriptionId = (profile?.stripe_subscription_id as string | undefined) || undefined
    } catch { /* fall back to email */ }
  }

  // Already subscribed? Send them to manage it instead of starting a second subscription.
  if (plan === 'monthly' && customerId && subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') {
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          configuration: PORTAL_CONFIG,
          return_url: origin,
        })
        return NextResponse.json({ url: portal.url })
      }
    } catch { /* stale id: continue to a normal checkout */ }
  }

  const meta: Record<string, string> = {
    plan, device,
    ...(userId ? { user_id: userId } : {}),
    ...(visitorId ? { visitor_id: visitorId } : {}),
  }
  const common = {
    line_items: [{ price, quantity: 1 }],
    ...(customerId ? { customer: customerId } : email ? { customer_email: email } : {}),
    ...(userId ? { client_reference_id: userId } : {}),
    metadata: meta,
    success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/offer`,
  }

  const session = plan === 'monthly'
    ? await stripe.checkout.sessions.create({
        ...common,
        mode: 'subscription',
        discounts: [{ coupon: INTRO_COUPON }],
        subscription_data: { metadata: meta },
        custom_text: { submit: { message: 'First month $9, then $15 per month until you cancel. Cancel anytime from your account menu.' } },
      })
    : await stripe.checkout.sessions.create({
        ...common,
        mode: 'payment',
        // gives one-time buyers a customer record too (billing portal, future purchases)
        ...(customerId ? {} : { customer_creation: 'always' as const }),
        custom_text: { submit: { message: plan === 'quarter' ? 'One payment for 90 days of early access. It does not renew.' : 'One payment for 14 days of early access. It does not renew.' } },
      })

  // First-party record of every checkout started: one row per click, marked paid by the webhook.
  try {
    const { error } = await createServerClient().from('checkout_events').insert({
      stripe_session_id: session.id,
      visitor_id: visitorId,
      user_id: userId ?? null,
      email: email ?? null,
      plan,
      device,
      user_agent: userAgent,
      referrer: clip(attr.referrer, 300),
      utm_source: clip(attr.utm_source, 100),
      utm_medium: clip(attr.utm_medium, 100),
      utm_campaign: clip(attr.utm_campaign, 100),
      landing_path: clip(attr.landing_path, 200),
    })
    if (error) console.error('[checkout] event insert failed:', error.message)
  } catch (e) { console.error('[checkout] event insert error:', (e as Error).message) }

  return NextResponse.json({ url: session.url })
}
