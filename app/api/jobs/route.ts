import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'

// Free visitors see a role only once it is this old. Keep in sync with FREE_DELAY_HOURS in app/page.tsx.
const FREE_DELAY_HOURS = 48
const FREE_DELAY_MS = FREE_DELAY_HOURS * 3600_000
// Fresh roles a free visitor can read in full, then how many more are shown as a title only
const FREE_SAMPLE_COUNT = 3
const FREE_TITLE_ONLY_COUNT = 2


// Search shorthand -> the phrases people actually write in job titles
const SEARCH_SYNONYMS: Record<string, string[]> = {
  swe: ['software engineer', 'software developer'],
  sde: ['software development engineer', 'software engineer'],
  sre: ['site reliability'],
  devops: ['devops', 'dev ops', 'platform engineer'],
  fe: ['front end', 'frontend', 'front-end'],
  be: ['back end', 'backend', 'back-end'],
  fullstack: ['full stack', 'fullstack', 'full-stack'],
  pm: ['product manager', 'project manager', 'program manager'],
  tpm: ['technical program manager', 'technical project manager'],
  pmm: ['product marketing'],
  ml: ['machine learning'],
  grc: ['grc', 'governance, risk', 'governance risk', 'risk and compliance', 'risk & compliance'],
  ds: ['data scientist', 'data science'],
  da: ['data analyst'],
  ba: ['business analyst'],
  qa: ['quality assurance', 'qa engineer', 'test engineer'],
  hr: ['human resources', 'hr manager', 'people operations'],
  vp: ['vice president', 'vp of'],
  svp: ['senior vice president'],
  md: ['managing director'],
  ae: ['account executive'],
  sdr: ['sales development'],
  bdr: ['business development'],
  csm: ['customer success'],
  cfo: ['chief financial', 'cfo'],
  coo: ['chief operating', 'coo'],
  cto: ['chief technology', 'cto'],
  ib: ['investment bank'],
  pe: ['private equity'],
  vc: ['venture capital'],
  re: ['real estate'],
}

// ---------------------------------------------------------------------------
// Egress control: the job list is read from Supabase at most once per cache window per
// server instance, then every request (search, filters, free/pass tiers) is answered from
// memory. Before this, every page load pulled the full table (~17 MB) from Supabase.
// ---------------------------------------------------------------------------
const COLUMNS = 'id, title, company, location, seniority, salary, apply_method, summary, tags, sector, post_url, author_name, author_headline, author_linkedin_url, author_avatar, posted_at, extracted_at, is_verified_job, quality, work_type'
const HISTORY_DAYS = 30                 // longest window the page can ask for
const OLD_TTL_MS = 4 * 3600_000         // roles older than 48h barely change: refresh every 4h
const RECENT_TTL_MS = 3 * 60_000        // the last 72h (and undated roles): refresh every 3 min
const RECENT_WINDOW_MS = 72 * 3600_000  // overlaps the 48h boundary so nothing falls between the caches
const PAGE = 1000

type Row = Record<string, any>
type Entry = { rows: Row[]; at: number }
const cache: { old?: Entry; recent?: Entry } = {}
const inflight: { old?: Promise<Entry>; recent?: Promise<Entry> } = {}

