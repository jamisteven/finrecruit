import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'
import { dedupeReposts, type RepostRow } from '@/lib/dedupeReposts'
import { matchEmployer } from '@/lib/employers'

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
const CORE_DAYS = 14                    // sent by default; older roles (CORE_DAYS..HISTORY_DAYS) only on request (?archive=1)
const OLD_TTL_MS = 4 * 3600_000         // roles older than 48h barely change: refresh every 4h
const ARCHIVE_TTL_MS = 12 * 3600_000     // the oldest roles change least
const RECENT_TTL_MS = 3 * 60_000        // the last 72h (and undated roles): refresh every 3 min
const RECENT_WINDOW_MS = 72 * 3600_000  // overlaps the 48h boundary so nothing falls between the caches
const PAGE = 1000

type Row = Record<string, any>
type Kind = 'old' | 'recent' | 'archive'
type Entry = { rows: Row[]; at: number }
const cache: Partial<Record<Kind, Entry>> = {}
const inflight: Partial<Record<Kind, Promise<Entry>>> = {}

async function fetchAll(build: (q: any) => any): Promise<Row[]> {
  const db = createServerClient()
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const q = build(
      db.from('jobs').select(COLUMNS)
        .eq('is_verified_job', true)
        .or('quality.is.null,quality.neq.low')
    ).order('extracted_at', { ascending: false }).order('id', { ascending: true }).range(from, from + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function load(kind: Kind, ttl: number, build: (q: any) => any): Promise<Row[]> {
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

// 48h .. CORE_DAYS old: the default list
const loadOld = () => load('old', OLD_TTL_MS, (q) => q
  .gte('posted_at', new Date(Date.now() - CORE_DAYS * 86400000).toISOString())
  .lt('posted_at', new Date(Date.now() - FREE_DELAY_MS).toISOString()))

// CORE_DAYS .. HISTORY_DAYS old: only read from Supabase if someone asks for it
const loadArchive = () => load('archive', ARCHIVE_TTL_MS, (q) => q
  .gte('posted_at', new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString())
  .lt('posted_at', new Date(Date.now() - CORE_DAYS * 86400000).toISOString()))

const loadRecent = () => load('recent', RECENT_TTL_MS, (q) => q
  .or(`posted_at.gte.${new Date(Date.now() - RECENT_WINDOW_MS).toISOString()},posted_at.is.null`))

// Counting the older roles costs Supabase almost nothing (no rows are sent), so the page can show
// the full total without downloading them.
const SECTORS = ['finance', 'tech', 'legal', 'marketing', 'realestate', 'sales', 'hr']
let countsCache: { v: Record<string, number>; at: number } | undefined
async function loadArchiveCounts(): Promise<Record<string, number> | undefined> {
  if (countsCache && Date.now() - countsCache.at < ARCHIVE_TTL_MS / 2) return countsCache.v
  try {
    const db = createServerClient()
    const lo = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString()
    const hi = new Date(Date.now() - CORE_DAYS * 86400000).toISOString()
    const res = await Promise.all(SECTORS.map((sec) =>
      db.from('jobs').select('id', { count: 'exact', head: true })
        .eq('is_verified_job', true).or('quality.is.null,quality.neq.low')
        .eq('sector', sec).gte('posted_at', lo).lt('posted_at', hi)))
    const failed = res.find((x) => x.error)
    if (failed?.error) throw new Error(failed.error.message)
    const v: Record<string, number> = {}
    SECTORS.forEach((sec, i) => { v[sec] = res[i].count ?? 0 })
    countsCache = { v, at: Date.now() }
    return v
  } catch (e) {
    console.error('[jobs] archive counts failed:', (e as Error).message)
    return countsCache?.v
  }
}

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

// Every word must match somewhere (title, company, summary or tags); abbreviations are expanded.
function matchesSearch(r: Row, tokens: string[]): boolean {
  return tokens.every((tok) => {
    const phrases = SEARCH_SYNONYMS[tok] ?? [tok]
    return (Array.isArray(r.tags) && r.tags.some((t: string) => String(t).toLowerCase() === tok)) ||
      phrases.some((p) => haystack(r).includes(p))
  })
}
const tokenize = (s: string) => s.toLowerCase().replace(/[,()%*\\"]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const seniority = searchParams.get('seniority')
  const search = searchParams.get('search')
  const sector = searchParams.get('sector')
  const sortBy = searchParams.get('sortBy') || 'newest'
  const limit = Math.max(1, parseInt(searchParams.get('limit') || '20000'))
  const maxAgeDays = Math.min(HISTORY_DAYS, parseInt(searchParams.get('maxAge') || String(HISTORY_DAYS)))
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))
  const archive = searchParams.get('archive') === '1'   // older roles, requested on demand

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

  // Lightweight count for the search upsell line: how many roles inside the free delay match this
  // search. Only a number leaves the server, never the roles themselves. Uses the in-memory cache.
  if (searchParams.get('freshCount') === '1') {
    const out = (n: number) => {
      const r = NextResponse.json({ freshMatches: n })
      r.headers.set('Cache-Control', 'private, max-age=60')
      return r
    }
    if (hasPass || !search) return out(0)
    try {
      const rows = await loadRecent()
      const cut = Date.now() - FREE_DELAY_MS
      const fr = rows
        .filter((r) => { const t = ts(r.posted_at); return !isNaN(t) && t >= cut })
        .sort((a, b) => ts(b.posted_at) - ts(a.posted_at))
        .slice(FREE_SAMPLE_COUNT)                       // the free samples are already visible
        .filter((r) => !sector || sector === 'all' || r.sector === sector)
      return out(fr.filter((r) => matchesSearch(r, tokenize(search))).length)
    } catch { return out(0) }
  }

  // The offer page's pitch: which fresh roles, matching what this visitor last searched, are they
  // not seeing? Title, location and age only — the same fields the locked cards already show free
  // visitors — never company, summary, recruiter or link. The free samples are excluded since the
  // visitor can already open those.
  if (searchParams.get('withheld') === '1') {
    const out = (body: unknown) => {
      const r = NextResponse.json(body)
      r.headers.set('Cache-Control', 'private, max-age=60')
      return r
    }
    if (hasPass) return out({ roles: [], matched: 0, total: 0 })
    try {
      const rows = await loadRecent()
      const cut = Date.now() - FREE_DELAY_MS
      const fresh = rows
        .filter((r) => { const t = ts(r.posted_at); return !isNaN(t) && t >= cut })
        .sort((a, b) => ts(b.posted_at) - ts(a.posted_at))
      const samples = new Set(fresh.slice(0, FREE_SAMPLE_COUNT).map((r) => r.id as string))
      const pool = fresh.filter((r) => !samples.has(r.id as string))
      const q = (searchParams.get('q') ?? '').trim()
      const locs = (searchParams.get('loc') ?? '').split('|').map((l) => l.trim().toLowerCase()).filter(Boolean)
      const tokens = q ? tokenize(q) : []
      let matched = pool
      if (tokens.length) matched = matched.filter((r) => matchesSearch(r, tokens))
      if (locs.length) matched = matched.filter((r) => locs.some((l) => String(r.location ?? '').toLowerCase().includes(l)))
      if (sector && sector !== 'all') matched = matched.filter((r) => r.sector === sector)
      const strip = (r: Row) => ({ title: r.title, location: r.location ?? null, sector: r.sector ?? null, posted_at: r.posted_at ?? null })
      return out({
        roles: matched.slice(0, 5).map(strip),
        matched: matched.length,
        total: pool.length,
        // when the search matched nothing fresh, the newest overall still make the point
        fallback: matched.length === 0 ? pool.slice(0, 3).map(strip) : [],
      })
    } catch { return out({ roles: [], matched: 0, total: 0, fallback: [] }) }
  }

  let oldRows: Row[], recentRows: Row[]
  try {
    if (archive) {
      // older-than-default roles only; the page already holds everything newer
      oldRows = await loadArchive()
      recentRows = []
    } else {
      ;[oldRows, recentRows] = await Promise.all([loadOld(), loadRecent()])
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load roles' }, { status: 500 })
  }

  const now = Date.now()
  const cutoff = now - FREE_DELAY_MS
  const windowStart = now - maxAgeDays * 86400000

  // merge the two caches, dropping duplicates in the overlap
  const seen = new Set<string>()
  const merged: Row[] = []
  for (const r of recentRows) { seen.add(r.id); merged.push(r) }
  for (const r of oldRows) if (!seen.has(r.id)) merged.push(r)

  // then fold reposts of the same mandate into their newest post, so every
  // count below (fresh, today, totals, matches) talks about jobs, not posts
  const all: Row[] = dedupeReposts(merged as (Row & RepostRow)[])
  const recentIds = new Set(recentRows.map((r) => r.id))
  const recentKept = all.filter((r) => recentIds.has(r.id))

  // fresh = posted inside the free delay, newest first
  const fresh = recentKept
    .filter((r) => { const t = ts(r.posted_at); return !isNaN(t) && t >= cutoff })
    .sort((a, b) => ts(b.posted_at) - ts(a.posted_at))
  const addedToday = recentKept.filter((r) => ts(r.posted_at) >= now - 24 * 3600_000).length

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

  // Recognisable employers in the feed right now, for the home-page strip: a
  // live count over the same rows the visitor is served, never a hand-kept list.
  const MIN_ROLES_FOR_STRIP = 2
  const employerCounts = new Map<string, { name: string; domain: string; count: number }>()
  if (!archive) {
    for (const r of all) {
      const e = matchEmployer(r.company as string | null)
      if (!e) continue
      const cur = employerCounts.get(e.domain) ?? { name: e.name, domain: e.domain, count: 0 }
      cur.count++
      employerCounts.set(e.domain, cur)
    }
  }
  const topCompanies = [...employerCounts.values()]
    .filter((e) => e.count >= MIN_ROLES_FOR_STRIP)
    .sort((a, b) => b.count - a.count)
    .slice(0, 24)

  const jobs = pool.slice(offset, offset + limit)
  const res = NextResponse.json({
    topCompanies,
    jobs,
    total: pool.length,
    hasPass,
    passExpiresAt: hasPass ? passExpiresAt : null,
    withheld,
    lockedJobs,
    previewCount: previewIds.length,
    previewIds,
    addedToday,
    ...(archive ? {} : { archiveCounts: await loadArchiveCounts() }),
  })
  // the browser may reuse this for a minute (refreshes, sort toggles) without hitting the server
  res.headers.set('Cache-Control', 'private, max-age=60')
  return res
}
