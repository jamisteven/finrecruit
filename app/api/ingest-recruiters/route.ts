import { employerType } from '@/lib/employer'
import { NextRequest, NextResponse } from 'next/server'
import { inferWorkType } from '@/lib/workType'
import { normalisePost, ApifyPost } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { alreadySeen, rememberDiscard } from '@/lib/seenPosts'
import { prefilterPost, hasJobCard } from '@/lib/prefilter'
import { offMarketReason } from '@/lib/market'
import { logPrefilter, logGateDiscard, recordDecision, type ClassifyContext } from '@/lib/classifierLog'
import { runGate } from '@/lib/gate'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

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

  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) return NextResponse.json({ error: 'APIFY_API_TOKEN not set' }, { status: 500 })

  const db = createServerClient()

  // State machine: only fetch recruiters that are due for scraping
  const { data: recruiters, error: recError } = await db
    .from('recruiters')
    .select('id, linkedin_url, headline, sector, last_scraped_at, scrape_count, post_count')
    .eq('active', true)
    .lte('next_scrape_at', new Date().toISOString())
    .order('next_scrape_at', { ascending: true })
    .limit(50)

  if (recError || !recruiters?.length) {
    return NextResponse.json({ 
      success: true, 
      message: 'No recruiters due for scraping',
      next_check: 'Try again later'
    })
  }

  console.log(`[ingest-recruiters] ${recruiters.length} recruiters due for scraping`)

  const profileUrls = recruiters.map((r) => r.linkedin_url)
  let queryRejected = 0
  const result = { 
    total: 0, 
    classified_as_jobs: 0, 
    duplicates_skipped: 0, 
    inserted: 0,
    errors: 0,
    skipped_off_sector: 0,
    skipped_stale: 0,
    recruiters_scraped: recruiters.length,
    recruiters_with_new_posts: 0,
    prefiltered: 0,
    gated: 0,
  }
  const VALID_SECTORS = ['finance', 'tech', 'legal', 'marketing', 'realestate']

  try {
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrls,
          maxPosts: 1,
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

    // Track which recruiters had new posts
    const recruiterNewPostCount: Record<string, number> = {}
    const recruiterMap = new Map(recruiters.map((r) => [r.linkedin_url, r]))

    for (const rawPost of rawPosts) {
      try {
        const post = normalisePost(rawPost)
        if (!post.postUrl || !post.text || post.text.length < 20) continue

        // Age gate — same 60-day rule as the sector ingest
        if (post.postedAt && Date.now() - new Date(post.postedAt).getTime() > 60 * 86_400_000) {
          result.skipped_stale++
          continue
        }

        // Known job OR already-discarded post: either way, no classifier call
        if (await alreadySeen(db, post.postUrl)) { result.duplicates_skipped++; continue }

        const HIRING_SIGNALS = [
          'hiring', 'recruit', 'looking for', 'seeking', 'vacancy',
          'opening', 'mandate', 'apply', 'candidate', 'now hiring',
          'join our', 'come work', 'suchen', 'stelle', 'gesucht',
        ]
        if (!HIRING_SIGNALS.some((s) => post.text.toLowerCase().includes(s))) continue

        const cleanAuthorUrl = post.authorLinkedinUrl?.split('?')[0]
        const recruiter = cleanAuthorUrl ? recruiterMap.get(cleanAuthorUrl) : null
        const hintSector = recruiter?.sector || guessSector(post.authorHeadline || '')

        const ctx: ClassifyContext = { db, pipeline: 'recruiter', query: cleanAuthorUrl ?? null,
          post: { postUrl: post.postUrl, authorName: post.authorName, authorHeadline: post.authorHeadline,
            authorLinkedinUrl: post.authorLinkedinUrl, postedAt: post.postedAt } }
        // Rules first: aggregators, repost templates and off-market signals never reach the model
        const pre = prefilterPost(post)
        if (pre) {
          queryRejected++; result.prefiltered++
          rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
            label: pre.label, reason: pre.reason, pipeline: 'recruiter', query: cleanAuthorUrl ?? null, hint_sector: hintSector })
          logPrefilter(ctx, post.text, hintSector, pre.reason)
          continue
        }
        // The trained gate (lib/gate.ts). Shadow mode only records a score; 'on' discards below LOW.
        const gate = runGate({ text: post.text, authorHeadline: post.authorHeadline, authorLinkedinUrl: post.authorLinkedinUrl, postUrl: post.postUrl })
        ctx.gateScore = gate.score
        if (gate.discard && gate.score !== null) {
          queryRejected++; result.gated++
          rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
            label: 'bad', reason: `gate: ${gate.score.toFixed(3)} below threshold`, pipeline: 'recruiter', query: cleanAuthorUrl ?? null, hint_sector: hintSector })
          logGateDiscard(ctx, post.text, hintSector, gate.score)
          continue
        }
        const classified = await classifyPost(post.text, post.authorHeadline, hintSector, ctx)
        if (!classified.isJob) {
          queryRejected++
          // keep what we turn away so the discards can be audited
          // a failed/timed-out call is not a verdict — leave it unrecorded so the next sweep retries
          if (!classified.reason?.startsWith('classifier failed')) db.from('classified_posts').insert({
            post_url: post.postUrl,
            raw_text: post.text,
            author_headline: post.authorHeadline,
            label: 'bad',
            reason: classified.reason ?? null,
            pipeline: 'recruiter',
            query: cleanAuthorUrl ?? null,
            hint_sector: hintSector,
          }).then(() => {}, () => {})
          continue
        }

        const offMarket = offMarketReason(classified)
        if (offMarket) {
          rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
            label: 'off-market', reason: offMarket, pipeline: 'recruiter', query: null, hint_sector: hintSector })
          recordDecision(ctx, 'off-market')
          continue
        }

        // The recruiter's sector is only a hint — trust the classifier's judgment of the role
        // Same rule as the other three routes: real jobs outside our verticals are kept as
        // 'other' (the feed filters by sector; we already paid to classify them).
        const sector = VALID_SECTORS.includes(classified.sector) ? classified.sector : 'other'
        if (sector === 'other') result.skipped_off_sector++  // counts 'other' roles kept, not dropped

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
          employer_type: employerType(classified.employer, post.text, post.authorHeadline, classified.company, sector, classified.apply_method),
          on_linkedin_jobs: hasJobCard(post.text),
        })

        recordDecision(ctx, !error ? 'kept' : error.code === '23505' ? 'duplicate' : 'error')
        if (error) { console.error('[ingest-recruiters] DB error:', error); result.errors++ }
        else {
          result.inserted++
          // Track new posts per recruiter
          if (cleanAuthorUrl) {
            recruiterNewPostCount[cleanAuthorUrl] = (recruiterNewPostCount[cleanAuthorUrl] || 0) + 1
          }
        }

      } catch (err) {
        console.error('[ingest-recruiters] Post error:', err)
        result.errors++
      }
    }

    // Update state machine for each recruiter
    const now = new Date()
    for (const recruiter of recruiters) {
      const newPosts = recruiterNewPostCount[recruiter.linkedin_url] || 0
      const hadNewPosts = newPosts > 0

      if (hadNewPosts) result.recruiters_with_new_posts++

      // Calculate next scrape time based on activity:
      // - Had new posts → check again in 24h (active poster)
      // - No new posts, low scrape count → check again in 48h (still learning)
      // - No new posts, high scrape count → back off to 72h (infrequent poster)
      // - No new posts after 10+ scrapes → back off to 7 days
      let hoursUntilNextScrape: number
      const totalScrapes = (recruiter.scrape_count || 0) + 1

      if (hadNewPosts) {
        hoursUntilNextScrape = 24
      } else if (totalScrapes <= 3) {
        hoursUntilNextScrape = 48
      } else if (totalScrapes <= 10) {
        hoursUntilNextScrape = 72
      } else {
        hoursUntilNextScrape = 168 // 7 days for consistently inactive recruiters
      }

      const nextScrapeAt = new Date(now.getTime() + hoursUntilNextScrape * 60 * 60 * 1000)

      await db.from('recruiters').update({
        last_scraped_at: now.toISOString(),
        next_scrape_at: nextScrapeAt.toISOString(),
        scrape_count: totalScrapes,
        post_count: (recruiter.post_count || 0) + newPosts,
        // Mark inactive if never posted after 10+ scrapes
        active: totalScrapes >= 10 && (recruiter.post_count || 0) + newPosts === 0 ? false : true,
      }).eq('id', recruiter.id)
    }

    // Auto-add any new recruiters discovered
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
        next_scrape_at: new Date().toISOString(),
      }, { onConflict: 'linkedin_url', ignoreDuplicates: true })
    }

    const { error: perfError } = await db.from('ingest_runs').insert({
      pipeline: 'recruiter',
      query: `batch of ${recruiters.length}`,
      posts_returned: result.total,
      jobs_inserted: result.inserted,
      duplicates_skipped: result.duplicates_skipped,
      rejected: queryRejected,
      errors: result.errors,
      triggered_by: req.headers.get('user-agent')?.includes('vercel-cron') ? 'cron' : 'manual',
    })
    if (perfError) console.error('[recruiter-perf] insert failed:', perfError.message)

    console.log('[ingest-recruiters] Done:', result)
    return NextResponse.json({ success: true, result })

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
  if (h.includes('real estate') || h.includes('property') || h.includes('leasing') || h.includes('realestate')) return 'realestate'
  return 'finance'
}

// Vercel cron invocations are GET requests — run the same ingestion as POST.
// (The old GET health check was silently swallowing every cron fire.)
export async function GET(req: NextRequest) {
  return POST(req)
}
