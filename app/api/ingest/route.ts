import { NextRequest, NextResponse } from 'next/server'
import { runApifyScraperForSector, normalisePost, Sector, SECTOR_QUERIES } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

const SECTORS: Sector[] = ['finance', 'tech', 'legal', 'marketing', 'realestate']

export async function POST(req: NextRequest) {
  // Auth: Vercel cron invocations automatically send `Authorization: Bearer ${CRON_SECRET}`
  // when a CRON_SECRET env var is set on the project. Manual calls use x-ingest-secret as before.
  const authHeader = req.headers.get('authorization')
  const isVercelCron =
    !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
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

  // Allow manual offset override via ?offset= param, otherwise rotate by hour
  const offsetParam = url.searchParams.get('offset')
  const queryOffset = offsetParam !== null
    ? parseInt(offsetParam)
    : (new Date().getUTCHours() * 3) % SECTOR_QUERIES[sector].length

  console.log(`[ingest] Starting sector="${sector}" queryOffset=${queryOffset}`)

  const MAX_POST_AGE_DAYS = 60  // ignore hiring posts older than this — role is long filled
  const result = { sector, total: 0, classified_as_jobs: 0, duplicates_skipped: 0, inserted: 0, errors: 0, skipped_off_sector: 0, skipped_stale: 0 }

  try {
    const db = createServerClient()
    const rawPosts = await runApifyScraperForSector(sector, queryOffset)
    result.total = rawPosts.length
    console.log(`[ingest] Got ${rawPosts.length} posts for sector=${sector}`)

    for (const rawPost of rawPosts) {
      try {
        const post = normalisePost(rawPost)

        if (!post.postUrl || !post.text || post.text.length < 20) continue

        // Age gate: LinkedIn search happily returns years-old posts — skip them
        // before they cost a dedupe query or a classification call
        if (post.postedAt && Date.now() - new Date(post.postedAt).getTime() > MAX_POST_AGE_DAYS * 86_400_000) {
          result.skipped_stale++
          continue
        }

        const { data: existing } = await db
          .from('jobs')
          .select('id')
          .eq('post_url', post.postUrl)
          .single()

        if (existing) { result.duplicates_skipped++; continue }

        // Pre-filter: skip posts with no hiring-signal words to save Claude tokens
        // (English + German + French — German/French queries return German/French posts)
        const HIRING_SIGNALS = ['hiring', 'recruit', 'looking for', 'seeking', 'vacancy',
          'opening', 'mandate', 'apply', 'candidate', 'now hiring', 'join our', 'come work',
          'suchen', 'gesucht', 'stelle', 'stellenangebot', 'einstellen', 'bewerbung', 'bewerben', 'verstärkung',
          'recrute', 'recrutement', 'nous recherchons', 'poste à pourvoir', 'candidature', 'rejoignez']
        const textLower = post.text.toLowerCase()
        if (!HIRING_SIGNALS.some((s) => textLower.includes(s))) {
          console.log('[ingest] Skipping - no hiring signals')
          continue
        }

        const classified = await classifyPost(post.text, post.authorHeadline, sector)
        if (!classified.isJob) continue

        // Trust the classifier's judgment of the ROLE's sector over the query's sector.
        // A finance query that surfaces a tech job files it under tech; roles that fit
        // no vertical ('other') are dropped instead of polluting a sector.
        const jobSector = SECTORS.includes(classified.sector as Sector) ? (classified.sector as Sector) : null
        if (!jobSector) {
          console.log(`[ingest] Skipping off-sector role: "${classified.title}" (${classified.sector})`)
          result.skipped_off_sector++
          continue
        }

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
          sector: jobSector,
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

// Vercel cron invocations are GET requests — run the same ingestion as POST.
// (The old GET health check was silently swallowing every cron fire.)
export async function GET(req: NextRequest) {
  return POST(req)
}
