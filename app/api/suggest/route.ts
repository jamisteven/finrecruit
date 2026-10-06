import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const revalidate = 3600

// Suggestions come from what we actually hold, so a user can't pick something
// we have no hope of serving.
export async function GET() {
  try {
    const db = createServerClient()
    const { data } = await db
      .from('jobs')
      .select('title, location')
      .eq('is_verified_job', true)
      .neq('sector', 'other')
      .gte('posted_at', new Date(Date.now() - 30 * 86400_000).toISOString())
      .limit(4000)

    const locCount = new Map<string, number>()
    const titleCount = new Map<string, number>()

    for (const r of data ?? []) {
      if (r.location) {
        const l = String(r.location).trim()
        if (l.length < 40) locCount.set(l, (locCount.get(l) ?? 0) + 1)
      }
      if (r.title) {
        // Strip seniority and parenthetical noise to get the bare role
        const t = String(r.title)
          .replace(/\(.*?\)/g, '')
          .replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|chief|vp|director)\b/gi, '')
          .replace(/[^A-Za-z /&-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (t.length > 3 && t.length < 40) {
          const key = t.toLowerCase()
          titleCount.set(key, (titleCount.get(key) ?? 0) + 1)
        }
      }
    }

    const top = (m: Map<string, number>, n: number, min: number) =>
      [...m.entries()].filter(([, c]) => c >= min)
        .sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)

    return NextResponse.json({
      locations: top(locCount, 120, 2),
      titles: top(titleCount, 120, 3),
    })
  } catch {
    return NextResponse.json({ locations: [], titles: [] })
  }
}
