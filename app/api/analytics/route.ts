import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { createServerClient } from '@/lib/supabase'
import { membersPanel, demandPanel, engagementPanel, supplyPanel, growthPanel } from '@/lib/analytics'
import { cacheGet, cachePut } from '@/lib/analyticsCache'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Building a panel reads thousands of rows from Supabase, and reloading the page was the way to see fresh numbers.
// A finished panel is kept (in memory, and in the analytics_cache table so other server instances share it) and
// reloads within the window cost nothing. ?fresh=1 skips it. The default members view is only the last day's new
// members, so it is cheap to rebuild and kept for a short time.
const NEW_MEMBER_HOURS = 24
const ttlFor = (key: string) => (key === 'members:new' ? 5 * 60_000 : key === 'members:all' ? 15 * 60_000 : 30 * 60_000)
const cache = new Map<string, { at: number; out: Record<string, unknown> }>()

export async function GET(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const params = new URL(req.url).searchParams
  const panel = params.get('panel') ?? 'all'
  const scope = params.get('scope') === 'all' ? 'all' : 'new'
  const key = panel === 'members' ? `members:${scope}` : panel
  const ttl = ttlFor(key)
  const headers = { 'Cache-Control': 'private, no-store' }
  const db = createServerClient()

  if (params.get('fresh') !== '1') {
    const mem = cache.get(key)
    if (mem && Date.now() - mem.at < ttl) return NextResponse.json(mem.out, { headers })
    const shared = await cacheGet(db, key, ttl)
    if (shared) { cache.set(key, shared); return NextResponse.json(shared.out, { headers }) }
  }
  try {
    const out: Record<string, unknown> = { generatedAt: new Date().toISOString() }
    // 'all' is the four fast panels; growth reads 90 days of data, so the page asks for it when its tab opens
    const want = (p: string) => panel === 'all' || panel === p
    const [members, demand, engagement, supply, growth] = await Promise.all([
      want('members') ? membersPanel(db, scope === 'all' ? {} : { sinceHours: NEW_MEMBER_HOURS }) : null,
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
    cache.set(key, { at: Date.now(), out })
    await cachePut(db, key, out)
    return NextResponse.json(out, { headers })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
