import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSessionClient } from '@/lib/supabase-session'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

const PORTAL_CONFIG = process.env.STRIPE_PORTAL_CONFIG ?? 'bpc_1UM7AGGvp4wVTRq8O7aN7d2x'

// Opens Stripe's hosted billing portal (cancel, update card, invoices) for the signed-in user.
export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })

  const { data: { user } } = await (await getSessionClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

  const stripe = new Stripe(key)
  const db = createServerClient()
  const { data: profile } = await db
    .from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle()
  let customer = profile?.stripe_customer_id as string | undefined

  // Fallback: premium granted by hand, or bought before we stored the customer id.
  // Look the customer up by email in Stripe and remember it for next time.
  if (!customer && user.email) {
    try {
      const found = await stripe.customers.list({ email: user.email, limit: 1 })
      customer = found.data[0]?.id
      if (customer) await db.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id)
    } catch (e) {
      console.error('[portal] customer lookup failed:', (e as Error).message)
    }
  }
  if (!customer) {
    console.error('[portal] no Stripe customer for user', user.id)
    return NextResponse.json({ error: 'no billing account' }, { status: 404 })
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer,
      configuration: PORTAL_CONFIG,
      return_url: new URL(req.url).origin,
    })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    console.error('[portal] failed:', (e as Error).message)
    return NextResponse.json({ error: 'portal failed' }, { status: 500 })
  }
}
