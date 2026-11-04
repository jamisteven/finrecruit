import { JOB_SECTORS } from '@/lib/sectors'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getSessionClient } from '@/lib/supabase-session'
import { dedupeReposts, type RepostRow } from '@/lib/dedupeReposts'
import { matchEmployer } from '@/lib/employers'
import { locationFacets, type LocationFacets } from '@/lib/locations'
import type { WorkType } from '@/types'
import { cacheGet, cachePut } from '@/lib/analyticsCache'
import { keywordMatches, titleSearchGroups, titleFilter } from '@/lib/matchTarget'

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
  biotech: ['biotech', 'pharma', 'life science', 'clinical', 'cell therapy', 'gene therapy', 'drug discovery', 'drug development', 'regulatory affairs', 'cro'],
  pharma: ['pharma', 'biotech', 'life science', 'clinical', 'drug'],
  msl: ['medical science liaison', 'msl'],
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
const COLUMNS = 'id, title, company, location, seniority, salary, apply_method, summary, tags, sector, post_url, author_name, author_headline, author_linkedin_url, author_avatar, posted_at, extracted_at, is_verified_job, quality, work_type, employer_type, on_linkedin_jobs'
const HISTORY_DAYS = 30                 // longest window the page can ask for
const CORE_DAYS = 14                    // sent by default; older roles (CORE_DAYS..HISTORY_DAYS) only on request (?archive=1)
const OLD_TTL_MS = 12 * 3600_000        // roles older than 48h barely change: refresh every 12h (the 72h list below overlaps by 24h)
const ARCHIVE_TTL_MS = 12 * 3600_000     // the oldest roles change least
const RECENT_TTL_MS = 3 * 60_000        // the last 72h (and undated roles): refresh every 3 min
const RECENT_WINDOW_MS = 72 * 3600_000  // overlaps the 48h boundary so nothing falls between the caches
const PAGE = 1000

type Row = Record<string, any>
type Kind = 'old' | 'recent' | 'archive'
type Entry = { rows: Row[]; at: number }
const cache: Partial<Record<Kind, Entry>> = {}
const inflight: Partial<Record<Kind, Promise<Entry>>> = {}

