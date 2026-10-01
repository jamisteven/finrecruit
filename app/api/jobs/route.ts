import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'

// Free visitors see a role only once it is this old. Keep in sync with FREE_DELAY_HOURS in app/page.tsx.
const FREE_DELAY_HOURS = 48
const FREE_DELAY_MS = FREE_DELAY_HOURS * 3600_000
// Fresh roles a free visitor can read in full, then how many more are shown as a title only
const FREE_SAMPLE_COUNT = 3
const FREE_TITLE_ONLY_COUNT = 2

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const seniority = searchParams.get('seniority')
  const search = searchParams.get('search')
  const sector = searchParams.get('sector')
  const sortBy = searchParams.get('sortBy') || 'newest'
  const limit = parseInt(searchParams.get('limit') || '20000')
  const maxAgeDays = parseInt(searchParams.get('maxAge') || '30')
  const offset = parseInt(searchParams.get('offset') || '0')

  const db = createServerClient()

  // Pass holders see roles as they land; everyone else waits FREE_DELAY_HOURS
  let hasPass = false
  let passExpiresAt: string | null = null
  try {
    const session = await getSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (user) {
      const { data: profile, error: profErr } = await createServerClient()
        .from('profiles').select('pass_expires_at').eq('id', user.id).maybeSingle()
      passExpiresAt = profile?.pass_expires_at ?? null
      hasPass = !!profile?.pass_expires_at && new Date(profile.pass_expires_at) > new Date()
      if (profErr) console.error('[jobs] profile query error:', profErr.message)
      console.log('[jobs] user', user.id, 'expires', profile?.pass_expires_at, 'hasPass', hasPass)
    } else {
      console.log('[jobs] no user on request')
    }
  } catch { /* treat any failure as free tier */ }

  let query = db
    .from('jobs')
    .select('id, title, company, location, seniority, salary, apply_method, summary, tags, sector, post_url, author_name, author_headline, author_linkedin_url, author_avatar, posted_at, extracted_at, is_verified_job, quality, work_type', { count: 'exact' })
    .eq('is_verified_job', true)
    .or('quality.is.null,quality.neq.low')
    .neq('sector', 'other')
    .or(`posted_at.gte.${new Date(Date.now() - maxAgeDays * 86400000).toISOString()},posted_at.is.null`)
    .range(offset, offset + limit - 1)
    .order('extracted_at', { ascending: sortBy === 'oldest' })

  // Free tier: everything older than FREE_DELAY_HOURS, plus FREE_SAMPLE_COUNT fresh roles in full.
  // The next FREE_TITLE_ONLY_COUNT fresh roles go out as a title only (no id, company, link or summary),
  // so the page can tease them without anything to read or click.
  let previewIds: string[] = []
  let lockedJobs: { title: string; sector: string; posted_at: string | null }[] = []
  if (!hasPass) {
    const cutoff = new Date(Date.now() - FREE_DELAY_MS).toISOString()
    const { data: fresh } = await db.from('jobs')
      .select('id, title, sector, posted_at')
      .eq('is_verified_job', true)
      .or('quality.is.null,quality.neq.low')
      .neq('sector', 'other')
      .gte('posted_at', cutoff)
      .order('posted_at', { ascending: false })
      .limit(FREE_SAMPLE_COUNT + FREE_TITLE_ONLY_COUNT)
    const rows = fresh ?? []
    previewIds = rows.slice(0, FREE_SAMPLE_COUNT).map((x) => x.id as string)
    lockedJobs = rows.slice(FREE_SAMPLE_COUNT).map((x) => ({
      title: x.title as string,
      sector: x.sector as string,
      posted_at: (x.posted_at as string | null) ?? null,
    }))

    query = previewIds.length
      ? query.or(`posted_at.lt.${cutoff},id.in.(${previewIds.join(',')})`)
      : query.lt('posted_at', cutoff)
  }


  if (seniority && seniority !== 'All') query = query.eq('seniority', seniority)
  if (sector && sector !== 'all') query = query.eq('sector', sector)
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,company.ilike.%${search}%,summary.ilike.%${search}%,tags.cs.{${search.toLowerCase()}}`
    )
  }

  // how many roles the free tier is not being shown (everything newer than the delay, minus the full previews)
  let withheld = 0

  // One authoritative "added today" figure, identical for every tier.
  const { count: addedToday } = await db
    .from('jobs')
    .select('*', { count: 'estimated', head: true })
    .eq('is_verified_job', true)
    .neq('sector', 'other')
    .or('quality.is.null,quality.neq.low')
    .gte('posted_at', new Date(Date.now() - 24 * 3600_000).toISOString())
  if (!hasPass) {
    const { count: recent } = await db
      .from('jobs')
      .select('*', { count: 'estimated', head: true })
      .eq('is_verified_job', true)
    .or('quality.is.null,quality.neq.low')
    .neq('sector', 'other')
      .gte('posted_at', new Date(Date.now() - FREE_DELAY_MS).toISOString())
    withheld = Math.max(0, (recent ?? 0) - previewIds.length)

  }

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data, total: count ?? data?.length ?? 0, hasPass, passExpiresAt: hasPass ? passExpiresAt : null, withheld, lockedJobs, previewCount: previewIds.length, previewIds, addedToday: addedToday ?? 0 })
}
