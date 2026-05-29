import { NextRequest, NextResponse } from 'next/server'
import { runApifyScraper, normalisePost, FINANCE_JOB_QUERIES } from '@/lib/apify'
import { classifyPost } from '@/lib/classifier'
import { createServerClient } from '@/lib/supabase'
import { IngestResult } from '@/types'

export const maxDuration = 300

export async function POST(req: NextRequest) {
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

    console.log('[ingest] Starting Apify scrape...')
    const rawPosts = await runApifyScraper(FINANCE_JOB_QUERIES)
    result.total = rawPosts.length
    console.log(`[ingest] Got ${rawPosts.length} raw posts`)

    for (const rawPost of rawPosts) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const post = normalisePost(rawPost as any)

        if (!post.postUrl) {
          console.log('[ingest] Skipping post with no URL')
          continue
        }

        // Debug: log what text we're working with
        console.log(`[ingest] Post url=${post.postUrl.slice(0, 60)} textLen=${post.text?.length ?? 0} text_preview="${post.text?.slice(0, 80)}"`)

        if (!post.text || post.text.length < 20) {
          console.log('[ingest] Skipping post with no/short text')
          continue
        }

        // Check duplicate
        const { data: existing } = await db
          .from('jobs')
          .select('id')
          .eq('post_url', post.postUrl)
          .single()

        if (existing) {
          result.duplicates_skipped++
          continue
        }

        // Classify with Claude
        const classified = await classifyPost(post.text, post.authorHeadline)
        console.log(`[ingest] isJob=${classified.isJob} title="${classified.title}"`)

        if (!classified.isJob) continue

        result.classified_as_jobs++

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

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Ingest endpoint ready. Use POST to trigger.' })
}
