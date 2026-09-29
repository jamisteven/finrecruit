import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()

    let userId: string | null = null
    try {
      const { getSessionClient } = await import('@/lib/supabase-session')
      const { data: { user } } = await (await getSessionClient()).auth.getUser()
      userId = user?.id ?? null
    } catch { /* anonymous */ }

    const { error } = await createServerClient().from('search_events').insert({
      visitor_id: b.visitor_id ?? null,
      user_id: userId,
      term: b.term || null,
      sector: b.sector ?? null,
      locations: b.locations?.length ? b.locations : null,
      work_types: b.work_types?.length ? b.work_types : null,
      result_count: b.result_count ?? null,
    })
    if (error) console.error('[track-search]', error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
