import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const { session_id } = await req.json()
  if (!session_id) return NextResponse.json({ error: 'missing session' }, { status: 400 })

  // The session id is the proof — only a real, paid session yields a link
  let s: Stripe.Checkout.Session
  try {
    s = await new Stripe(key).checkout.sessions.retrieve(String(session_id))
  } catch (e) {
    console.error('[claim] session lookup failed:', (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  if (s.payment_status !== 'paid') {
    return NextResponse.json({ error: `payment_status is ${s.payment_status}` }, { status: 403 })
  }

  const email = s.customer_details?.email ?? s.customer_email
  if (!email) return NextResponse.json({ error: 'no email on session' }, { status: 400 })

  const db = createServerClient()

  // Grant the pass here rather than waiting on the webhook, so the feed is
  // already unlocked by the time they land back on it.
  let userId = s.metadata?.user_id ?? s.client_reference_id ?? null
  if (!userId) {
    const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
    if (existing) userId = existing.id as string
    else {
      const { data: created } = await db.auth.admin.createUser({ email, email_confirm: true })
      userId = created?.user?.id ?? null
    }
  }
  if (userId) {
    await db.from('profiles')
      .update({
        pass_expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
        stripe_customer_id: String(s.customer ?? ''),
      })
      .eq('id', userId)
  }

  const origin = new URL(req.url).origin
  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${origin}/auth/callback` },
  })

  if (error || !data?.properties?.action_link) {
    console.error('[claim] link generation failed:', error?.message)
    return NextResponse.json({ error: 'could not sign in' }, { status: 500 })
  }

  console.log("[claim] action_link:", data.properties.action_link)
  return NextResponse.json({ url: data.properties.action_link })
  } catch (e) {
    console.error('[claim] unhandled:', (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
