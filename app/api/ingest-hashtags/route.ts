import { NextRequest, NextResponse } from 'next/server'
import { inferWorkType } from '@/lib/workType'
import { normalisePost, ApifyPost, dayIndex } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { alreadySeen, rememberDiscard } from '@/lib/seenPosts'
import { prefilterPost } from '@/lib/prefilter'
import { offMarketReason } from '@/lib/market'
import { logPrefilter, logGateDiscard, recordDecision, type ClassifyContext } from '@/lib/classifierLog'
import { runGate } from '@/lib/gate'
import { batchSizeFor, keptRates } from '@/lib/sweepBudget'
import { apifyBudget, budgetMode } from '@/lib/apifyBudget'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

// Extra runs when we're under-spending the Apify plan: the queries with the best
// kept-rate in the last fortnight, in the cities visitors actually filter for.
const BONUS_QUERIES = [
  'hiring new york', 'hiring atlanta', 'hiring zurich', 'hiring new jersey', 'hiring pittsburgh',
  'hiring los angeles', 'hiring richmond', 'hiring salt lake city', 'hiring minneapolis', 'hiring chicago',
  'hiring london', 'hiring manchester', 'hiring washington dc', 'hiring toronto', 'hiring miami',
  'hiring seattle', 'hiring boston', 'hiring philadelphia', 'hiring grc remote', 'hiring fixed income',
]

const HASHTAG_QUERIES = [
  // English
  '#hiring',
  '#nowhiring',
  '#hiringnow',
  '#jobopportunity',
  '#werehiring',
  '#careeropportunity',
  // German
  '#stellenangebot',
  '#jobangebot',
  '#wirstellenein',
  // Swiss location searches
  'hiring zurich',
  'hiring basel',
  'hiring switzerland',
  'hiring bern',
  'hiring geneva',
  // US cities
  'hiring new york',
  'hiring chicago',
  'hiring boston',
  'hiring los angeles',
  // US cities - tier 2
  'hiring atlanta',
  'hiring nashville',
  'hiring austin',
  'hiring miami',
  'hiring dallas',
  'hiring seattle',
  'hiring denver',
  'hiring philadelphia',
  'hiring houston',
  'hiring phoenix',
  'hiring san diego',
  'hiring minneapolis',
  'hiring charlotte',
  'hiring pittsburgh',
  'hiring salt lake city',
  'hiring richmond',
  'hiring washington dc',
  'hiring new jersey',
  // UK
  'hiring london',
  'hiring manchester',
  // APAC
  // Middle East
  // Canada
  'hiring toronto',
  // Terms paying users searched and found nothing for
  'hiring revenue growth management',
  'hiring grc',
  'hiring sales enablement',
  'hiring instructional design',
  'hiring fixed income',
  'hiring private equity',
  // Function-led — driven by what paying users actually search for
  'hiring corporate finance',
  'hiring finance new york',
  'hiring finance chicago',
  '#financejobs',
  '#remotejobs',
  'hiring product manager',
  'hiring help desk',
  'hiring fixed income new york',
  'hiring corporate finance new york',
  'hiring customer experience washington dc',
  'hiring grc remote',
]

const GERMAN_HASHTAGS = ['stellenangebot', 'jobsuche', 'neuejobs', 'karriere', 'jobboerse', 'jobangebot', 'stellen', 'wirstellenein']

function guessSector(text: string, headline: string): string {
  const combined = `${text} ${headline}`.toLowerCase()
  if (/lawyer|solicitor|counsel|litigation|barrister|legal|compliance|paralegal/.test(combined)) return 'legal'
  if (/marketing|brand|growth|seo|content|campaign|digital marketing|cmo/.test(combined)) return 'marketing'
  if (/property|leasing|real estate|landlord|tenant|facilities|hoa/.test(combined)) return 'realestate'
  if (/engineer|developer|software|tech|devops|cloud|data|ai|ml|product manager|cto/.test(combined)) return 'tech'
  return 'finance'
}

