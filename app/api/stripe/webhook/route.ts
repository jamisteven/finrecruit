import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY
  const whsec = process.env.STRIPE_WEBHOOK_SECRET
  if (!key || !whsec) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const raw = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = new Stripe(key).webhooks.constructEvent(raw, sig, whsec)
  } catch (e) {
    console.error('[stripe] bad signature:', (e as Error).message)
    return NextResponse.json({ error: 'bad signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session
    const userId = s.metadata?.user_id ?? s.client_reference_id
    if (!userId) {
      console.error('[stripe] no user_id on session', s.id)
      return NextResponse.json({ received: true })
    }

    const expires = new Date(Date.now() + 14 * 86400_000).toISOString()
    const { error } = await createServerClient()
      .from('profiles')
      .update({ pass_expires_at: expires, stripe_customer_id: String(s.customer ?? '') })
      .eq('id', userId)

    if (error) console.error('[stripe] profile update failed:', error.message)
    else console.log('[stripe] pass granted to', userId, 'until', expires)
  }

  return NextResponse.json({ received: true })
}
