import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { createServerClient } from '@/lib/supabase'
import { membersPanel, demandPanel, engagementPanel, supplyPanel, growthPanel } from '@/lib/analytics'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const panel = new URL(req.url).searchParams.get('panel') ?? 'all'
  const db = createServerClient()
  try {
    const out: Record<string, unknown> = { generatedAt: new Date().toISOString() }
    // 'all' is the four fast panels; growth reads 90 days of visits, so the page asks for it when its tab opens
    const want = (p: string) => panel === 'all' || panel === p
    const [members, demand, engagement, supply, growth] = await Promise.all([
      want('members') ? membersPanel(db) : null,
      want('demand') ? demandPanel(db) : null,
      want('engagement') ? engagementPanel(db) : null,
      want('supply') ? supplyPanel(db) : null,
      panel === 'growth' ? growthPanel(db) : null,
    ])
    if (members) out.members = members
    if (demand) out.demand = demand
    if (engagement) out.engagement = engagement
    if (supply) out.supply = supply
    if (growth) out.growth = growth
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
