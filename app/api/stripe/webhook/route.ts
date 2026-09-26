import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY
  const whsec = process.env.STRIPE_WEBHOOK_SECRET
  if (!key || !whsec) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = new Stripe(key).webhooks.constructEvent(raw, req.headers.get('stripe-signature') ?? '', whsec)
  } catch (e) {
    console.error('[stripe] bad signature:', (e as Error).message)
    return NextResponse.json({ error: 'bad signature' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') return NextResponse.json({ received: true })

  const s = event.data.object as Stripe.Checkout.Session
  const db = createServerClient()
  const expires = new Date(Date.now() + 14 * 86400_000).toISOString()
  const email = s.customer_details?.email ?? s.customer_email ?? null

  let userId = s.metadata?.user_id ?? s.client_reference_id ?? null

  if (!userId && email) {
    // find an existing account, otherwise create one
    const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
    if (existing) {
      userId = existing.id as string
    } else {
      const { data: created, error: createErr } = await db.auth.admin.createUser({
        email,
        email_confirm: true,
      })
      if (createErr) console.error('[stripe] user create failed:', createErr.message)
      userId = created?.user?.id ?? null
    }
  }

  if (!userId) {
    console.error('[stripe] could not resolve a user for session', s.id, email)
    return NextResponse.json({ received: true })
  }

  const { error } = await db.from('profiles')
    .update({ pass_expires_at: expires, stripe_customer_id: String(s.customer ?? '') })
    .eq('id', userId)

  if (error) console.error('[stripe] profile update failed:', error.message)
  else console.log('[stripe] pass granted to', userId, 'until', expires)

  return NextResponse.json({ received: true })
}
