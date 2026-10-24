import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 300

// Drawing a post snapshot takes a couple of seconds the first time. This cron draws the ones a visitor is
// most likely to tap (the newest roles in the free feed) ahead of time, by requesting them through the
// public domain so they land in the edge cache. After that a title tap shows its snapshot straight away.
// Roles already cached cost almost nothing, so running twice an hour is cheap.
const SITE = 'https://www.backchanneljobs.com'
const FREE_DELAY_MS = 48 * 3600_000
const HOW_MANY = 60
const CONCURRENCY = 3

export async function GET(req: NextRequest) {
  const isCron = !!process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServerClient()
  const now = Date.now()
  const base = () => db.from('jobs').select('id')
    .eq('is_verified_job', true).or('quality.is.null,quality.neq.low').neq('raw_text', '')
  const [fresh, older] = await Promise.all([
    base().gte('posted_at', new Date(now - FREE_DELAY_MS).toISOString()).lte('posted_at', new Date(now).toISOString())
      .order('posted_at', { ascending: false }).limit(5),
    base().gte('posted_at', new Date(now - 14 * 86400_000).toISOString()).lt('posted_at', new Date(now - FREE_DELAY_MS).toISOString())
      .order('extracted_at', { ascending: false }).limit(HOW_MANY),
  ])
  const ids = [...(fresh.data ?? []), ...(older.data ?? [])].map((r) => String(r.id))

  const started = Date.now()
  let warmed = 0, failed = 0
  const queue = [...ids]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length && Date.now() - started < 240_000) {
      const id = queue.shift()!
      try {
        const r = await fetch(`${SITE}/api/post-snapshot?id=${encodeURIComponent(id)}`)
        await r.arrayBuffer()
        if (r.ok) warmed++; else failed++
      } catch { failed++ }
    }
  }))
  return NextResponse.json({ total: ids.length, warmed, failed })
}
