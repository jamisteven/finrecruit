import { employerType } from '@/lib/employer'
import { normalizeSector } from '@/lib/sectors'
import { NextRequest, NextResponse } from 'next/server'
import { inferWorkType } from '@/lib/workType'
import { normalisePost, ApifyPost } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { alreadySeen, rememberDiscard } from '@/lib/seenPosts'
import { prefilterPost } from '@/lib/prefilter'
import { offMarketReason } from '@/lib/market'
import { logPrefilter, logGateDiscard, recordDecision, type ClassifyContext } from '@/lib/classifierLog'
import { runGate } from '@/lib/gate'
import { batchSizeFor, findDuds, DUD_COOLDOWN_DAYS, FIRST_BATCH } from '@/lib/sweepBudget'
import { releaseLapsedMembers, activeMemberQueries } from '@/lib/targetQueries'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

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
  // Posts being classified right now, across both lanes. A city query and its widened regional
  // query often return the same post at the same moment; without this both paid to classify it.
  const inFlight = new Set<string>()

  // Housekeeping first: stop paying for members whose pass ended a few days ago
  if (isCron) { try { await releaseLapsedMembers(db) } catch (e) { console.error('[run-priority] lapse release failed', e) } }

  const body = await req.json().catch(() => ({}))
  if (Array.isArray(body.queries) && body.queries.length) {
    batch = body.queries.slice(0, 12).map(String)   // same ceiling as the cron batch below
  } else {
    // Cron path (hourly, 05–22 UTC): anything active that hasn't run in the last 12
    // hours, oldest first, twelve per run in two lanes. Members' queries always run on
    // the 12h cooldown; the shared sweep is what flexes with the budget. Queries that
    // LinkedIn barely has posts for (two runs in a row with <=1 kept) wait
    // DUD_COOLDOWN_DAYS instead — their widened regional query still runs.
    // A query that members want only runs while one of them is active: a valid pass and a visit in the
    // last few days. Quiet members' searches wait, and catch up when they next open the site
    // (/api/targets/wake). The filter is applied before the cut to 30, so paused rows can't crowd out live ones.
    const { data } = await db.from('priority_queries')
      .select('query, last_run_at, user_count')
      .eq('active', true)
      .or(`last_run_at.is.null,last_run_at.lt.${new Date(Date.now() - 12 * 3600_000).toISOString()}`)
      .order('last_run_at', { ascending: true, nullsFirst: true })
      .limit(500)
    let wanted: Set<string> | null = null
    try { wanted = await activeMemberQueries(db) } catch (e) { console.error('[run-priority] active-member lookup failed, running everything', e) }
    const live = (data ?? []).filter((r) => !wanted || !(Number(r.user_count) > 0) || wanted.has(String(r.query).toLowerCase()))
    const paused = (data ?? []).length - live.length
    if (paused) console.log(`[run-priority] ${paused} quer${paused === 1 ? 'y' : 'ies'} paused (no active member)`)
    const candidates = live.slice(0, 30).map((r) => ({ query: String(r.query), last: r.last_run_at ? Date.parse(String(r.last_run_at)) : 0 }))
    const duds = await findDuds(db, 'priority', candidates.map((c) => c.query))
    const dudCutoff = Date.now() - DUD_COOLDOWN_DAYS * 86_400_000
    const skipped = new Set(candidates.filter((c) => duds.has(c.query) && c.last > dudCutoff).map((c) => c.query))
    if (skipped.size) console.log(`[run-priority] slow lane (dud, ran < ${DUD_COOLDOWN_DAYS}d ago): ${[...skipped].join(', ')}`)
    batch = candidates.filter((c) => !skipped.has(c.query)).slice(0, 12).map((c) => c.query)
  }

  if (!batch.length) return NextResponse.json({ success: true, ran: 0 })

  const result = { total: 0, inserted: 0, duplicates_skipped: 0, errors: 0, prefiltered: 0, gated: 0 }
  console.log(`[run-priority] ${batch.join(', ')}`)

  // Stop starting new Apify runs once most of the function's time is spent; the
  // cron comes back in two hours and picks up whatever is left.
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 230_000
  const deferred: string[] = []

  // One query end to end. Two run at a time: the Apify wait is remote, so a second
  // lane costs no function time and doubles how many member queries a run covers.
  const runOne = async (query: string) => {
    let queryInserted = 0, queryDuplicates = 0, queryRejected = 0, queryPosts = 0
    try {
      // body.deep re-reads a query's whole month once (for searches that only ever got the newest 20)
      const budget = body.deep === true
        ? { maxPosts: FIRST_BATCH, why: 'deep re-run requested' }
        : await batchSizeFor(db, 'priority', query, { firstBatch: FIRST_BATCH })
      console.log(`[run-priority] "${query}" maxPosts=${budget.maxPosts} (${budget.why})`)
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [query], maxPosts: budget.maxPosts, sortBy: 'date',
            postedLimit: 'month', scrapeComments: false, scrapeReactions: false,
          }),
        }
      )
      if (!startRes.ok) { console.error(`[run-priority] "${query}" start ${startRes.status}`); return }

      const runData = await startRes.json()
      const runId = runData.data?.id
      const datasetId = runData.data?.defaultDatasetId
      if (!runId || !datasetId) return

      let status = ''
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 6000))
        const s = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`)
        status = (await s.json()).data?.status
        if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break
      }
      if (status !== 'SUCCEEDED') { console.error(`[run-priority] "${query}" ${status}`); return }

      let items: ApifyPost[] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        items = await (await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=${budget.maxPosts}`
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

            // Known job OR already-discarded post: either way, no classifier call
            if (inFlight.has(post.postUrl)) { result.duplicates_skipped++; queryDuplicates++; return }
            inFlight.add(post.postUrl)
            if (await alreadySeen(db, post.postUrl)) { result.duplicates_skipped++; queryDuplicates++; return }

            // Same cheap gate the hashtag sweep uses: no hiring language, no classifier call
            const HIRING_SIGNALS = ['hiring', 'recruit', 'looking for', 'seeking', 'vacancy',
              'opening', 'mandate', 'apply', 'candidate', 'now hiring', 'join our', 'come work',
              'suchen', 'stelle', 'gesucht', 'einstellen', 'bewerben']
            if (!HIRING_SIGNALS.some((s) => post.text.toLowerCase().includes(s))) return

            const sector = guessSector(post.text, post.authorHeadline || '')
            const ctx: ClassifyContext = { db, pipeline: 'priority', query: query,
              post: { postUrl: post.postUrl, authorName: post.authorName, authorHeadline: post.authorHeadline,
                authorLinkedinUrl: post.authorLinkedinUrl, postedAt: post.postedAt } }
            // Rules first: aggregators, repost templates and off-market signals never reach the model
            const pre = prefilterPost(post)
            if (pre) {
              queryRejected++; result.prefiltered++
              rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
                label: pre.label, reason: pre.reason, pipeline: 'priority', query: query, hint_sector: sector })
              logPrefilter(ctx, post.text, sector, pre.reason)
              return
            }
            // The trained gate (lib/gate.ts). Shadow mode only records a score; 'on' discards below LOW.
            const gate = runGate({ text: post.text, authorHeadline: post.authorHeadline, authorLinkedinUrl: post.authorLinkedinUrl, postUrl: post.postUrl })
            ctx.gateScore = gate.score
            if (gate.discard && gate.score !== null) {
              queryRejected++; result.gated++
              rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
                label: 'bad', reason: `gate: ${gate.score.toFixed(3)} below threshold`, pipeline: 'priority', query: query, hint_sector: sector })
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
                pipeline: 'priority',
                query,
                hint_sector: sector,
              }).then(() => {}, () => {})
              return
            }

            const jobSector = normalizeSector(classified.sector)

            const offMarket = offMarketReason(classified)
            if (offMarket) {
              rememberDiscard(db, { post_url: post.postUrl, raw_text: post.text, author_headline: post.authorHeadline,
                label: 'off-market', reason: offMarket, pipeline: 'priority', query, hint_sector: sector })
              recordDecision(ctx, 'off-market')
              return
            }

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
              employer_type: employerType(classified.employer, post.text, post.authorHeadline, classified.company, jobSector, classified.apply_method),
            })
            if (!error) { result.inserted++; queryInserted++ }
            else if (error.code === '23505') { result.duplicates_skipped++; queryDuplicates++ }
            else result.errors++
            recordDecision(ctx, !error ? 'kept' : error.code === '23505' ? 'duplicate' : 'error')
          } catch { result.errors++ }
        }))
      }
    } catch (err) {
      console.error(`[run-priority] "${query}":`, err)
    } finally {
      await db.from('priority_queries')
        .update({ last_run_at: new Date().toISOString() })
        .ilike('query', query.replace(/[\\%_]/g, (c) => `\\${c}`))   // case-insensitive: "Remote" and "remote" are one search
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

  let next = 0
  const lane = async () => {
    while (next < batch.length) {
      const query = batch[next++]
      if (Date.now() - startedAt > TIME_BUDGET_MS) { deferred.push(query); continue }
      await runOne(query)
    }
  }
  await Promise.all([lane(), lane()])

  if (deferred.length) console.log(`[run-priority] out of time, left for next run: ${deferred.join(', ')}`)
  console.log('[run-priority] done:', result)
  return NextResponse.json({ success: true, ran: batch.length - deferred.length, deferred, result })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
