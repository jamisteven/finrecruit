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
  /** Set by logClassification so recordDecision can wait for the row to exist. */
  logged?: PromiseLike<unknown>
  /** The gate's probability for this post, when GATE_MODE is shadow or on. */
  gateScore?: number | null
}

// What finally happened to the post, which is not the same as what the model said:
// a model "yes" can still end as off-market, a duplicate, or a failed insert.
export type Decision = 'kept' | 'discarded' | 'off-market' | 'duplicate' | 'error' | 'prefiltered'

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
  ctx.logged = ctx.db.from('classifier_log').insert({
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
    gate_score: ctx.gateScore ?? null,
    is_job: out.isJob,
    decision: out.isJob ? 'pending' : 'discarded',
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
    decision: 'prefiltered',
    reason,
    output: { isJob: false, reason },
    latency_ms: 0,
  }).then(() => {}, (e: unknown) => console.error('[classifier_log] insert failed', e))
}

/** Record the route's final decision on a post the model said yes to. Never throws. */
export function recordDecision(ctx: ClassifyContext, decision: Decision): void {
  const run = async () => {
    try { await ctx.logged } catch { /* insert already logged its own error */ }
    await ctx.db.from('classifier_log')
      .update({ decision })
      .eq('post_url', ctx.post.postUrl).eq('pipeline', ctx.pipeline).eq('decision', 'pending')
  }
  run().catch((e: unknown) => console.error('[classifier_log] decision update failed', e))
}

/** A post the gate discarded on its own (GATE_MODE=on, score below LOW). */
export function logGateDiscard(ctx: ClassifyContext, rawText: string, hintSector: string, score: number): void {
  const reason = `gate: ${score.toFixed(3)} below threshold`
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
    model: 'gate',
    gate_score: score,
    is_job: false,
    decision: 'discarded',
    reason,
    output: { isJob: false, reason },
    latency_ms: 0,
  }).then(() => {}, (e: unknown) => console.error('[classifier_log] insert failed', e))
}
