// Every classifier call, kept or discarded, with the full post text and the full
// model output. This is the training set for a server-side classifier: the model's
// verdict is the label, raw_text is the input, and human_label is where a verdict
// gets corrected by hand. Nothing in the app reads this table.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClassifiedJob } from './classifier'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export type ClassifyContext = {
  db: Db
  pipeline: 'ingest' | 'hashtag' | 'recruiter' | 'priority'
  query: string | null
  post: {
    postUrl: string
    authorName: string | null
    authorHeadline: string | null
    authorLinkedinUrl: string | null
    postedAt: string | null
  }
}

/** Fire-and-forget. A logging failure must never cost us a post. */
export function logClassification(
  ctx: ClassifyContext,
  rawText: string,
  hintSector: string,
  model: string,
  out: ClassifiedJob,
  latencyMs: number,
  rawResponse: string | null,
): void {
  ctx.db.from('classifier_log').insert({
    post_url: ctx.post.postUrl,
    pipeline: ctx.pipeline,
    query: ctx.query,
    hint_sector: hintSector,
    author_name: ctx.post.authorName,
    author_headline: ctx.post.authorHeadline,
    author_linkedin_url: ctx.post.authorLinkedinUrl,
    posted_at: ctx.post.postedAt,
    raw_text: rawText,
    model,
    is_job: out.isJob,
    reason: out.isJob ? null : (out.reason ?? null),
    title: out.title || null,
    company: out.company,
    location: out.location,
    sector: out.sector,
    quality: out.quality,
    output: out,
    raw_response: rawResponse,
    latency_ms: latencyMs,
  }).then(() => {}, (e: unknown) => console.error('[classifier_log] insert failed', e))
}

/** A post the rules stopped before the model saw it. Still a negative example. */
export function logPrefilter(ctx: ClassifyContext, rawText: string, hintSector: string, reason: string): void {
  ctx.db.from('classifier_log').insert({
    post_url: ctx.post.postUrl,
    pipeline: ctx.pipeline,
    query: ctx.query,
    hint_sector: hintSector,
    author_name: ctx.post.authorName,
    author_headline: ctx.post.authorHeadline,
    author_linkedin_url: ctx.post.authorLinkedinUrl,
    posted_at: ctx.post.postedAt,
    raw_text: rawText,
    model: 'prefilter',
    is_job: false,
    reason,
    output: { isJob: false, reason },
    latency_ms: 0,
  }).then(() => {}, (e: unknown) => console.error('[classifier_log] insert failed', e))
}
