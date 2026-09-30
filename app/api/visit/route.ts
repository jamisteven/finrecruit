import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { visitor_id, referrer } = await req.json()
    if (!visitor_id) return NextResponse.json({ ok: false })

    let userId: string | null = null
    try {
      const { getSessionClient } = await import('@/lib/supabase-session')
      const { data: { user } } = await (await getSessionClient()).auth.getUser()
      userId = user?.id ?? null
    } catch { /* anonymous */ }

    const { error } = await createServerClient().from('visits').insert({
      visitor_id,
      user_id: userId,
      referrer: referrer || null,
    })
    if (error) console.error('[visit]', error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
