import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    let userId: string | null = null
    try {
      const { getSessionClient } = await import('@/lib/supabase-session')
      const { data: { user } } = await (await getSessionClient()).auth.getUser()
      userId = user?.id ?? null
    } catch { /* anonymous click */ }

    const db = createServerClient()
    const { error } = await db.from('job_clicks').insert({
      job_id: body.job_id ?? null,
      user_id: userId,
      visitor_id: body.visitor_id ?? null,
      sector: body.sector ?? null,
      location: body.location ?? null,
      seniority: body.seniority ?? null,
      quality: body.quality ?? null,
      list_position: body.list_position ?? null,
      age_days: body.age_days ?? null,
    })
    if (error) console.error('[track] insert failed:', error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