function isGerman(hashtag: string): boolean {
  return GERMAN_HASHTAGS.some(g => hashtag.toLowerCase().includes(g))
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isVercelCron =
    (!!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) ||
    req.headers.get('x-vercel-cron') === '1'
  const secret = req.headers.get('x-ingest-secret')
  if (!isVercelCron && secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) return NextResponse.json({ error: 'APIFY_API_TOKEN not set' }, { status: 500 })

  const db = createServerClient()
  const result = { total: 0, classified_as_jobs: 0, duplicates_skipped: 0, inserted: 0, errors: 0, prefiltered: 0, gated: 0 }

  // Support manual offset param to target specific queries
  const url = new URL(req.url)
  const offsetParam = url.searchParams.get('offset')
  const offset = offsetParam !== null
    ? parseInt(offsetParam)
    : await (async () => {
        const { data } = await db.from('ingest_state').select('current_offset').eq('sector', 'hashtags').single()
        const cur = data?.current_offset ?? 0
        await db.from('ingest_state')
          .update({ current_offset: (cur + 4) % HASHTAG_QUERIES.length, last_run_at: new Date().toISOString() })
          .eq('sector', 'hashtags')
        return cur % HASHTAG_QUERIES.length
      })()

  // Spend the Apify plan, not more and not less: behind pace, add the best-yielding
  // queries to this run; ahead of pace, buy smaller batches; over target, minimum only.
  const budget = await apifyBudget(db)
  const plan = budgetMode(budget)
  console.log(`[ingest-hashtags] apify budget: $${budget.spentUsd.toFixed(2)} spent of $${budget.targetUsd.toFixed(2)} target, pace $${budget.paceUsd.toFixed(2)} (day ${budget.dayOfCycle}/${budget.daysInCycle}) -> ${plan.mode}`)

  let rotation = [...HASHTAG_QUERIES, ...HASHTAG_QUERIES].slice(offset, offset + 4)
  if (plan.minKeptRate > 0) {
    // ahead of pace: drop the weak queries from this run, keep the strong ones at full size
    const rates = await keptRates(db, 'hashtag', rotation)
    const dropped = rotation.filter((q) => { const r = rates.get(q.toLowerCase()); return r !== null && r !== undefined && r < plan.minKeptRate })
    if (dropped.length) console.log(`[ingest-hashtags] ${plan.mode}: skipping low-yield ${dropped.map((q) => `${q} (${Math.round((rates.get(q.toLowerCase()) ?? 0) * 100)}%)`).join(', ')}`)
    rotation = rotation.filter((q) => !dropped.includes(q))
  }
  const bonus = plan.bonusQueries > 0
    ? [...BONUS_QUERIES, ...BONUS_QUERIES].slice(dayIndex() % BONUS_QUERIES.length, dayIndex() % BONUS_QUERIES.length + plan.bonusQueries)
        .filter((q) => !rotation.includes(q))
    : []
  const batch = [...rotation, ...bonus]
  console.log(`[ingest-hashtags] Running: ${batch.join(', ')} (offset ${offset}${bonus.length ? `, +${bonus.length} bonus` : ''})`)

  // Bonus queries only run while there's function time left; the rotation always runs.
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 230_000
  const skippedBonus: string[] = []

  for (const query of batch) {
    if (bonus.includes(query) && Date.now() - startedAt > TIME_BUDGET_MS) { skippedBonus.push(query); continue }
    let queryInserted = 0
    let queryDuplicates = 0
    let queryRejected = 0
    let queryPosts = 0

    try {
      // Buy fewer posts from queries whose last visit was mostly repeats (Apify bills per post)
      const sized = await batchSizeFor(db, 'hashtag', query)
      const maxPosts = sized.maxPosts
      console.log(`[ingest-hashtags] "${query}" maxPosts=${maxPosts} (${sized.why})`)
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [query],
            maxPosts,
            // LinkedIn returns nothing for very high-volume tags when sorted by date
            ...(query === '#hiring' ? {} : { sortBy: 'date' }),
            postedLimit: 'month',
            scrapeComments: false,
            scrapeReactions: false,
          }),
        }
      )

      if (!startRes.ok) { console.error(`[ingest-hashtags] "${query}" start failed ${startRes.status}: ${await startRes.text()}`); continue }

      const runData = await startRes.json()
      const runId = runData.data?.id
      const datasetId = runData.data?.defaultDatasetId
      if (!runId || !datasetId) { console.error(`[ingest-hashtags] "${query}" no runId/datasetId`); continue }

      let status = ''
      for (let i = 0; i < 38; i++) {
        await new Promise((r) => setTimeout(r, 8000))
        const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`)
        status = (await statusRes.json()).data?.status
        if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break
      }

      if (status !== 'SUCCEEDED') { console.error(`[ingest-hashtags] "${query}" ended as ${status}`); continue }

      // Apify can report SUCCEEDED before the dataset is readable — retry briefly
      let items: ApifyPost[] = []
      for (let attempt = 0; attempt < 2; attempt++) {
        items = await (await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=50`
        )).json()
        if (items.length > 0) break
        console.log(`[ingest-hashtags] "${query}" dataset empty, retry ${attempt + 1}`)
        await new Promise((r) => setTimeout(r, 8000))
      }

      console.log(`[ingest-hashtags] "${query}" dataset ${datasetId} returned ${items.length} items`)
      queryPosts = items.length
      result.total += items.length

      // Process posts in concurrent chunks — the per-post work is all IO-bound
      const CHUNK = 5
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK)
        await Promise.all(chunk.map(async (rawPost) => {
          try {
            const post = normalisePost(rawPost)
            if (!post.postUrl || !post.text || post.text.length < 20) return

            // Known job OR already-discarded post: either way, no classifier call
            if (await alreadySeen(db, post.postUrl)) { result.duplicates_skipped++; queryDuplicates++; return }

            const HIRING_SIGNALS = ['hiring', 'recruit', 'looking for', 'seeking', 'vacancy',
              'opening', 'mandate', 'apply', 'candidate', 'now hiring', 'join our', 'come work',
              'suchen', 'stelle', 'gesucht', 'einstellen', 'bewerben']
            if (!HIRING_SIGNALS.some((s) => post.text.toLowerCase().includes(s))) return

            const sector = guessSector(post.text, post.authorHeadline || '')
            const ctx: ClassifyContext = { db, pipeline: 'hashtag', query: query,
              post: { postUrl: post.postUrl, authorName: post.authorName, authorHeadline: post.authorHeadline,
                authorLinkedinUrl: post.authorLinkedinUrl, postedAt: post.postedAt } }
            // Rules first: aggregators, repost templates and off-market signals never reach the model
            const pre = prefilterPost(post)
            if (pre) {
              queryRejected++; result.prefiltered++
              rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
                label: pre.label, reason: pre.reason, pipeline: 'hashtag', query: query, hint_sector: sector })
              logPrefilter(ctx, post.text, sector, pre.reason)
              return
            }
            // The trained gate (lib/gate.ts). Shadow mode only records a score; 'on' discards below LOW.
            const gate = runGate({ text: post.text, authorHeadline: post.authorHeadline, authorLinkedinUrl: post.authorLinkedinUrl, postUrl: post.postUrl })
            ctx.gateScore = gate.score
            if (gate.discard && gate.score !== null) {
              queryRejected++; result.gated++
              rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
                label: 'bad', reason: `gate: ${gate.score.toFixed(3)} below threshold`, pipeline: 'hashtag', query: query, hint_sector: sector })
              logGateDiscard(ctx, post.text, sector, gate.score)
              return
            }
            const classified = await classifyPost(post.text, post.authorHeadline, sector, ctx)
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
                pipeline: 'hashtag',
                query,
                hint_sector: sector,
              }).then(() => {}, () => {})
              return
            }

            // Trust the classifier's sector over the regex hint. Real jobs outside our
            // verticals are kept as 'other' rather than dropped (already paid to classify).
            const jobSector = ['finance','tech','legal','marketing','realestate']
              .includes(classified.sector) ? classified.sector : 'other'

            const offMarket = offMarketReason(classified)
            if (offMarket) {
              // remember it, or the next sweep pays to classify it again
              rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
                label: 'off-market', reason: offMarket, pipeline: 'hashtag', query, hint_sector: sector })
              recordDecision(ctx, 'off-market')
              return
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

            recordDecision(ctx, !error ? 'kept' : error.code === '23505' ? 'duplicate' : 'error')
            if (!error) {
              result.inserted++
              queryInserted++
              if (post.authorLinkedinUrl?.includes('/in/')) {
                const cleanUrl = post.authorLinkedinUrl.split('?')[0]
                await db.from('recruiters').upsert({
                  linkedin_url: cleanUrl,
                  name: post.authorName,
                  headline: post.authorHeadline,
                  sector,
                  source: 'hashtag',
                  next_scrape_at: new Date().toISOString(),
                }, { onConflict: 'linkedin_url', ignoreDuplicates: true })
              }
            } else if (error.code === '23505') {
              // lost a race within the chunk — another post inserted the same url
              result.duplicates_skipped++; queryDuplicates++
            } else {
              result.errors++
            }
          } catch (err) {
            result.errors++
          }
        }))
      }

    } catch (err) {
      console.error(`[ingest-hashtags] Error for query "${query}":`, err)
    } finally {
      const { error: perfError } = await db.from('ingest_runs').insert({
        pipeline: 'hashtag',
        query,
        sector: isGerman(query) ? 'de' : 'en',
        posts_returned: queryPosts,
        jobs_inserted: queryInserted,
        duplicates_skipped: queryDuplicates,
        rejected: queryRejected,
        triggered_by: req.headers.get('user-agent')?.includes('vercel-cron') ? 'cron' : 'manual',
      })
      if (perfError) {
        console.error(`[hashtag-perf] insert failed for "${query}":`, perfError.message)
      } else {
        console.log(`[hashtag-perf] logged "${query}": ${queryPosts} posts, ${queryInserted} inserted`)
      }
    }
  }

  if (skippedBonus.length) console.log(`[ingest-hashtags] bonus skipped (out of time): ${skippedBonus.join(', ')}`)
  console.log('[ingest-hashtags] Done:', result)
  return NextResponse.json({ success: true, result })
}

export async function GET(req: NextRequest) {
  return POST(req)
}