async function fetchAll(build: (q: any) => any): Promise<Row[]> {
  const db = createServerClient()
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const q = build(
      db.from('jobs').select(COLUMNS)
        .eq('is_verified_job', true)
        .or('quality.is.null,quality.neq.low')
        .neq('sector', 'other')
    ).order('extracted_at', { ascending: false }).order('id', { ascending: true }).range(from, from + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function load(kind: 'old' | 'recent', ttl: number, build: (q: any) => any): Promise<Row[]> {
  const hit = cache[kind]
  if (hit && Date.now() - hit.at < ttl) return hit.rows
  if (!inflight[kind]) {
    inflight[kind] = fetchAll(build)
      .then((rows) => { const e = { rows, at: Date.now() }; cache[kind] = e; return e })
      .finally(() => { inflight[kind] = undefined })
  }
  try {
    return (await inflight[kind]!).rows
  } catch (e) {
    // serve stale data rather than failing the page if Supabase hiccups (or is over quota)
    if (hit) return hit.rows
    throw e
  }
}

const loadOld = () => load('old', OLD_TTL_MS, (q) => q
  .gte('posted_at', new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString())
  .lt('posted_at', new Date(Date.now() - FREE_DELAY_MS).toISOString()))

const loadRecent = () => load('recent', RECENT_TTL_MS, (q) => q
  .or(`posted_at.gte.${new Date(Date.now() - RECENT_WINDOW_MS).toISOString()},posted_at.is.null`))

const hay = new WeakMap<Row, string>()
function haystack(r: Row): string {
  let h = hay.get(r)
  if (h === undefined) {
    h = `${r.title ?? ''} ${r.company ?? ''} ${r.summary ?? ''}`.toLowerCase()
    hay.set(r, h)
  }
  return h
}

const ts = (v: string | null | undefined) => (v ? Date.parse(v) : NaN)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const seniority = searchParams.get('seniority')
  const search = searchParams.get('search')
  const sector = searchParams.get('sector')
  const sortBy = searchParams.get('sortBy') || 'newest'
  const limit = Math.max(1, parseInt(searchParams.get('limit') || '20000'))
  const maxAgeDays = Math.min(HISTORY_DAYS, parseInt(searchParams.get('maxAge') || String(HISTORY_DAYS)))
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))

  // Pass holders see roles as they land; everyone else waits FREE_DELAY_HOURS
  let hasPass = false
  let passExpiresAt: string | null = null
  try {
    const session = await getSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (user) {
      const { data: profile, error: profErr } = await createServerClient()
        .from('profiles').select('pass_expires_at').eq('id', user.id).maybeSingle()
      passExpiresAt = profile?.pass_expires_at ?? null
      hasPass = !!profile?.pass_expires_at && new Date(profile.pass_expires_at) > new Date()
      if (profErr) console.error('[jobs] profile query error:', profErr.message)
    }
  } catch { /* treat any failure as free tier */ }

  let oldRows: Row[], recentRows: Row[]
  try {
    ;[oldRows, recentRows] = await Promise.all([loadOld(), loadRecent()])
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load roles' }, { status: 500 })
  }

  const now = Date.now()
  const cutoff = now - FREE_DELAY_MS
  const windowStart = now - maxAgeDays * 86400000

  // merge the two caches, dropping duplicates in the overlap
  const seen = new Set<string>()
  const all: Row[] = []
  for (const r of recentRows) { seen.add(r.id); all.push(r) }
  for (const r of oldRows) if (!seen.has(r.id)) all.push(r)

  // fresh = posted inside the free delay, newest first
  const fresh = recentRows
    .filter((r) => { const t = ts(r.posted_at); return !isNaN(t) && t >= cutoff })
    .sort((a, b) => ts(b.posted_at) - ts(a.posted_at))
  const addedToday = recentRows.filter((r) => ts(r.posted_at) >= now - 24 * 3600_000).length

  // Free tier: everything older than FREE_DELAY_HOURS, plus FREE_SAMPLE_COUNT fresh roles in full.
  // The next FREE_TITLE_ONLY_COUNT fresh roles go out as a title only (no id, company, link or summary).
  let previewIds: string[] = []
  let lockedJobs: { title: string; sector: string; posted_at: string | null }[] = []
  let withheld = 0
  let pool: Row[]
  if (hasPass) {
    pool = all.filter((r) => { const t = ts(r.posted_at); return isNaN(t) || t >= windowStart })
  } else {
    const top = fresh.slice(0, FREE_SAMPLE_COUNT + FREE_TITLE_ONLY_COUNT)
    previewIds = top.slice(0, FREE_SAMPLE_COUNT).map((r) => r.id as string)
    lockedJobs = top.slice(FREE_SAMPLE_COUNT).map((r) => ({
      title: r.title as string,
      sector: r.sector as string,
      posted_at: (r.posted_at as string | null) ?? null,
    }))
    withheld = Math.max(0, fresh.length - previewIds.length)
    const pv = new Set(previewIds)
    pool = all.filter((r) => {
      if (pv.has(r.id)) return true
      const t = ts(r.posted_at)
      return !isNaN(t) && t < cutoff && t >= windowStart
    })
  }

  if (seniority && seniority !== 'All') pool = pool.filter((r) => r.seniority === seniority)
  if (sector && sector !== 'all') pool = pool.filter((r) => r.sector === sector)
  if (search) {
    // Every word must match somewhere (title, company, summary or tags), and common
    // abbreviations are expanded. Raw abbreviations only match the exact tag: a plain
    // substring would hit "employment" / "Sweden".
    const tokens = search.toLowerCase().replace(/[,()%*\\"]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6)
    for (const tok of tokens) {
      const phrases = SEARCH_SYNONYMS[tok] ?? [tok]
      pool = pool.filter((r) =>
        (Array.isArray(r.tags) && r.tags.some((t: string) => String(t).toLowerCase() === tok)) ||
        phrases.some((p) => haystack(r).includes(p)))
    }
  }

  pool.sort((a, b) => {
    const x = String(a.extracted_at ?? ''), y = String(b.extracted_at ?? '')
    return sortBy === 'oldest' ? (x < y ? -1 : x > y ? 1 : 0) : (x < y ? 1 : x > y ? -1 : 0)
  })

  const jobs = pool.slice(offset, offset + limit)
  const res = NextResponse.json({
    jobs,
    total: pool.length,
    hasPass,
    passExpiresAt: hasPass ? passExpiresAt : null,
    withheld,
    lockedJobs,
    previewCount: previewIds.length,
    previewIds,
    addedToday,
  })
  // the browser may reuse this for a minute (refreshes, sort toggles) without hitting the server
  res.headers.set('Cache-Control', 'private, max-age=60')
  return res
}