// Rows come back 1000 at a time. Counting first lets every page be requested at once instead of one after
// another, so a cold start no longer takes longer as the table grows. Pages share one stable order; rows are
// de-duplicated by id in case a post lands between the count and the reads.
const PARALLEL_PAGES = 6
async function fetchAll(build: (q: any) => any): Promise<Row[]> {
  const db = createServerClient()
  const base = () => build(
    db.from('jobs').select(COLUMNS)
      .eq('is_verified_job', true)
      .or('quality.is.null,quality.neq.low')
  ).order('extracted_at', { ascending: false }).order('id', { ascending: true })
  const page = async (from: number): Promise<Row[]> => {
    const { data, error } = await base().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    return data ?? []
  }

  let total: number | null = null
  try {
    const { count, error } = await build(
      db.from('jobs').select('id', { count: 'exact', head: true })
        .eq('is_verified_job', true)
        .or('quality.is.null,quality.neq.low')
    )
    if (!error && typeof count === 'number') total = count
  } catch { /* fall back to reading page by page */ }

  const out: Row[] = []
  if (total !== null) {
    const starts: number[] = []
    for (let from = 0; from < total + PAGE; from += PAGE) starts.push(from)   // one spare page catches new rows
    for (let i = 0; i < starts.length; i += PARALLEL_PAGES) {
      const got = await Promise.all(starts.slice(i, i + PARALLEL_PAGES).map(page))
      for (const rows of got) out.push(...rows)
    }
    const seen = new Set<string>()
    return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }
  for (let from = 0; ; from += PAGE) {
    const data = await page(from)
    out.push(...data)
    if (data.length < PAGE) break
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

// The last 72h are refreshed every few minutes, but only the rows added since the previous refresh are read
// (a small overlap catches rows landing out of order). The whole window is re-read once an hour to pick up
// roles that were edited, removed or downgraded, and when the instance is cold.
const RECENT_FULL_REFRESH_MS = 60 * 60_000
const RECENT_OVERLAP_MS = 10 * 60_000
type RecentEntry = Entry & { fullAt: number; newest: number }
let recentEntry: RecentEntry | undefined
let recentInflight: Promise<RecentEntry> | undefined
const extractedMs = (r: Row) => { const t = Date.parse(String(r.extracted_at ?? '')); return Number.isFinite(t) ? t : 0 }

async function refreshRecent(prev?: RecentEntry): Promise<RecentEntry> {
  const now = Date.now()
  const cutoff = now - RECENT_WINDOW_MS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inWindow = (q: any) => q.or(`posted_at.gte.${new Date(cutoff).toISOString()},posted_at.is.null`)
  if (prev && prev.newest > 0 && now - prev.fullAt < RECENT_FULL_REFRESH_MS) {
    const since = new Date(prev.newest - RECENT_OVERLAP_MS).toISOString()
    const fresh = await fetchAll((q) => inWindow(q).gte('extracted_at', since))
    const byId = new Map<string, Row>(prev.rows.map((r) => [r.id as string, r]))
    for (const r of fresh) byId.set(r.id as string, r)
    const rows = [...byId.values()]
      .filter((r) => !r.posted_at || !(Date.parse(String(r.posted_at)) < cutoff))   // roles aged out of the window drop off
      .sort((a, b) => (extractedMs(b) - extractedMs(a)) || String(a.id).localeCompare(String(b.id)))
    return { rows, at: now, fullAt: prev.fullAt, newest: fresh.reduce((m, r) => Math.max(m, extractedMs(r)), prev.newest) }
  }
  const rows = await fetchAll(inWindow)
  return { rows, at: now, fullAt: now, newest: rows.reduce((m, r) => Math.max(m, extractedMs(r)), 0) }
}

async function loadRecent(): Promise<Row[]> {
  const hit = recentEntry
  if (hit && Date.now() - hit.at < RECENT_TTL_MS) return hit.rows
  if (!recentInflight) {
    recentInflight = refreshRecent(hit)
      .then((e) => { recentEntry = e; return e })
      .finally(() => { recentInflight = undefined })
  }
  try {
    return (await recentInflight).rows
  } catch (e) {
    if (hit) return hit.rows   // serve the last good copy rather than failing the page
    throw e
  }
}

// Counting the older roles costs Supabase almost nothing (no rows are sent), so the page can show
// the full total without downloading them.
const SECTORS = [...JOB_SECTORS]
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

// Who sees what. A pass sees every role in the window; everyone else sees roles older than the free delay plus
// a few fresh ones (3 in full, 2 as titles). Shared by the feed and by the location counts so both agree.
function tierPool(all: Row[], recentKept: Row[], hasPass: boolean, now: number, windowStart: number): {
  previewIds: string[]; teaserIds: string[]; withheld: number; pool: Row[]
} {
  const cutoff = now - FREE_DELAY_MS
  if (hasPass) {
    return {
      previewIds: [], teaserIds: [], withheld: 0,
      pool: all.filter((r) => { const t = ts(r.posted_at); return isNaN(t) || t >= windowStart }),
    }
  }
  // fresh = posted inside the free delay, newest first
  const fresh = recentKept
    .filter((r) => { const t = ts(r.posted_at); return !isNaN(t) && t >= cutoff })
    .sort((a, b) => ts(b.posted_at) - ts(a.posted_at))
  const top = fresh.slice(0, FREE_SAMPLE_COUNT + FREE_TITLE_ONLY_COUNT)
  const previewIds = top.slice(0, FREE_SAMPLE_COUNT).map((r) => r.id as string)
  const teaserIds = top.slice(FREE_SAMPLE_COUNT).map((r) => r.id as string)
  const pv = new Set([...previewIds, ...teaserIds])
  return {
    previewIds, teaserIds,
    withheld: Math.max(0, fresh.length - top.length),
    pool: all.filter((r) => {
      if (pv.has(r.id)) return true
      const t = ts(r.posted_at)
      return !isNaN(t) && t < cutoff && t >= windowStart
    }),
  }
}

// Region and city counts are the same for every visitor on a tier, so they are worked out once and kept for a while.
const FACET_TTL_MS = 10 * 60_000
const FACET_MAX = 300
const facetCache = new Map<string, { v: LocationFacets; at: number }>()
const WORK_TYPE_SET = new Set(['Remote', 'Hybrid', 'On-site'])

// The headline numbers (total roles and roles per sector) and the region/city counts are kept in the database,
// so the page can show them the moment it loads instead of waiting for the month's roles to be read. Whoever
// builds the full list refreshes them as a by-product (no extra reads), at most every STATS_WRITE_MS.
const STATS_MAX_AGE_MS = 24 * 3600_000      // older than this is not shown at all
const STATS_WRITE_MS = 5 * 60_000
const FACET_DB_TTL_MS = 30 * 60_000
const statsWrittenAt: Record<string, number> = {}
type FeedStats = { total: number; sectors: Record<string, number>; at: number }

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
  // quick=1: the newest page only, answered from the last 72h so it does not wait for the whole month to load
  const quick = searchParams.get('quick') === '1' && !archive
  // facets=1: region and city counts over the whole month, no roles
  const facets = searchParams.get('facets') === '1'

  // pub=1: the visitor's browser holds no sign-in cookie, so the answer is the free-tier list, which is the same
  // for everyone and can sit in the CDN for a couple of minutes instead of waking the server for each page load.
  // It never carries a member's view: with pub=1 the session is not even read, so it can only ever be the free list.
  const pub = searchParams.get('pub') === '1'
    && searchParams.get('mine') !== '1' && searchParams.get('freshCount') !== '1' && searchParams.get('withheld') !== '1'
  const sharedCache = 'public, max-age=60, s-maxage=120, stale-while-revalidate=600'
  const cacheControl = pub ? sharedCache : 'private, max-age=60'

  // Pass holders see roles as they land; everyone else waits FREE_DELAY_HOURS
  let hasPass = false
  let passExpiresAt: string | null = null
  let userId: string | null = null
  try {
    if (pub) throw new Error('pub')   // skip the session entirely (caught below: free tier)
    const session = await getSessionClient()
    const { data: { user } } = await session.auth.getUser()
    if (user) {
      userId = user.id
      const { data: profile, error: profErr } = await createServerClient()
        .from('profiles').select('pass_expires_at').eq('id', user.id).maybeSingle()
      passExpiresAt = profile?.pass_expires_at ?? null
      hasPass = !!profile?.pass_expires_at && new Date(profile.pass_expires_at) > new Date()
      if (profErr) console.error('[jobs] profile query error:', profErr.message)
    }
  } catch { /* treat any failure as free tier */ }

  // A member's matches, straight from the database: only roles whose title could match one of their saved
  // searches (the same title prefilter the analytics page uses), checked exactly in code. A few hundred rows
  // at most, read in one go whatever the state of the server's caches, so the home page does not have to
  // wait for the whole month's roles before it can show a member their matches.
  if (searchParams.get('mine') === '1') {
    const out = (body: unknown) => {
      const r = NextResponse.json(body)
      r.headers.set('Cache-Control', 'private, no-store')
      return r
    }
    if (!hasPass || !userId) return out({ mine: false, jobs: [] })
    try {
      const db = createServerClient()
      const { data: targets, error: tErr } = await db.from('user_targets').select('keyword').eq('user_id', userId)
      if (tErr) throw new Error(tErr.message)
      const keywords = [...new Set((targets ?? []).map((t) => String(t.keyword)))].slice(0, 12)
      const since = new Date(Date.now() - CORE_DAYS * 86400000).toISOString()
      const byId = new Map<string, Row>()
      await Promise.all(keywords.map(async (kw) => {
        const groups = titleSearchGroups(kw)
        if (!groups) return
        for (let from = 0; from < 5000; from += PAGE) {
          let q = db.from('jobs').select(COLUMNS)
            .eq('is_verified_job', true)
            .or('quality.is.null,quality.neq.low')
            .or(`posted_at.gte.${since},posted_at.is.null`)
          for (const g of groups) q = q.or(g.map(titleFilter).join(','))
          const { data, error } = await q.order('extracted_at', { ascending: false }).order('id', { ascending: true }).range(from, from + PAGE - 1)
          if (error) throw new Error(error.message)
          for (const r of data ?? []) if (keywordMatches(kw, String(r.title ?? ''), null)) byId.set(r.id, r)
          if (!data || data.length < PAGE) break
        }
      }))
      const jobs = dedupeReposts([...byId.values()] as (Row & RepostRow)[])
      return out({ mine: true, jobs })
    } catch (e) {
      console.error('[jobs] mine failed:', (e as Error).message)
      return out({ mine: false, jobs: [] })
    }
  }

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
        .slice(FREE_SAMPLE_COUNT + FREE_TITLE_ONLY_COUNT) // the samples and teasers are already visible
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
      const samples = new Set(fresh.slice(0, FREE_SAMPLE_COUNT + FREE_TITLE_ONLY_COUNT).map((r) => r.id as string))
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

  // Region/city counts: answered from memory or the shared cache when possible, before any roles are read
  const tier = hasPass ? 'pass' : 'free'
  let facetKey = ''
  if (facets) {
    const wts = (searchParams.get('wt') ?? '').split('|').filter((w) => WORK_TYPE_SET.has(w)).sort()
    facetKey = [tier, sector && sector !== 'all' ? sector : 'all', wts.join(','), searchParams.get('region') || '', searchParams.get('cities') === '1' ? 'c' : ''].join('|')
    const send = (v: LocationFacets) => {
      const r = NextResponse.json(v)
      r.headers.set('Cache-Control', cacheControl)
      return r
    }
    const mem = facetCache.get(facetKey)
    if (mem && Date.now() - mem.at < FACET_TTL_MS) return send(mem.v)
    const shared = await cacheGet(createServerClient(), `feed:facets:${facetKey}`, FACET_DB_TTL_MS)
    if (shared) {
      const v = shared.out as unknown as LocationFacets
      facetCache.set(facetKey, { v, at: Date.now() })
      return send(v)
    }
  }

  let oldRows: Row[], recentRows: Row[], archiveRows: Row[] = []
  let sharedStats: FeedStats | null = null
  try {
    if (facets) {
      ;[oldRows, recentRows, archiveRows] = await Promise.all([loadOld(), loadRecent(), loadArchive()])
    } else if (archive) {
      // older-than-default roles only; the page already holds everything newer
      oldRows = await loadArchive()
      recentRows = []
    } else if (quick) {
      oldRows = []
      ;[recentRows, sharedStats] = await Promise.all([
        loadRecent(),
        cacheGet(createServerClient(), `feed:stats:${tier}`, STATS_MAX_AGE_MS)
          .then((c) => (c ? ({ ...(c.out as Omit<FeedStats, 'at'>), at: c.at } as FeedStats) : null)),
      ])
    } else {
      ;[oldRows, recentRows] = await Promise.all([loadOld(), loadRecent()])
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load roles' }, { status: 500 })
  }

  const now = Date.now()
  const windowStart = now - maxAgeDays * 86400000

  // merge the caches, dropping duplicates in the overlap
  const seen = new Set<string>()
  const merged: Row[] = []
  for (const r of recentRows) { seen.add(r.id); merged.push(r) }
  for (const r of oldRows) if (!seen.has(r.id)) { seen.add(r.id); merged.push(r) }
  for (const r of archiveRows) if (!seen.has(r.id)) merged.push(r)

  // then fold reposts of the same mandate into their newest post, so every
  // count below (fresh, today, totals, matches) talks about jobs, not posts
  const all: Row[] = dedupeReposts(merged as (Row & RepostRow)[])
  const recentIds = new Set(recentRows.map((r) => r.id))
  const recentKept = all.filter((r) => recentIds.has(r.id))

  const addedToday = recentKept.filter((r) => ts(r.posted_at) >= now - 24 * 3600_000).length
  // newest posting time across the live set (the feed itself is ordered by extraction, not posting)
  const latestPostedAt = recentKept.reduce<string | null>((best, r) => {
    const t = ts(r.posted_at)
    return !isNaN(t) && t <= now && (!best || t > ts(best)) ? (r.posted_at as string) : best
  }, null)

  // Free tier: everything older than FREE_DELAY_HOURS, plus FREE_SAMPLE_COUNT fresh roles in full.
  // The next FREE_TITLE_ONLY_COUNT fresh roles go out like any older role: readable, but without the
  // recruiter's name, photo, profile or post link (they are marked gated below).
  const { previewIds, teaserIds, withheld, pool: tierRows } = tierPool(all, recentKept, hasPass, now, windowStart)
  let pool: Row[] = tierRows
  const lockedJobs: { title: string; sector: string; posted_at: string | null }[] = []

  if (facets) {
    const wts = (searchParams.get('wt') ?? '').split('|').filter((w) => WORK_TYPE_SET.has(w)).sort() as WorkType[]
    const v = locationFacets(pool as any[], {
      sector: sector && sector !== 'all' ? sector : 'all', workTypes: wts,
      region: searchParams.get('region') || null, cities: searchParams.get('cities') === '1',
    })
    if (facetCache.size >= FACET_MAX) facetCache.delete(facetCache.keys().next().value as string)
    facetCache.set(facetKey, { v, at: now })
    void cachePut(createServerClient(), `feed:facets:${facetKey}`, v as unknown as Record<string, unknown>)
    const r = NextResponse.json(v)
    r.headers.set('Cache-Control', cacheControl)
    return r
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
  if (!archive && !quick) {
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

  // Free tier: the role is readable in full, the person is not. Anything outside the free samples
  // goes out without the recruiter's name, photo or profile, and without the post link (the post
  // URL carries the author's name). The card's recruiter line is the one route to /offer.
  const pv = new Set(previewIds)
  const jobs = pool.slice(offset, offset + limit).map((r) =>
    hasPass || pv.has(r.id)
      ? r
      : { ...r, post_url: '', author_name: null, author_linkedin_url: null, author_avatar: null, gated: true })
  const archiveCounts = archive ? undefined : await loadArchiveCounts()
  // Totals for the headline: what this visitor's tier can see, plus the older roles counted by the server.
  // Worked out only for the plain request (no search or filters), so every visitor on a tier shares one figure.
  let stats: FeedStats | undefined
  if (!archive && !quick && !seniority && !sector && !search && offset === 0 && archiveCounts) {
    const sectors: Record<string, number> = {}
    for (const sec of SECTORS) sectors[sec] = (archiveCounts[sec] ?? 0)
    for (const r of tierRows) { const k = String(r.sector ?? ''); if (k in sectors) sectors[k]++ }
    stats = { total: tierRows.length + Object.values(archiveCounts).reduce((a, b) => a + b, 0), sectors, at: now }
    if (now - (statsWrittenAt[tier] ?? 0) > STATS_WRITE_MS) {
      statsWrittenAt[tier] = now
      void cachePut(createServerClient(), `feed:stats:${tier}`, { total: stats.total, sectors })
    }
  }
  const res = NextResponse.json({
    topCompanies,
    jobs,
    total: pool.length,
    hasPass,
    passExpiresAt: hasPass ? passExpiresAt : null,
    withheld,
    lockedJobs,
    teaserIds,
    previewCount: previewIds.length,
    previewIds,
    addedToday,
    latestPostedAt,
    ...(archive ? {} : { archiveCounts }),
    stats: stats ?? sharedStats ?? undefined,
    ...(pub ? { pub: true } : {}),
  })
  // the browser may reuse this for a minute (refreshes, sort toggles) without hitting the server;
  // free-tier copies may also sit in the CDN
  res.headers.set('Cache-Control', cacheControl)
  return res
}
