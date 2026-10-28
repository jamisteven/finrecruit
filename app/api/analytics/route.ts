import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { createServerClient } from '@/lib/supabase'
import { membersPanel, demandPanel, engagementPanel, supplyPanel, growthPanel } from '@/lib/analytics'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Each load of the dashboard reads ~4 MB of rows from Supabase (~7 MB over the wire), and reloading the page was the
// way to see fresh numbers. A finished response is kept for a few minutes per panel; ?fresh=1 skips it.
const TTL_MS = 3 * 60_000
const cache = new Map<string, { at: number; out: Record<string, unknown> }>()

export async function GET(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const params = new URL(req.url).searchParams
  const panel = params.get('panel') ?? 'all'
  const hit = cache.get(panel)
  if (params.get('fresh') !== '1' && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.out, { headers: { 'Cache-Control': 'private, no-store' } })
  }
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
    cache.set(panel, { at: Date.now(), out })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
