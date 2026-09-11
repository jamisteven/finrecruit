import { NextRequest, NextResponse } from 'next/server'
import { normalisePost, ApifyPost } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { createServerClient } from '@/lib/supabase'
import { normaliseLocation } from '@/lib/normaliseLocation'

export const maxDuration = 300

const HASHTAG_QUERIES = [
  // English
  '#hiring',
  '#nowhiring',
  '#jobopening',
  '#jobalert',
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
  'hiring switzerland',
  'hiring bern',
  'hiring schaffhausen',
  'hiring basel',
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
  'hiring detroit',
  'hiring baltimore',
  'hiring portland',
  'hiring las vegas',
  'hiring raleigh',
  'hiring columbus',
  'hiring indianapolis',
  'hiring san antonio',
  'hiring pittsburgh',
  'hiring salt lake city',
  'hiring kansas city',
  'hiring cincinnati',
  'hiring richmond',
  'hiring memphis',
  'hiring st louis',
  'hiring washington dc',
  'hiring new jersey',
  // UK
  'hiring london',
  'hiring manchester',
  // APAC
  'hiring singapore',
  'hiring hong kong',
  // Middle East
  'hiring dubai',
  // Canada
  'hiring toronto',
  'hiring switzerland',
  'hiring bern',
  'hiring schaffhausen',
  'hiring basel',
  'hiring geneva',
]

const GERMAN_HASHTAGS = ['stellenangebot', 'jobsuche', 'neuejobs', 'karriere', 'jobboerse', 'jobangebot', 'stellen', 'wirstellenein']

const INDIA_LOCATIONS = [
  'bengaluru', 'bangalore', 'hyderabad', 'mumbai', 'pune', 'karachi', 'lahore', 'pakistan',
  'colombo', 'sri lanka', 'mohali', 'dhaka', 'bangladesh', 'vadodara', 'gujarat', 'alabama', 'abernathy', 'new bern',
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
  const result = { total: 0, classified_as_jobs: 0, duplicates_skipped: 0, inserted: 0, errors: 0 }

  // Support manual offset param to target specific queries
  const url = new URL(req.url)
  const offsetParam = url.searchParams.get('offset')
  const offset = offsetParam !== null
    ? parseInt(offsetParam)
    : await (async () => {
        const { data } = await db.from('ingest_state').select('current_offset').eq('sector', 'hashtags').single()
        const cur = data?.current_offset ?? 0
        await db.from('ingest_state')
          .update({ current_offset: (cur + 2) % HASHTAG_QUERIES.length, last_run_at: new Date().toISOString() })
          .eq('sector', 'hashtags')
        return cur % HASHTAG_QUERIES.length
      })()

  const batch = [...HASHTAG_QUERIES, ...HASHTAG_QUERIES].slice(offset, offset + 2)
  console.log(`[ingest-hashtags] Running: ${batch.join(', ')} (offset ${offset})`)

  for (const query of batch) {
    let queryInserted = 0
    let queryDuplicates = 0
    let queryRejected = 0
    let queryPosts = 0

    try {
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchQueries: [query], maxPosts: 10, sortBy: 'date', postedLimit: 'month', scrapeComments: false, scrapeReactions: false }),
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

      const items: ApifyPost[] = await (await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=50`
      )).json()

      queryPosts = items.length
      result.total += items.length

      for (const rawPost of items) {
        try {
          const post = normalisePost(rawPost)
          if (!post.postUrl || !post.text || post.text.length < 20) continue

          const { data: existing } = await db.from('jobs').select('id').eq('post_url', post.postUrl).single()
          if (existing) { result.duplicates_skipped++; queryDuplicates++; continue }

          const HIRING_SIGNALS = ['hiring', 'recruit', 'looking for', 'seeking', 'vacancy',
            'opening', 'mandate', 'apply', 'candidate', 'now hiring', 'join our', 'come work',
            'suchen', 'stelle', 'gesucht', 'einstellen', 'bewerben']
          if (!HIRING_SIGNALS.some((s) => post.text.toLowerCase().includes(s))) continue

          const sector = guessSector(post.text, post.authorHeadline || '')
          const classified = await classifyPost(post.text, post.authorHeadline, sector)
          if (!classified.isJob) { queryRejected++; continue }

          const loc = (classified.location || '').toLowerCase()
          if (INDIA_LOCATIONS.some(l => loc.includes(l))) continue

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
          } else result.errors++

        } catch (err) {
          result.errors++
        }
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

  console.log('[ingest-hashtags] Done:', result)
  return NextResponse.json({ success: true, result })
}

export async function GET(req: NextRequest) {
  return POST(req)
}