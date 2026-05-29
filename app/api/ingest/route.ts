import { NextRequest, NextResponse } from 'next/server'
import { runApifyScraper, normalisePost, FINANCE_JOB_QUERIES } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { createServerClient } from '@/lib/supabase'
import { IngestResult } from '@/types'

export const maxDuration = 300 // 5 min timeout for Vercel

export async function POST(req: NextRequest) {
  // Simple auth: require a secret header to prevent public triggering
  const secret = req.headers.get('x-ingest-secret')
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result: IngestResult = {
    total: 0,
    classified_as_jobs: 0,
    duplicates_skipped: 0,
    inserted: 0,
    errors: 0,
  }

  try {
    const db = createServerClient()

    // 1. Scrape LinkedIn posts via Apify
    console.log('[ingest] Starting Apify scrape...')
    const rawPosts = await runApifyScraper(FINANCE_JOB_QUERIES)
    result.total = rawPosts.length
    console.log(`[ingest] Got ${rawPosts.length} raw posts`)

    // 2. Process each post
    for (const rawPost of rawPosts) {
      try {
        const post = normalisePost(rawPost)

        // Skip if no text or URL
        if (!post.text || !post.postUrl) continue

        // 3. Check for duplicate by post URL
        const { data: existing } = await db
          .from('jobs')
          .select('id')
          .eq('post_url', post.postUrl)
          .single()

        if (existing) {
          result.duplicates_skipped++
          continue
        }

        // 4. Classify with Claude
        const classified = await classifyPost(post.text, post.authorHeadline)

        if (!classified.isJob) continue

        result.classified_as_jobs++

        // 5. Insert into Supabase
        const { error } = await db.from('jobs').insert({
          title: classified.title,
          company: classified.company,
          location: classified.location,
          seniority: classified.seniority,
          salary: classified.salary,
          apply_method: classified.apply_method,
          summary: classified.summary,
          tags: classified.tags,
          post_url: post.postUrl,
          author_name: post.authorName,
          author_headline: post.authorHeadline,
          author_linkedin_url: post.authorLinkedinUrl,
          raw_text: post.text,
          posted_at: post.postedAt,
          extracted_at: new Date().toISOString(),
          is_verified_job: true,
        })

        if (error) {
          console.error('[ingest] DB insert error:', error)
          result.errors++
        } else {
          result.inserted++
        }
      } catch (err) {
        console.error('[ingest] Error processing post:', err)
        result.errors++
      }
    }

    console.log('[ingest] Done:', result)
    return NextResponse.json({ success: true, result })
  } catch (err) {
    console.error('[ingest] Fatal error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Allow GET for manual health check
export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Ingest endpoint ready. Use POST to trigger.' })
}
