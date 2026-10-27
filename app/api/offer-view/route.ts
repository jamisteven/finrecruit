import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { ipInfo } from '@/lib/ipHash'

export const runtime = 'nodejs'

// One row per /offer page view, with the link that led there (?src=recruiter_line, feed_top,
// locked_title, hero_plan, …). Read together with checkout_events.src to see which entry points
// turn into checkouts. Service role; the table is not readable by anon.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v ? v.slice(0, n) : null)
    const visitorId = clip(body?.visitor_id, 80)
    if (!visitorId) return NextResponse.json({ ok: false })

    let userId: string | null = null
    try {
      const { getSessionClient } = await import('@/lib/supabase-session')
      const { data: { user } } = await (await getSessionClient()).auth.getUser()
      userId = user?.id ?? null
    } catch { /* anonymous */ }

    const { error } = await createServerClient().from('offer_views').insert({
      visitor_id: visitorId,
      user_id: userId,
      src: clip(body?.src, 60),
      fresh: Number.isFinite(body?.fresh) ? Math.max(0, Math.floor(body.fresh)) : null,
      has_pass: !!body?.has_pass,
      referrer: clip(req.headers.get('referer'), 300),
      ...ipInfo(req),
    })
    if (error) console.error('[offer-view]', error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
