import { NextRequest, NextResponse } from 'next/server'
import { runApifyScraperForSector, normalisePost, Sector, SECTOR_QUERIES } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

const SECTORS: Sector[] = ['finance', 'tech', 'legal', 'marketing']

export async function POST(req: NextRequest) {
  // Allow Vercel cron calls (they send x-vercel-cron header) or manual calls with secret
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const secret = req.headers.get('x-ingest-secret')
  if (!isVercelCron && secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Allow targeting a specific sector via query param, or rotate by hour
  const url = new URL(req.url)
  const sectorParam = url.searchParams.get('sector') as Sector | null
  const sector: Sector = sectorParam && SECTORS.includes(sectorParam)
    ? sectorParam
    : SECTORS[new Date().getUTCHours() % SECTORS.length]

  // Rotate queries within sector by minute
  const queryOffset = (new Date().getUTCHours() * 3) % SECTOR_QUERIES[sector].length

  console.log(`[ingest] Starting sector="${sector}" queryOffset=${queryOffset}`)

  const result = { sector, total: 0, classified_as_jobs: 0, duplicates_skipped: 0, inserted: 0, errors: 0 }

  try {
    const db = createServerClient()
    const rawPosts = await runApifyScraperForSector(sector, queryOffset)
    result.total = rawPosts.length
    console.log(`[ingest] Got ${rawPosts.length} posts for sector=${sector}`)

    for (const rawPost of rawPosts) {
      try {
        const post = normalisePost(rawPost)

        if (!post.postUrl || !post.text || post.text.length < 20) continue

        const { data: existing } = await db
          .from('jobs')
          .select('id')
          .eq('post_url', post.postUrl)
          .single()

        if (existing) { result.duplicates_skipped++; continue }

        // Pre-filter: skip posts with no hiring-signal words to save Claude tokens
        const HIRING_SIGNALS = ['hiring', 'recruit', 'looking for', 'seeking', 'vacancy',
          'opening', 'mandate', 'apply', 'candidate', 'now hiring', 'join our', 'come work']
        const textLower = post.text.toLowerCase()
        if (!HIRING_SIGNALS.some((s) => textLower.includes(s))) {
          console.log('[ingest] Skipping - no hiring signals')
          continue
        }

        const classified = await classifyPost(post.text, post.authorHeadline, sector)
        if (!classified.isJob) continue

        result.classified_as_jobs++

        const { error } = await db.from('jobs').insert({
          title: classified.title,
          company: classified.company,
          location: normaliseLocation(classified.location),
          seniority: classified.seniority,
          salary: classified.salary,
          apply_method: classified.apply_method,
          summary: classified.summary,
          tags: classified.tags,
          sector,
          post_url: post.postUrl,
          author_name: post.authorName,
          author_headline: post.authorHeadline,
          author_linkedin_url: post.authorLinkedinUrl,
          raw_text: post.text,
          posted_at: post.postedAt,
          extracted_at: new Date().toISOString(),
          is_verified_job: true,
        })

        if (error) { console.error('[ingest] DB error:', error); result.errors++ }
        else result.inserted++

      } catch (err) {
        console.error('[ingest] Post error:', err)
        result.errors++
      }
    }

    console.log('[ingest] Done:', result)
    return NextResponse.json({ success: true, result })
  } catch (err) {
    console.error('[ingest] Fatal:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
