import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@/lib/supabase'
import { ipInfo } from '@/lib/ipHash'
import { validBuyToken } from '@/lib/winback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The "90 days for $39" button in campaign emails. A link cannot POST, so this GET builds the Stripe Checkout
// session for that member and redirects to it. The token ties the link to one member (HMAC of their id), so
// it cannot be pointed at someone else's account. Anything that goes wrong falls back to the offer page.

const PRICE_QUARTER = process.env.STRIPE_PRICE_QUARTER ?? 'price_1UM747Gvp4wVTRq88qxWobVJ'   // $39, one-time, 90 days
const SCANNER = /bot|scan|prefetch|preview|proofpoint|barracuda|mimecast|safelinks|crawler|spider|curl|python|headless/i

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const fallback = () => NextResponse.redirect(`${origin}/offer?src=email`, 303)
  const u = req.nextUrl.searchParams.get('u') ?? ''
  const t = req.nextUrl.searchParams.get('t') ?? ''
  const campaign = (req.nextUrl.searchParams.get('c') ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
  if (!/^[0-9a-f-]{36}$/i.test(u) || !validBuyToken(u, t)) return fallback()
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return fallback()

  try {
    const db = createServerClient()
    const { data: profile } = await db.from('profiles').select('email, stripe_customer_id').eq('id', u).maybeSingle()
    if (!profile?.email) return fallback()

    const stripe = new Stripe(key)
    let customerId: string | undefined
    const cid = profile.stripe_customer_id as string | undefined
    if (cid) {
      try { const c = await stripe.customers.retrieve(cid); if (!('deleted' in c && c.deleted)) customerId = cid } catch { /* fall back to email */ }
    }

    const ua = req.headers.get('user-agent') ?? ''
    const device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobi/i.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : 'desktop'
    const meta: Record<string, string> = { plan: 'quarter', device, user_id: u, src: 'email' }
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: PRICE_QUARTER, quantity: 1 }],
      ...(customerId ? { customer: customerId } : { customer_email: profile.email as string, customer_creation: 'always' as const }),
      client_reference_id: u,
      metadata: meta,
      mode: 'payment',
      success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/offer?src=email`,
      custom_text: { submit: { message: 'One payment for 90 days of Premium. It does not renew.' } },
    })

    // same first-party record the site's own checkout writes; link-scanner hits are not counted as started checkouts
    if (!SCANNER.test(ua)) {
      const { error } = await db.from('checkout_events').insert({
        stripe_session_id: session.id, user_id: u, email: profile.email, plan: 'quarter', src: 'email', device,
        user_agent: ua.slice(0, 400), ...ipInfo(req),
        utm_source: 'email', utm_medium: 'winback', utm_campaign: campaign || null,
      })
      if (error) console.error('[email-checkout] event insert failed:', error.message)
    }
    return session.url ? NextResponse.redirect(session.url, 303) : fallback()
  } catch (e) {
    console.error('[email-checkout]', (e as Error).message)
    return fallback()
  }
}
