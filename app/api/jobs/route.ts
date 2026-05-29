import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const seniority = searchParams.get('seniority')
  const location = searchParams.get('location')
  const search = searchParams.get('search')
  const sortBy = searchParams.get('sortBy') || 'newest'
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  const db = createServerClient()

  let query = db
    .from('jobs')
    .select('*')
    .eq('is_verified_job', true)
    .range(offset, offset + limit - 1)
    .order('extracted_at', { ascending: sortBy === 'oldest' })

  if (seniority && seniority !== 'All') {
    query = query.eq('seniority', seniority)
  }

  if (location) {
    query = query.ilike('location', `%${location}%`)
  }

  if (search) {
    query = query.or(
      `title.ilike.%${search}%,company.ilike.%${search}%,summary.ilike.%${search}%,raw_text.ilike.%${search}%`
    )
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ jobs: data, count })
}
