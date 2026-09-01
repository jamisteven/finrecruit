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
  '#jobsuche',
  '#neuejobs',
  '#karriere',
  '#jobboerse',
  '#jobangebot',
  '#stellen',
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
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
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
    : (new Date().getUTCHours() * 2) % HASHTAG_QUERIES.length

  const batch = [...HASHTAG_QUERIES, ...HASHTAG_QUERIES].slice(offset, offset + 2)
  console.log(`[ingest-hashtags] Running: ${batch.join(', ')} (offset ${offset})`)

  for (const query of batch) {
    let queryInserted = 0
    let queryDuplicates = 0
    let queryPosts = 0

    try {
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchQueries: [query], maxPosts: 20, scrapeComments: false, scrapeReactions: false }),
        }
      )

      if (!startRes.ok) continue

      const runData = await startRes.json()
      const runId = runData.data?.id
      const datasetId = runData.data?.defaultDatasetId
      if (!runId || !datasetId) continue

      let status = ''
      for (let i = 0; i < 38; i++) {
        await new Promise((r) => setTimeout(r, 8000))
        const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`)
        status = (await statusRes.json()).data?.status
        if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break
      }

      if (status !== 'SUCCEEDED') continue

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
          if (!classified.isJob) continue

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

      // Log performance
      await db.from('hashtag_performance').insert({
        hashtag: query,
        language: isGerman(query) ? 'de' : 'en',
        posts_returned: queryPosts,
        jobs_inserted: queryInserted,
        duplicates_skipped: queryDuplicates,
      })

    } catch (err) {
      console.error(`[ingest-hashtags] Error for query:`, err)
    }
  }

  console.log('[ingest-hashtags] Done:', result)
  return NextResponse.json({ success: true, result })
}

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}