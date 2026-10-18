// Have we already paid to look at this post?
//
// Every ingest used to check only the jobs table before calling the classifier,
// so a post that was classified and turned down (career advice, a roundup, a
// role in a market we don't serve) came back on the next sweep and was
// classified again — eight times a day for the popular ones. A post is "seen"
// if it is a job we kept OR a post we already discarded.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export async function alreadySeen(db: Db, postUrl: string): Promise<'job' | 'discarded' | null> {
  const [job, discarded] = await Promise.all([
    db.from('jobs').select('id').eq('post_url', postUrl).limit(1).maybeSingle(),
    db.from('classified_posts').select('id').eq('post_url', postUrl).limit(1).maybeSingle(),
  ])
  if (job.data) return 'job'
  if (discarded.data) return 'discarded'
  return null
}

export type Discard = {
  post_url: string
  raw_text: string
  author_headline: string | null
  label: 'bad' | 'off-market'
  reason: string | null
  pipeline: string
  query: string | null
  hint_sector: string | null
}

/** Record a post we won't keep, so no sweep classifies it again. Never throws.
 *  Full text, not a slice: the discards are half of the training set. */
export function rememberDiscard(db: Db, d: Discard): void {
  db.from('classified_posts').insert(d).then(() => {}, () => {})
}
