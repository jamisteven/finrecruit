import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { createServerClient } from '@/lib/supabase'
import { membersPanel, demandPanel, engagementPanel, supplyPanel } from '@/lib/analytics'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const panel = new URL(req.url).searchParams.get('panel') ?? 'all'
  const db = createServerClient()
  try {
    const out: Record<string, unknown> = { generatedAt: new Date().toISOString() }
    const want = (p: string) => panel === 'all' || panel === p
    const [members, demand, engagement, supply] = await Promise.all([
      want('members') ? membersPanel(db) : null,
      want('demand') ? demandPanel(db) : null,
      want('engagement') ? engagementPanel(db) : null,
      want('supply') ? supplyPanel(db) : null,
    ])
    if (members) out.members = members
    if (demand) out.demand = demand
    if (engagement) out.engagement = engagement
    if (supply) out.supply = supply
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
