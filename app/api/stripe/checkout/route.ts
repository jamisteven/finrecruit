import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSessionClient } from '@/lib/supabase-session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY
  const price = process.env.STRIPE_PRICE_ID
  if (!key || !price) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const supabase = await getSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  }

  const origin = new URL(req.url).origin
  const stripe = new Stripe(key)

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price, quantity: 1 }],
    customer_email: user.email,
    client_reference_id: user.id,
    metadata: { user_id: user.id },
    success_url: `${origin}/?paid=1`,
    cancel_url: `${origin}/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
