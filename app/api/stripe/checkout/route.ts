import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSessionClient } from '@/lib/supabase-session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY
  const price = process.env.STRIPE_PRICE_ID
  if (!key || !price) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })

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

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price, quantity: 1 }],
    ...(email ? { customer_email: email } : {}),
    ...(userId ? { client_reference_id: userId, metadata: { user_id: userId } } : {}),
    success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
