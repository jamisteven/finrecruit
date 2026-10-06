import { NextRequest, NextResponse } from 'next/server'
import { inferWorkType } from '@/lib/workType'
import { normalisePost, ApifyPost } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

const INDIA_LOCATIONS = [
  'bengaluru', 'bangalore', 'hyderabad', 'mumbai', 'pune', 'karachi', 'lahore', 'pakistan',
  'colombo', 'sri lanka', 'mohali', 'dhaka', 'bangladesh', 'vadodara', 'gujarat',
  'chennai', 'noida', 'gurugram', 'gurgaon', 'delhi', 'kolkata',
  'ahmedabad', 'jaipur', 'chandigarh', 'indore', 'india',
  'surat', 'nashik', 'visakhapatnam',
]

function guessSector(text: string, headline: string): string {
  const combined = `${text} ${headline}`.toLowerCase()
  if (/lawyer|solicitor|counsel|litigation|barrister|legal|compliance|paralegal/.test(combined)) return 'legal'
  if (/marketing|brand|growth|seo|content|campaign|digital marketing|cmo/.test(combined)) return 'marketing'
  if (/property|leasing|real estate|landlord|tenant|facilities|hoa/.test(combined)) return 'realestate'
  if (/engineer|developer|software|tech|devops|cloud|data|ai|ml|product manager|cto/.test(combined)) return 'tech'
  return 'finance'
}

// Runs a small set of named queries now rather than waiting for the rotation.
// Called straight after a user saves their targets, and by the cron for any
// priority query that hasn't run today.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-ingest-secret')
  const authHeader = req.headers.get('authorization')
  const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = secret === process.env.INGEST_SECRET
  if (!isCron && !isInternal) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) return NextResponse.json({ error: 'APIFY_API_TOKEN not set' }, { status: 500 })

  const db = createServerClient()
  let batch: string[] = []

  const body = await req.json().catch(() => ({}))
  if (Array.isArray(body.queries) && body.queries.length) {
    batch = body.queries.slice(0, 3).map(String)
  } else {
    // Cron path: anything active that hasn't run in the last 12 hours
    const { data } = await db.from('priority_queries')
      .select('query, last_run_at')
      .eq('active', true)
      .or(`last_run_at.is.null,last_run_at.lt.${new Date(Date.now() - 12 * 3600_000).toISOString()}`)
      .order('last_run_at', { ascending: true, nullsFirst: true })
      .limit(3)
    batch = (data ?? []).map((r) => String(r.query))
  }

  if (!batch.length) return NextResponse.json({ success: true, ran: 0 })

  const result = { total: 0, inserted: 0, duplicates_skipped: 0, errors: 0 }
  console.log(`[run-priority] ${batch.join(', ')}`)

  for (const query of batch) {
    let queryInserted = 0, queryDuplicates = 0, queryRejected = 0, queryPosts = 0
    try {
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [query], maxPosts: 20, sortBy: 'date',
            postedLimit: 'month', scrapeComments: false, scrapeReactions: false,
          }),
        }
      )
      if (!startRes.ok) { console.error(`[run-priority] "${query}" start ${startRes.status}`); continue }

      const runData = await startRes.json()
      const runId = runData.data?.id
      const datasetId = runData.data?.defaultDatasetId
      if (!runId || !datasetId) continue

      let status = ''
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 6000))
        const s = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`)
        status = (await s.json()).data?.status
        if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break
      }
      if (status !== 'SUCCEEDED') { console.error(`[run-priority] "${query}" ${status}`); continue }

      let items: ApifyPost[] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        items = await (await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=50`
        )).json()
        if (items.length > 0) break
        await new Promise((r) => setTimeout(r, 6000))
      }

      queryPosts = items.length
      result.total += items.length

      const CHUNK = 5
      for (let i = 0; i < items.length; i += CHUNK) {
        await Promise.all(items.slice(i, i + CHUNK).map(async (rawPost) => {
          try {
            const post = normalisePost(rawPost)
            if (!post.postUrl || !post.text || post.text.length < 20) return

            const { data: existing } = await db.from('jobs').select('id').eq('post_url', post.postUrl).maybeSingle()
            if (existing) { result.duplicates_skipped++; queryDuplicates++; return }

            const sector = guessSector(post.text, post.authorHeadline || '')
            const classified = await classifyPost(post.text, post.authorHeadline, sector)
            if (!classified.isJob) { queryRejected++; return }

            const jobSector = ['finance', 'tech', 'legal', 'marketing', 'realestate']
              .includes(classified.sector) ? classified.sector : 'other'

            const loc = (classified.location || '').toLowerCase()
            if (INDIA_LOCATIONS.some((l) => loc.includes(l))) return

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
              quality: classified.quality ?? 'medium',
              post_url: post.postUrl,
              author_name: post.authorName,
              author_headline: post.authorHeadline,
              author_linkedin_url: post.authorLinkedinUrl,
              author_avatar: post.authorAvatar,
              raw_text: post.text,
              posted_at: post.postedAt,
              extracted_at: new Date().toISOString(),
              work_type: inferWorkType(classified.location, classified.tags, classified.title),
              is_verified_job: true,
            })
            if (!error) { result.inserted++; queryInserted++ }
            else if (error.code === '23505') { result.duplicates_skipped++; queryDuplicates++ }
            else result.errors++
          } catch { result.errors++ }
        }))
      }
    } catch (err) {
      console.error(`[run-priority] "${query}":`, err)
    } finally {
      await db.from('priority_queries')
        .update({ last_run_at: new Date().toISOString() })
        .eq('query', query)
      await db.from('ingest_runs').insert({
        pipeline: 'priority',
        query,
        sector: 'en',
        posts_returned: queryPosts,
        jobs_inserted: queryInserted,
        duplicates_skipped: queryDuplicates,
        rejected: queryRejected,
        triggered_by: isCron ? 'cron' : 'manual',
      })
    }
  }

  console.log('[run-priority] done:', result)
  return NextResponse.json({ success: true, ran: batch.length, result })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
