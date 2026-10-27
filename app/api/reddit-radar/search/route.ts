import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { searchReddit } from '@/lib/redditRadar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Admin only. Runs the owner's Google queries against reddit.com and returns the merged threads.
export async function POST(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const body = await req.json().catch(() => ({}))
    const queries: string[] = Array.isArray(body.queries) ? body.queries.map(String) : []
    if (!queries.some((q) => q.trim())) return NextResponse.json({ error: 'Add at least one search' }, { status: 400 })
    return NextResponse.json(await searchReddit(queries, String(body.period ?? 'm')))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
