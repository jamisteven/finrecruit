import { NextRequest, NextResponse } from 'next/server'
import { normalisePost, ApifyPost } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const secret = req.headers.get('x-ingest-secret')
  if (!isVercelCron && secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) return NextResponse.json({ error: 'APIFY_API_TOKEN not set' }, { status: 500 })

  const db = createServerClient()

  // Get a batch of recruiters rotating by hour
  const batchSize = 10
  const { count: totalRecruiters } = await db
    .from('recruiters')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)

  const hour = new Date().getUTCHours()
  const offset = (hour * batchSize) % (totalRecruiters || 1)

  const { data: recruiters, error: recError } = await db
    .from('recruiters')
    .select('id, linkedin_url, headline, sector')
    .eq('active', true)
    .range(offset, offset + batchSize - 1)

  if (recError || !recruiters?.length) {
    return NextResponse.json({ error: 'No recruiters found' }, { status: 500 })
  }

  const profileUrls = recruiters.map((r) => r.linkedin_url)
  console.log(`[ingest-recruiters] Scraping ${profileUrls.length} profiles offset=${offset}`)

  const result = { total: 0, classified_as_jobs: 0, duplicates_skipped: 0, inserted: 0, errors: 0 }

  try {
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrls,
          maxPosts: 5,
          scrapeComments: false,
          scrapeReactions: false,
        }),
      }
    )

    if (!startRes.ok) {
      const err = await startRes.text()
      return NextResponse.json({ error: `Apify start failed: ${err}` }, { status: 500 })
    }

    const runData = await startRes.json()
    const runId = runData.data?.id
    const datasetId = runData.data?.defaultDatasetId
    console.log(`[ingest-recruiters] Run ${runId} started`)

    let status = ''
    for (let i = 0; i < 38; i++) {
      await new Promise((r) => setTimeout(r, 8000))
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`)
      const statusData = await statusRes.json()
      status = statusData.data?.status
      console.log(`[ingest-recruiters] ${runId}: ${status}`)
      if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break
    }

    if (status !== 'SUCCEEDED') {
      return NextResponse.json({ error: `Run ended: ${status}` }, { status: 500 })
    }

    const resultsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=100`
    )
    const rawPosts: ApifyPost[] = await resultsRes.json()
    result.total = rawPosts.length
    console.log(`[ingest-recruiters] Got ${rawPosts.length} posts`)

    const recruiterMap = new Map(recruiters.map((r) => [r.linkedin_url, r]))

    for (const rawPost of rawPosts) {
      try {
        const post = normalisePost(rawPost)
        if (!post.postUrl || !post.text || post.text.length < 20) continue

        const { data: existing } = await db
          .from('jobs').select('id').eq('post_url', post.postUrl).single()
        if (existing) { result.duplicates_skipped++; continue }

        const HIRING_SIGNALS = ['hiring', 'recruit', 'looking for', 'seeking', 'vacancy',
          'opening', 'mandate', 'apply', 'candidate', 'now hiring', 'join our', 'come work']
        if (!HIRING_SIGNALS.some((s) => post.text.toLowerCase().includes(s))) continue

        const cleanAuthorUrl = post.authorLinkedinUrl?.split('?')[0]
        const recruiter = cleanAuthorUrl ? recruiterMap.get(cleanAuthorUrl) : null
        const sector = recruiter?.sector || guessSector(post.authorHeadline || '')

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

        if (error) { console.error('[ingest-recruiters] DB error:', error); result.errors++ }
        else result.inserted++

        if (recruiter) {
          await db.from('recruiters')
            .update({ last_scraped_at: new Date().toISOString() })
            .eq('id', recruiter.id)
        }

      } catch (err) {
        console.error('[ingest-recruiters] Post error:', err)
        result.errors++
      }
    }

    // Auto-add any new recruiters found in posts
    for (const rawPost of rawPosts) {
      const post = normalisePost(rawPost)
      if (!post.authorLinkedinUrl) continue
      const cleanUrl = post.authorLinkedinUrl.split('?')[0]
      if (!cleanUrl.includes('/in/')) continue
      await db.from('recruiters').upsert({
        linkedin_url: cleanUrl,
        name: post.authorName,
        headline: post.authorHeadline,
        source: 'auto',
      }, { onConflict: 'linkedin_url', ignoreDuplicates: true })
    }

    console.log('[ingest-recruiters] Done:', result)
    return NextResponse.json({ success: true, result, profiles_scraped: profileUrls.length })

  } catch (err) {
    console.error('[ingest-recruiters] Fatal:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function guessSector(headline: string): string {
  const h = headline.toLowerCase()
  if (h.includes('legal') || h.includes('law') || h.includes('solicitor') || h.includes('counsel')) return 'legal'
  if (h.includes('tech') || h.includes('engineer') || h.includes('software') || h.includes('product')) return 'tech'
  if (h.includes('marketing') || h.includes('brand') || h.includes('growth') || h.includes('content')) return 'marketing'
  return 'finance'
}

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
