import { NextRequest, NextResponse } from 'next/server'
import { getSessionClient } from '@/lib/supabase-session'
import { createServerClient } from '@/lib/supabase'
import { previewCounts } from '@/lib/targetStatus'

export const dynamic = 'force-dynamic'

const clean = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim().slice(0, 60)).filter(Boolean).slice(0, max)

/** Counts only: how many roles a role + place would match right now. Used by the onboarding location step. */
export async function POST(req: NextRequest) {
  try {
    const { data: { user } } = await (await getSessionClient()).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const roles = clean(body.roles, 3)
    const locations = clean(body.locations, 4)
    if (!roles.length || !locations.length) return NextResponse.json({ rows: [], places: [] })
    const out = await previewCounts(createServerClient(), roles, locations)
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
