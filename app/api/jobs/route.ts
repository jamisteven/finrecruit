import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'

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

  // Pass holders see roles as they land; everyone else waits 24 hours
  let hasPass = false
  try {
    const session = await getSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (user) {
      const { data: profile } = await createServerClient()
        .from('profiles').select('pass_expires_at').eq('id', user.id).maybeSingle()
      hasPass = !!profile?.pass_expires_at && new Date(profile.pass_expires_at) > new Date()
    }
  } catch { /* treat any failure as free tier */ }

  let query = db
    .from('jobs')
    .select('id, title, company, location, seniority, salary, apply_method, summary, tags, sector, post_url, author_name, author_headline, author_linkedin_url, posted_at, extracted_at, is_verified_job, quality', { count: 'exact' })
    .eq('is_verified_job', true)
    .or(`posted_at.gte.${new Date(Date.now() - maxAgeDays * 86400000).toISOString()},posted_at.is.null`)
    .range(offset, offset + limit - 1)
    .order('extracted_at', { ascending: sortBy === 'oldest' })

  if (!hasPass) {
    query = query.lt('posted_at', new Date(Date.now() - 24 * 3600_000).toISOString())
  }


  if (seniority && seniority !== 'All') query = query.eq('seniority', seniority)
  if (sector && sector !== 'all') query = query.eq('sector', sector)
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,company.ilike.%${search}%,summary.ilike.%${search}%,tags.cs.{${search.toLowerCase()}}`
    )
  }

  // how many roles the free tier is not being shown
  let withheld = 0
  if (!hasPass) {
    const { count: recent } = await db
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('is_verified_job', true)
      .gte('posted_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    withheld = recent ?? 0
  }

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data, total: count ?? data?.length ?? 0, hasPass, withheld })
}
