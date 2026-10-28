import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { prefilterPost, hasJobCard } from '@/lib/prefilter'
import { classifyPost } from '@/lib/classifier'
import { alreadySeen, rememberDiscard } from '@/lib/seenPosts'
import { offMarketReason } from '@/lib/market'
import { normalizeSector } from '@/lib/sectors'
import { inferWorkType } from '@/lib/workType'
import { employerType } from '@/lib/employer'
import { normaliseLocation } from '@/lib/normaliseLocation'
import { runGate } from '@/lib/gate'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// One-off recovery: re-run posts that a prefilter rule used to block (classifier_log keeps the full text of
// every one) through the CURRENT rules and the classifier, and insert the real roles. No Apify spend.
//
//   POST { reason: "C2C", days: 14, dryRun: true, afterId: 0, limit: 400 }   header x-ingest-secret
//
// dryRun (the default) classifies but writes nothing. Call again with the returned nextAfterId until done.

function guessSector(text: string, headline: string): string {
  const combined = `${text} ${headline}`.toLowerCase()
  if (/lawyer|solicitor|counsel|litigation|barrister|legal|compliance|paralegal/.test(combined)) return 'legal'
  if (/marketing|brand|growth|seo|content|campaign|digital marketing|cmo/.test(combined)) return 'marketing'
  if (/property|leasing|real estate|landlord|tenant|facilities|hoa/.test(combined)) return 'realestate'
  if (/engineer|developer|software|tech|devops|cloud|data|ai|ml|product manager|cto/.test(combined)) return 'tech'
  return 'finance'
}

type LogRow = {
  id: number; post_url: string; query: string | null; author_name: string | null; author_headline: string | null
  author_linkedin_url: string | null; posted_at: string | null; raw_text: string
}

export async function POST(req: NextRequest) {
  if (!process.env.INGEST_SECRET || req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const reason = String(body.reason ?? 'C2C').replace(/[%_\\]/g, '')
  const days = Math.min(30, Math.max(1, Number(body.days) || 14))
  const dryRun = body.dryRun !== false
  const afterId = Number(body.afterId) || 0
  const limit = Math.min(600, Math.max(1, Number(body.limit) || 400))

  const db = createServerClient()
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await db.from('classifier_log')
    .select('id, post_url, query, author_name, author_headline, author_linkedin_url, posted_at, raw_text')
    .eq('decision', 'prefiltered').like('reason', `%${reason}%`)
    .gte('posted_at', cutoff).gt('id', afterId)
    .order('id', { ascending: true }).limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as LogRow[]

  const out = {
    dryRun, scanned: 0, duplicateInLog: 0, alreadySeen: 0, stillBlocked: {} as Record<string, number>,
    gated: 0, rejectedByModel: {} as Record<string, number>, offMarket: 0, roles: 0, inserted: 0, errors: 0,
    nextAfterId: afterId, done: false, samples: [] as Record<string, unknown>[],
  }
  const bump = (m: Record<string, number>, k: string) => { const key = k.slice(0, 60); m[key] = (m[key] ?? 0) + 1 }
  const startedAt = Date.now()
  const BUDGET_MS = 220_000
  const seenUrls = new Set<string>()

  const one = async (r: LogRow) => {
    out.scanned++
    if (seenUrls.has(r.post_url)) { out.duplicateInLog++; return }
    seenUrls.add(r.post_url)
    if (await alreadySeen(db, r.post_url)) { out.alreadySeen++; return }

    const post = { text: r.raw_text, postUrl: r.post_url, authorLinkedinUrl: r.author_linkedin_url, authorName: r.author_name, authorHeadline: r.author_headline }
    const sector = guessSector(post.text, post.authorHeadline || '')
    const discard = (label: 'bad' | 'off-market', why: string | null) => {
      if (dryRun) return
      rememberDiscard(db, { post_url: r.post_url, raw_text: post.text, author_headline: post.authorHeadline, label, reason: why,
        pipeline: 'backfill', query: r.query, hint_sector: sector })
    }

    const pre = prefilterPost(post)
    if (pre) { bump(out.stillBlocked, pre.reason); discard(pre.label, pre.reason); return }
    const gate = runGate({ text: post.text, authorHeadline: post.authorHeadline, authorLinkedinUrl: post.authorLinkedinUrl, postUrl: r.post_url })
    if (gate.discard && gate.score !== null) { out.gated++; discard('bad', `gate: ${gate.score.toFixed(3)} below threshold`); return }

    const c = await classifyPost(post.text, post.authorHeadline, sector)
    if (!c.isJob) {
      const why = c.reason ?? 'not a job'
      bump(out.rejectedByModel, why)
      if (!why.startsWith('classifier failed')) discard('bad', why)
      return
    }
    const jobSector = normalizeSector(c.sector)
    const om = offMarketReason(c)
    if (om) { out.offMarket++; discard('off-market', om); return }

    out.roles++
    const row = {
      title: c.title, company: c.company, location: normaliseLocation(c.location), seniority: c.seniority, salary: c.salary,
      apply_method: c.apply_method, summary: c.summary, tags: c.tags, sector: jobSector, quality: c.quality ?? 'medium',
      post_url: r.post_url, author_name: post.authorName, author_headline: post.authorHeadline, author_linkedin_url: post.authorLinkedinUrl,
      author_avatar: null, raw_text: post.text, posted_at: r.posted_at, extracted_at: new Date().toISOString(),
      work_type: inferWorkType(c.location, c.tags, c.title), is_verified_job: true,
      employer_type: employerType(c.employer, post.text, post.authorHeadline, c.company, jobSector, c.apply_method),
      on_linkedin_jobs: hasJobCard(post.text),
    }
    if (out.samples.length < 30) out.samples.push({ title: row.title, company: row.company, location: row.location, work_type: row.work_type,
      employer: row.employer_type, quality: row.quality, sector: row.sector, posted: String(row.posted_at).slice(0, 10) })
    if (dryRun) return
    const { error: insErr } = await db.from('jobs').insert(row)
    if (!insErr) out.inserted++
    else if (insErr.code === '23505') out.alreadySeen++
    else { out.errors++; console.error('[backfill] insert failed', insErr.message) }
  }

  let processedAll = true
  for (let i = 0; i < rows.length; i += 5) {
    if (Date.now() - startedAt > BUDGET_MS) { processedAll = false; break }
    const chunk = rows.slice(i, i + 5)
    await Promise.all(chunk.map((r) => one(r).catch((e) => { out.errors++; console.error('[backfill]', (e as Error).message) })))
    out.nextAfterId = chunk[chunk.length - 1].id
  }
  out.done = processedAll && rows.length < limit
  return NextResponse.json(out)
}
