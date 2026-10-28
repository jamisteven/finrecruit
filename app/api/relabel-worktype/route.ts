import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { inferWorkType } from '@/lib/workType'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

// One-off: give jobs with no work type the one their own location lines state ("Location: San Jose, CA / Remote").
// No Apify, no classifier. Only rows with work_type null are touched; existing labels are never changed.
//
//   POST { days: 60, dryRun: true, afterId: 0, limit: 1000 }   header x-ingest-secret
//
// dryRun (the default) writes nothing. Call again with the returned nextAfterId until done is true.

export async function POST(req: NextRequest) {
  if (!process.env.INGEST_SECRET || req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const days = Math.min(120, Math.max(1, Number(body.days) || 60))
  const dryRun = body.dryRun !== false
  const afterId = Number(body.afterId) || 0
  const limit = Math.min(2000, Math.max(1, Number(body.limit) || 1000))

  const db = createServerClient()
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await db.from('jobs')
    .select('id, title, company, location, tags, raw_text')
    .is('work_type', null)
    .or(`posted_at.gte.${cutoff},and(posted_at.is.null,extracted_at.gte.${cutoff})`)
    .gt('id', afterId)
    .order('id', { ascending: true }).limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data ?? []

  const out = { dryRun, scanned: rows.length, Remote: 0, Hybrid: 0, 'On-site': 0, updated: 0, errors: 0,
    samples: [] as { title: string; company: string | null; location: string | null; to: string }[],
    nextAfterId: rows.length ? Number(rows[rows.length - 1].id) : afterId, done: rows.length < limit }

  const changes: { id: number; wt: 'Remote' | 'Hybrid' | 'On-site' }[] = []
  for (const r of rows) {
    const wt = inferWorkType(r.location, r.tags, r.title, r.raw_text)
    if (!wt) continue
    out[wt]++
    changes.push({ id: r.id, wt })
    if (out.samples.length < 30) out.samples.push({ title: r.title, company: r.company, location: r.location, to: wt })
  }
  if (!dryRun) {
    for (let i = 0; i < changes.length; i += 20) {
      await Promise.all(changes.slice(i, i + 20).map(async (c) => {
        const { error: e } = await db.from('jobs').update({ work_type: c.wt }).eq('id', c.id).is('work_type', null)
        if (e) out.errors++; else out.updated++
      }))
    }
  }
  return NextResponse.json(out)
}
