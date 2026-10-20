import { NextResponse } from 'next/server'
import { getSessionClient } from '@/lib/supabase-session'
import { createServerClient } from '@/lib/supabase'
import { memberStatus } from '@/lib/targetStatus'

export const dynamic = 'force-dynamic'

/** The signed-in member's searches: run yet, when, how many matches. */
export async function GET() {
  try {
    const { data: { user } } = await (await getSessionClient()).auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
    const status = await memberStatus(createServerClient(), user.id)
    return NextResponse.json(status, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
