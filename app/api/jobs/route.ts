import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const seniority = searchParams.get('seniority')
  const search = searchParams.get('search')
  const sector = searchParams.get('sector')
  const sortBy = searchParams.get('sortBy') || 'newest'
  const limit = parseInt(searchParams.get('limit') || '100')
  const offset = parseInt(searchParams.get('offset') || '0')

  const db = createServerClient()

  let query = db
    .from('jobs')
    .select('*')
    .eq('is_verified_job', true)
    .range(offset, offset + limit - 1)
    .order('extracted_at', { ascending: sortBy === 'oldest' })

  if (seniority && seniority !== 'All') query = query.eq('seniority', seniority)
  if (sector && sector !== 'all') query = query.eq('sector', sector)
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,company.ilike.%${search}%,summary.ilike.%${search}%`
    )
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data })
}
