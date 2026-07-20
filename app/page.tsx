'use client'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { JobPost, FilterState, Sector, WorkType } from '@/types'

const DEFAULT_FILTERS: FilterState = {
  sector: 'all', seniority: 'All', locations: [], workTypes: [], search: '', sortBy: 'newest',
}

const SECTORS: { id: Sector; label: string }[] = [
  { id: 'all',       label: 'All sectors' },
  { id: 'finance',   label: 'Finance' },
  { id: 'tech',      label: 'Tech' },
  { id: 'legal',     label: 'Legal' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'realestate', label: 'Real Estate' },
]

const WORK_TYPES: WorkType[] = ['Remote', 'Hybrid', 'On-site']

// JobPost.sector is a plain string in the API payload, so accept any string
const sectorLabel = (s: string) =>
  SECTORS.find((x) => x.id === s)?.label ?? (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other')

// ── Drop schedule (UTC) — mirrors the crons in vercel.json ──
const DROP_SECTORS_FULL = ['finance', 'tech', 'legal', 'marketing', 'realestate']
const DROP_BATCHES: { days: number[]; utcHour: number; utcMin: number; sectors: string[] }[] = [
  { days: [1, 2, 3, 4, 5], utcHour: 14, utcMin: 0, sectors: DROP_SECTORS_FULL },
  { days: [1, 2, 3, 4, 5], utcHour: 19, utcMin: 0, sectors: DROP_SECTORS_FULL },
  { days: [1],             utcHour: 7,  utcMin: 0, sectors: ['finance', 'tech'] },
]
const SLOT_MS = 10 * 60_000  // sectors fire 10 minutes apart
const TAIL_MS = 5 * 60_000   // grace period after the last sector's slot

type Drop = { start: number; end: number; sectors: string[] }

function dropsAround(now: number): { prev: Drop | null; next: Drop | null; current: Drop | null } {
  const drops: Drop[] = []
  const base = new Date(now)
  for (let d = -8; d <= 8; d++) {
    const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + d))
    for (const b of DROP_BATCHES) {
      if (!b.days.includes(day.getUTCDay())) continue
      const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), b.utcHour, b.utcMin)
      drops.push({ start, end: start + (b.sectors.length - 1) * SLOT_MS + TAIL_MS, sectors: b.sectors })
    }
  }
  drops.sort((a, b) => a.start - b.start)
  return {
    current: drops.find((dr) => now >= dr.start && now < dr.end) ?? null,
    next: drops.find((dr) => dr.start > now) ?? null,
    prev: [...drops].reverse().find((dr) => dr.end <= now) ?? null,
  }
}

const DEMO_JOBS: JobPost[] = [
  { id: '1', title: 'Equity Research Analyst — TMT', company: 'Tier 1 Hedge Fund', location: 'London', seniority: 'Senior', salary: '£120k–£160k + carry', apply_method: 'DM recruiter', summary: 'Long/short equity fund seeking a TMT-focused analyst with 4–7 years buyside experience.', tags: ['hedge-fund', 'equities', 'london'], sector: 'finance', post_url: '#', author_name: 'Sarah Mitchell', author_headline: 'Executive Search | Hedge Funds & Asset Management', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 7200000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
  { id: '2', title: 'Senior Software Engineer — AI Platform', company: 'Series B Startup', location: 'New York', seniority: 'Senior', salary: '$180k–$220k + equity', apply_method: 'Email CV', summary: 'Fast-growing AI startup hiring a senior engineer to build core inference infrastructure.', tags: ['ai', 'backend', 'new-york'], sector: 'tech', post_url: '#', author_name: 'James Park', author_headline: 'Tech Recruiter | AI & Engineering', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 10800000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
  { id: '3', title: 'Corporate Associate — M&A', company: 'Magic Circle Law Firm', location: 'London', seniority: 'Mid', salary: '£95k–£120k', apply_method: 'Apply via link', summary: 'Top-tier law firm seeking a 3–5 PQE corporate associate for a busy M&A practice.', tags: ['legal', 'corporate', 'ma', 'london'], sector: 'legal', post_url: '#', author_name: 'Claire Hughes', author_headline: 'Legal Recruiter | City Law Firms', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 18000000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
  { id: '4', title: 'Head of Performance Marketing', company: 'DTC Scale-up', location: 'Remote', seniority: 'Director', salary: '$130k–$160k', apply_method: 'DM recruiter', summary: 'High-growth consumer brand hiring a performance marketing lead to own paid acquisition.', tags: ['performance-marketing', 'paid-social', 'remote'], sector: 'marketing', post_url: '#', author_name: 'Priya Nair', author_headline: 'Marketing Recruiter | Growth & Brand', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 28800000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
]

// Country/region groups so "Switzerland" catches Zurich, Geneva, Basel, …
// Keywords ≤3 chars are matched as whole words to avoid e.g. "us" matching "Austin".
const REGIONS: Record<string, string[]> = {
  'Switzerland':    ['switzerland', 'zurich', 'zürich', 'geneva', 'genève', 'genf', 'basel', 'bern', 'lausanne', 'zug', 'lugano', 'st. gallen', 'winterthur'],
  'United Kingdom': ['united kingdom', 'uk', 'england', 'scotland', 'london', 'manchester', 'edinburgh', 'birmingham', 'leeds', 'glasgow', 'bristol', 'cambridge', 'oxford', 'belfast'],
  'United States':  ['united states', 'usa', 'us', 'new york', 'nyc', 'san francisco', 'bay area', 'boston', 'chicago', 'los angeles', 'austin', 'seattle', 'miami', 'atlanta', 'dallas', 'houston', 'denver', 'washington', 'charlotte', 'philadelphia', 'california', 'texas', 'arizona'],
  'Germany':        ['germany', 'berlin', 'munich', 'münchen', 'frankfurt', 'hamburg', 'cologne', 'köln', 'düsseldorf', 'stuttgart'],
  'France':         ['france', 'paris', 'lyon', 'marseille'],
  'Netherlands':    ['netherlands', 'amsterdam', 'rotterdam', 'the hague', 'utrecht', 'eindhoven'],
  'UAE':            ['uae', 'united arab emirates', 'dubai', 'abu dhabi'],
  'Singapore':      ['singapore'],
  'Hong Kong':      ['hong kong'],
  'India':          ['india', 'mumbai', 'bangalore', 'bengaluru', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'hyderabad', 'pune', 'chennai', 'ahmedabad', 'noida'],
  'Australia':      ['australia', 'sydney', 'melbourne', 'brisbane', 'perth'],
  'Canada':         ['canada', 'toronto', 'vancouver', 'montreal', 'calgary'],
  'Spain':          ['spain', 'madrid', 'barcelona'],
  'Ireland':        ['ireland', 'dublin'],
}

const matchKw = (part: string, kw: string) =>
  kw.length <= 3 ? part === kw || part.split(/[\s/]+/).includes(kw) : part.includes(kw)

const locParts = (location: string) =>
  location.split(/[|,]/).map((l) => l.trim().toLowerCase()).filter(Boolean)

const jobInRegion = (job: JobPost, region: string) => {
  const kws = REGIONS[region]
  if (!kws || !job.location) return false
  return locParts(job.location).some((p) => kws.some((k) => matchKw(p, k)))
}

// Distinct location strings with counts, most frequent first
function locationStats(jobs: JobPost[]): { name: string; count: number }[] {
  const freq = new Map<string, { name: string; count: number }>()
  for (const j of jobs) {
    if (!j.location) continue
    for (const raw of j.location.split(/[|,]/)) {
      const name = raw.trim()
      if (!name || name.length >= 40) continue
      const key = name.toLowerCase()
      const cur = freq.get(key)
      if (cur) cur.count++
      else freq.set(key, { name, count: 1 })
    }
  }
  return [...freq.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function inferWorkType(job: JobPost): WorkType | null {
  const text = `${job.location || ''} ${job.tags?.join(' ') || ''} ${job.title || ''}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'Hybrid'
  if (/\bremote\b/.test(text)) return 'Remote'
  if (/\bon.?site\b|in.?office\b|in.?person\b/.test(text)) return 'On-site'
  return null
}

const toTime = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0)

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const isFresh = (iso?: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 86400000

const initials = (name: string) =>
  name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export default function HomePage() {
  const [dark, setDark] = useState(false)
  const [allJobs, setAllJobs] = useState<JobPost[]>(DEMO_JOBS)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [usingDemo, setUsingDemo] = useState(true)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [locQuery, setLocQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)  // mobile filter accordion
  const [nowTs, setNowTs] = useState<number | null>(null)  // null until mounted — avoids SSR hydration mismatch
  const searchRef = useRef<HTMLInputElement>(null)
  const prevSlotKey = useRef<string | null>(null)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      if (filters.sector !== 'all') params.set('sector', filters.sector)
      params.set('sortBy', filters.sortBy)
      params.set('limit', '5000')

      const res = await fetch(`/api/jobs?${params}`)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      if (data.jobs?.length > 0) {
        setAllJobs(data.jobs)
        setUsingDemo(false)
      } else {
        setAllJobs(DEMO_JOBS)
        setUsingDemo(true)
      }
      setLastUpdated(new Date())
    } catch {
      setAllJobs(DEMO_JOBS)
      setUsingDemo(true)
    } finally { setLoading(false) }
  }, [filters.search, filters.sector, filters.sortBy])

  // Debounced so typing in search doesn't fire a request per keystroke
  useEffect(() => {
    const t = setTimeout(fetchJobs, 250)
    return () => clearTimeout(t)
  }, [fetchJobs])

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load saved jobs from localStorage once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bcj-saved')
      if (raw) setSaved(new Set(JSON.parse(raw)))
    } catch { /* ignore corrupt/blocked storage */ }
  }, [])

  const persistSaved = (next: Set<string>) => {
    setSaved(next)
    try { localStorage.setItem('bcj-saved', JSON.stringify([...next])) } catch { /* storage unavailable */ }
  }

  const toggleSaved = (id: string) => {
    const next = new Set(saved)
    next.has(id) ? next.delete(id) : next.add(id)
    persistSaved(next)
  }

  const savedJobs = useMemo(() => allJobs.filter((j) => saved.has(j.id)), [allJobs, saved])

  // Jump to a saved job's card in the feed; reset filters first if they're hiding it
  const jumpToJob = (id: string) => {
    const visible = displayJobs.some((j) => j.id === id)
    if (!visible) setFilters(DEFAULT_FILTERS)
    setFiltersOpen(false)
    setHighlightId(id)
    setTimeout(() => {
      document.getElementById(`job-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, visible ? 0 : 150)
    setTimeout(() => setHighlightId(null), 1800)
  }

  // Press-time ticker: per-second near/inside a drop, minute-rounded otherwise
  // (minute-rounding makes setState a no-op between minutes, so no wasted re-renders)
  useEffect(() => {
    const update = () => {
      const t = Date.now()
      const { next, current } = dropsAround(t)
      const fine = !!current || (next !== null && next.start - t < 11 * 60_000)
      setNowTs(fine ? t : Math.floor(t / 60_000) * 60_000)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  // Auto-refresh the feed as each sector's slot completes during a drop
  useEffect(() => {
    if (nowTs == null) return
    const { current } = dropsAround(nowTs)
    const key = current
      ? `ing:${Math.min(Math.floor((nowTs - current.start) / SLOT_MS), current.sectors.length - 1)}`
      : 'idle'
    const prev = prevSlotKey.current
    prevSlotKey.current = key
    if (prev !== null && prev !== key && prev.startsWith('ing:')) fetchJobs()
  }, [nowTs, fetchJobs])

  type ClockPart = { v: string | number; u?: string }
  const press = useMemo((): { cls: string; barW: number | null; label: string; detail: string; clock: ClockPart[] } | null => {
    if (nowTs == null) return null
    const { prev, next, current } = dropsAround(nowTs)

    if (current) {
      const idx = Math.min(Math.floor((nowTs - current.start) / SLOT_MS), current.sectors.length - 1)
      const togo = current.sectors.length - 1 - idx
      return {
        cls: ' ingesting', barW: null, label: 'Fresh roles landing',
        detail: `${sectorLabel(current.sectors[idx])} is in · ${togo > 0 ? `${togo} more to come` : 'wrapping up'}`,
        clock: [{ v: 'ingesting…' }],
      }
    }
    if (!next) return null

    const remaining = next.start - nowTs
    const startsLocal = new Date(next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    if (remaining > 8 * 3_600_000) {
      const weekendGap = new Date(next.start).getUTCDay() === 1 && remaining > 20 * 3_600_000
      return {
        cls: ' far', barW: null, label: 'Next drop',
        detail: weekendGap ? 'the presses rest on weekends' : 'done for today',
        clock: [{ v: new Date(next.start).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }],
      }
    }

    const spanStart = prev ? prev.end : next.start - 12 * 3_600_000
    const barW = Math.round(Math.min(1, Math.max(0.02, (nowTs - spanStart) / (next.start - spanStart))) * 100)
    const h = Math.floor(remaining / 3_600_000)
    const m = Math.floor((remaining % 3_600_000) / 60_000)
    const s = Math.floor((remaining % 60_000) / 1000)

    if (remaining < 10 * 60_000) {
      return {
        cls: ' imminent', barW, label: 'Next drop',
        detail: `${startsLocal} · starting with ${sectorLabel(next.sectors[0])}`,
        clock: [{ v: m, u: 'm' }, { v: s, u: 's' }],
      }
    }
    const names = next.sectors.map(sectorLabel)
    return {
      cls: '', barW, label: 'Next drop',
      detail: `${startsLocal} · ${names[0]} first, then ${names.slice(1).join(', ')}`,
      clock: h > 0 ? [{ v: h, u: 'h' }, { v: m, u: 'm' }] : [{ v: m, u: 'm' }],
    }
  }, [nowTs])

  const displayJobs = useMemo(() => {
    const list = allJobs.filter((job) => {
      if (filters.locations.length > 0) {
        if (!job.location) return false
        const jobLocs = locParts(job.location)
        const ok = filters.locations.some((sel) => {
          if (REGIONS[sel]) return jobInRegion(job, sel)  // country/region selection
          const s = sel.toLowerCase()
          return jobLocs.some((jl) => jl.includes(s) || s.includes(jl))
        })
        if (!ok) return false
      }
      if (filters.workTypes.length > 0) {
        const wt = inferWorkType(job)
        if (!wt || !filters.workTypes.includes(wt)) return false
      }
      return true
    })
    // Client-side sort fallback (API also sorts; demo data needs it)
    return [...list].sort((a, b) => {
      const d = toTime(b.posted_at) - toTime(a.posted_at)
      return filters.sortBy === 'newest' ? d : -d
    })
  }, [allJobs, filters.locations, filters.workTypes, filters.sortBy])

  const sectorCounts = useMemo(() => ({
    all: allJobs.length,
    finance: allJobs.filter((j) => j.sector === 'finance').length,
    tech: allJobs.filter((j) => j.sector === 'tech').length,
    legal: allJobs.filter((j) => j.sector === 'legal').length,
    marketing: allJobs.filter((j) => j.sector === 'marketing').length,
    realestate: allJobs.filter((j) => j.sector === 'realestate').length,
  }), [allJobs])

  const locStats = useMemo(() => locationStats(allJobs), [allJobs])
  const availableLocations = useMemo(() => locStats.map((l) => l.name), [locStats])

  const regionCounts = useMemo(() =>
    Object.keys(REGIONS)
      .map((name) => ({ name, count: allJobs.filter((j) => jobInRegion(j, name)).length }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count),
    [allJobs])

  // City chips: selected ones always visible, then matches for the typed query
  // (or the most frequent cities when nothing is typed)
  const CITY_LIMIT = 12
  const visibleCities = useMemo(() => {
    const q = locQuery.trim().toLowerCase()
    const matches = q ? locStats.filter((l) => l.name.toLowerCase().includes(q)) : locStats
    const selected = locStats.filter((l) => filters.locations.includes(l.name))
    const rest = matches.filter((l) => !filters.locations.includes(l.name))
    return { shown: [...selected, ...rest.slice(0, CITY_LIMIT)], hidden: Math.max(0, rest.length - CITY_LIMIT) }
  }, [locStats, locQuery, filters.locations])
  const todayCount = useMemo(() => {
    const today = new Date().toDateString()
    return allJobs.filter((j) => j.extracted_at && new Date(j.extracted_at).toDateString() === today).length
  }, [allJobs])

  const anyFilter = filters.sector !== 'all' || filters.locations.length > 0 || filters.workTypes.length > 0 || filters.search !== ''
  const activeFilterCount = (filters.sector !== 'all' ? 1 : 0) + filters.workTypes.length + filters.locations.length

  const toggleWorkType = (wt: WorkType) => {
    const next = filters.workTypes.includes(wt)
      ? filters.workTypes.filter((w) => w !== wt)
      : [...filters.workTypes, wt]
    setFilters({ ...filters, workTypes: next })
  }

  const toggleLocation = (loc: string) => {
    const next = filters.locations.includes(loc)
      ? filters.locations.filter((l) => l !== loc)
      : [...filters.locations, loc]
    setFilters({ ...filters, locations: next })
  }

  const resetAll = () => setFilters(DEFAULT_FILTERS)

  return (
    <div className={`ulj${dark ? ' dark' : ''}`}>

      {/* ── Masthead ─────────────────────────── */}
      <header className="masthead">
        <div className="masthead-in">
          <a className="wordmark" href="/">backchannel<em>.jobs</em></a>

          <div className="search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input
              ref={searchRef}
              className="search"
              type="text"
              placeholder="Search roles, companies, skills…"
              autoComplete="off"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
            <span className="slash">/</span>
          </div>

          <div className="mast-actions">
            {usingDemo && <span className="demo-badge">Demo data</span>}

            <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode" title="Toggle dark mode">
              {dark
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>}
            </button>

            <button className={`refresh-btn${loading ? ' spinning' : ''}`} onClick={fetchJobs} disabled={loading}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
              <span>{loading ? 'Scanning…' : 'Refresh'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────── */}
      <section className="hero">
        <div>
          <h1>The jobs LinkedIn<br /><em>doesn&apos;t show you.</em></h1>
          <p className="sub">Roles recruiters post in the feed and never list — pulled from public posts, classified by AI, refreshed twice a day.</p>
        </div>
        <div className="stats">
          <div className="stat"><div className="num">{allJobs.length}</div><div className="lbl">Live roles</div></div>
          <div className="stat"><div className="num">{availableLocations.length}</div><div className="lbl">Locations</div></div>
          <div className="stat"><div className="num">{todayCount}</div><div className="lbl">Added today</div></div>
        </div>
      </section>

      <div className="layout">
        {/* ── Sidebar ─────────────────────────── */}
        <aside className={`filters${filtersOpen ? ' open' : ''}`}>
          {/* Mobile-only accordion header */}
          <button className="filters-head" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" /></svg>
            Filters
            {activeFilterCount > 0 && <span className="fbadge">{activeFilterCount}</span>}
            <svg className={`chev${filtersOpen ? ' up' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
          </button>

          {savedJobs.length > 0 && (
            <div className="fgroup">
              <div className="flabel">
                <span>Saved jobs</span>
                <button onClick={() => persistSaved(new Set())}>Clear</button>
              </div>
              <div className="saved-list">
                {savedJobs.map((j) => (
                  <button key={j.id} className="saved-link" onClick={() => jumpToJob(j.id)} title={j.title}>
                    <span className="star">★</span><span className="t">{j.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="fgroup">
            <div className="flabel"><span>Sector</span></div>
            {SECTORS.map((s) => {
              const active = filters.sector === s.id
              const count = sectorCounts[s.id as keyof typeof sectorCounts] ?? 0
              return (
                <button
                  key={s.id}
                  className={`sector-row${active ? ' active' : ''}`}
                  style={{ ['--dot' as string]: s.id === 'all' ? 'var(--ink-3)' : `var(--sec-${s.id})` }}
                  onClick={() => setFilters({ ...filters, sector: s.id })}
                >
                  <span className="dot" />{s.label}<span className="cnt">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="fgroup">
            <div className="flabel">
              <span>Work type</span>
              {filters.workTypes.length > 0 && <button onClick={() => setFilters({ ...filters, workTypes: [] })}>Clear</button>}
            </div>
            {WORK_TYPES.map((wt) => {
              const on = filters.workTypes.includes(wt)
              return (
                <button key={wt} className={`check-row${on ? ' on' : ''}`} onClick={() => toggleWorkType(wt)}>
                  <span className="box">{on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4"><path d="M20 6 9 17l-5-5" /></svg>}</span>
                  {wt}
                </button>
              )
            })}
          </div>

          <div className="fgroup">
            <div className="flabel">
              <span>Location</span>
              {filters.locations.length > 0 && <button onClick={() => setFilters({ ...filters, locations: [] })}>Clear</button>}
            </div>

            {regionCounts.length > 0 && (
              <div className="chips regions">
                {regionCounts.map((r) => (
                  <button key={r.name} className={`chip${filters.locations.includes(r.name) ? ' on' : ''}`} onClick={() => toggleLocation(r.name)}>
                    {r.name}<span className="n">{r.count}</span>
                  </button>
                ))}
              </div>
            )}

            <input
              className="loc-search"
              type="text"
              placeholder="Search cities…"
              value={locQuery}
              onChange={(e) => setLocQuery(e.target.value)}
            />
            <div className="chips">
              {visibleCities.shown.map((l) => (
                <button key={l.name} className={`chip${filters.locations.includes(l.name) ? ' on' : ''}`} onClick={() => toggleLocation(l.name)}>
                  {l.name}
                </button>
              ))}
            </div>
            {visibleCities.hidden > 0 && (
              <p className="more-note">+{visibleCities.hidden} more — type to search</p>
            )}
          </div>

          <p className="side-note">Sourced from public posts. Always verify details with the recruiter before applying.</p>
        </aside>

        {/* ── Feed ────────────────────────────── */}
        <main>
          <div className="feed-bar">
            <span className="count">
              <b>{displayJobs.length}</b> {displayJobs.length === 1 ? 'role' : 'roles'}
              {filters.sector !== 'all' && ` in ${sectorLabel(filters.sector)}`}
            </span>
            {anyFilter && <button className="clear" onClick={resetAll}>Reset filters</button>}
            <div className="sort-wrap">
              <select value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'newest' | 'oldest' })}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>

          {press && (
            <div className={`press${press.cls}`}>
              {press.barW !== null && <div className="bar" style={{ width: `${press.barW}%` }} />}
              {press.cls === ' ingesting' && <div className="bar shimmer" />}
              <span className="pdot" />
              <span className="plabel">{press.label}</span>
              <span className="pdetail">{press.detail}</span>
              <span className="pclock">
                {press.clock.map((p, i) => <span key={i}>{p.v}{p.u && <span className="unit">{p.u}</span>}</span>)}
              </span>
            </div>
          )}

          {loading ? (
            <div className="cards">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton" />)}
            </div>
          ) : displayJobs.length === 0 ? (
            <div className="empty">
              <h3>Nothing matches those filters.</h3>
              <p>Try widening the sector, location, or work-type selection.</p>
              <button onClick={resetAll}>Reset all filters</button>
            </div>
          ) : (
            <div className="cards">
              {displayJobs.map((job) => {
                const wt = inferWorkType(job)
                return (
                  <article key={job.id} id={`job-${job.id}`} className={`card${highlightId === job.id ? ' flash' : ''}`} style={{ ['--sec' as string]: `var(--sec-${job.sector}, var(--ink-3))` }}>
                    <div className="card-top">
                      <span className="sec-tag"><span className="dot" />{sectorLabel(job.sector)}</span>
                      {job.is_verified_job && (
                        <span className="verified">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M20 6 9 17l-5-5" /></svg>
                          Verified post
                        </span>
                      )}
                      {job.posted_at && <span className={`ago${isFresh(job.posted_at) ? ' fresh' : ''}`}>{timeAgo(job.posted_at)}</span>}
                    </div>

                    <h3><a href={job.post_url} target="_blank" rel="noopener noreferrer">{job.title}</a></h3>
                    <p className="meta">
                      <b>{job.company}</b>
                      {job.location && <><span className="sep">·</span>{job.location}</>}
                      {wt && wt.toLowerCase() !== job.location?.trim().toLowerCase() && <><span className="sep">·</span>{wt}</>}
                      {job.seniority && job.seniority !== 'Unknown' && <><span className="sep">·</span>{job.seniority}</>}
                    </p>
                    {job.summary && <p className="summary">{job.summary}</p>}
                    {(job.salary || job.apply_method) && (
                      <p className="salary">
                        {job.salary}
                        {job.apply_method && <span className="via">via: {job.apply_method}</span>}
                      </p>
                    )}

                    <div className="card-foot">
                      <span className="avatar">{initials(job.author_name || '?')}</span>
                      <span className="author">
                        {job.author_linkedin_url && job.author_linkedin_url !== '#'
                          ? <a href={job.author_linkedin_url} target="_blank" rel="noopener noreferrer"><b>{job.author_name}</b></a>
                          : <b>{job.author_name}</b>}
                        {job.author_headline && <> · {job.author_headline}</>}
                      </span>
                      <div className="card-actions">
                        <button className={`ghost-btn${saved.has(job.id) ? ' saved' : ''}`} onClick={() => toggleSaved(job.id)}>
                          {saved.has(job.id) ? '★ Saved' : '☆ Save'}
                        </button>
                        <a className="apply-btn" href={job.post_url} target="_blank" rel="noopener noreferrer">
                          View post
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17 17 7M7 7h10v10" /></svg>
                        </a>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <footer className="colophon">
            <span>Sourced from public LinkedIn posts · AI-classified · backchannel.jobs © {new Date().getFullYear()}</span>
            {lastUpdated && <span className="mono">Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </footer>
        </main>
      </div>

      <style>{`
        /* Roman only, no italic file — the em italics render as a synthetic slant
           of the roman, which is calmer than Fraunces' real (very calligraphic) italic. */
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500;600&display=swap');

        .ulj {
          /* light theme */
          --page:      #F5F2EB;
          --surface:   #FDFCFA;
          --surface-2: #F0ECE2;
          --ink:       #191713;
          --ink-2:     #5C574D;
          --ink-3:     #97907E;
          --hairline:  #E4DFD2;
          --hairline-2:#D8D2C2;
          --live:      #0A7A3D;
          --shadow:    0 1px 2px rgba(25,23,19,0.05), 0 6px 20px -8px rgba(25,23,19,0.09);
          --shadow-lift: 0 2px 4px rgba(25,23,19,0.06), 0 14px 34px -10px rgba(25,23,19,0.16);
          --sec-finance:   #008300;
          --sec-tech:      #2a78d6;
          --sec-legal:     #eda100;
          --sec-marketing: #e87ba4;
          --sec-realestate:#4a3aa7;
        }
        .ulj.dark {
          --page:      #131210;
          --surface:   #1C1A17;
          --surface-2: #26231F;
          --ink:       #F2EFE7;
          --ink-2:     #A9A293;
          --ink-3:     #6E6857;
          --hairline:  #2C2924;
          --hairline-2:#3A362F;
          --live:      #2FA36A;
          --shadow:    0 1px 2px rgba(0,0,0,0.3);
          --shadow-lift: 0 10px 30px -8px rgba(0,0,0,0.5);
          --sec-finance:   #008300;
          --sec-tech:      #3987e5;
          --sec-legal:     #c98500;
          --sec-marketing: #d55181;
          --sec-realestate:#b3a7f2;
        }

        .ulj, .ulj * { box-sizing: border-box; margin: 0; }
        .ulj {
          min-height: 100vh;
          background: var(--page);
          color: var(--ink);
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          transition: background .25s, color .25s;
          -webkit-font-smoothing: antialiased;
        }
        .ulj .mono { font-family: 'Spline Sans Mono', ui-monospace, monospace; }
        .ulj button { font-family: inherit; }

        /* ── Masthead ── */
        .ulj .masthead {
          position: sticky; top: 0; z-index: 50;
          background: color-mix(in srgb, var(--page) 88%, transparent);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--hairline);
        }
        .ulj .masthead-in {
          max-width: 1200px; margin: 0 auto; padding: 0 28px;
          height: 60px; display: flex; align-items: center; gap: 20px;
        }
        .ulj .wordmark {
          font-family: 'Fraunces', Georgia, serif; font-size: 21px; font-weight: 600;
          letter-spacing: -0.02em; white-space: nowrap; text-decoration: none; color: var(--ink);
        }
        .ulj .wordmark em { font-style: italic; font-weight: 400; color: var(--ink-2); }
        .ulj .search-wrap { flex: 1; max-width: 460px; position: relative; margin: 0 auto; }
        .ulj .search-wrap > svg { position: absolute; left: 13px; top: 50%; translate: 0 -50%; color: var(--ink-3); pointer-events: none; }
        .ulj .slash {
          position: absolute; right: 10px; top: 50%; translate: 0 -50%;
          font-size: 11px; color: var(--ink-3); border: 1px solid var(--hairline-2);
          border-radius: 5px; padding: 1px 6px; background: var(--surface);
        }
        .ulj .search {
          width: 100%; height: 38px; padding: 0 40px 0 36px;
          background: var(--surface); color: var(--ink);
          border: 1px solid var(--hairline-2); border-radius: 10px;
          font: 500 13.5px 'Inter', sans-serif; outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .ulj .search::placeholder { color: var(--ink-3); }
        .ulj .search:focus { border-color: var(--ink-2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 8%, transparent); }
        .ulj .mast-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
        .ulj .demo-badge {
          font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
          color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--hairline-2);
          padding: 4px 9px; border-radius: 6px; white-space: nowrap;
        }
        @keyframes ulj-pulse { 50% { opacity: .35; } }
        .ulj .icon-btn {
          width: 36px; height: 36px; display: grid; place-items: center;
          background: var(--surface); border: 1px solid var(--hairline-2);
          border-radius: 10px; color: var(--ink-2); cursor: pointer; transition: .15s;
        }
        .ulj .icon-btn:hover { color: var(--ink); border-color: var(--ink-3); }
        .ulj .refresh-btn {
          height: 36px; padding: 0 16px; display: flex; align-items: center; gap: 8px;
          background: var(--ink); color: var(--page); border: none; border-radius: 10px;
          font: 600 12.5px 'Inter', sans-serif; cursor: pointer; transition: opacity .15s;
        }
        .ulj .refresh-btn:hover { opacity: .85; }
        .ulj .refresh-btn:disabled { cursor: not-allowed; opacity: .7; }
        .ulj .refresh-btn.spinning svg { animation: ulj-spin 0.9s linear infinite; }
        @keyframes ulj-spin { to { transform: rotate(360deg); } }

        /* ── Hero ── */
        .ulj .hero { max-width: 1200px; margin: 0 auto; padding: 44px 28px 30px; display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
        .ulj .hero h1 {
          font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(28px, 4vw, 40px);
          line-height: 1.12; letter-spacing: -0.015em; max-width: 560px;
        }
        .ulj .hero h1 em { font-style: italic; }
        .ulj .hero .sub { margin-top: 10px; font-size: 14px; color: var(--ink-2); max-width: 480px; }
        .ulj .stats { display: flex; }
        .ulj .stat { padding: 0 26px; border-left: 1px solid var(--hairline-2); }
        .ulj .stat:first-child { border-left: none; padding-left: 0; }
        .ulj .stat .num { font-family: 'Fraunces', Georgia, serif; font-size: 34px; font-weight: 500; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
        .ulj .stat .lbl { margin-top: 6px; font-size: 10.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3); }

        /* ── Layout ── */
        .ulj .layout { max-width: 1200px; margin: 0 auto; padding: 8px 28px 60px; display: grid; grid-template-columns: 218px 1fr; gap: 40px; align-items: start; }
        .ulj .layout > * { min-width: 0; }  /* let grid children shrink below content width */

        /* ── Sidebar ── */
        .ulj .filters { position: sticky; top: 84px; display: flex; flex-direction: column; gap: 26px; padding-top: 8px; }
        .ulj .flabel {
          font-size: 10.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
          color: var(--ink-3); padding-bottom: 10px; margin-bottom: 4px; border-bottom: 1px solid var(--hairline);
          display: flex; justify-content: space-between; align-items: baseline;
        }
        .ulj .flabel button { font-size: 10px; letter-spacing: 0; text-transform: none; background: none; border: none; color: var(--ink-3); cursor: pointer; padding: 0; }
        .ulj .flabel button:hover { color: var(--ink); text-decoration: underline; }
        .ulj .sector-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; margin: 1px -10px; width: calc(100% + 20px);
          background: none; border: none; border-radius: 8px;
          font: 500 13.5px 'Inter', sans-serif; color: var(--ink-2);
          cursor: pointer; text-align: left; transition: .12s;
        }
        .ulj .sector-row:hover { background: var(--surface-2); color: var(--ink); }
        .ulj .sector-row.active { background: var(--ink); color: var(--page); font-weight: 600; }
        .ulj .sector-row .dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; background: var(--dot, var(--ink-3)); }
        .ulj .sector-row.active .dot { outline: 2px solid color-mix(in srgb, var(--page) 45%, transparent); }
        .ulj .sector-row .cnt { margin-left: auto; font: 500 11.5px 'Spline Sans Mono', monospace; color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .ulj .sector-row.active .cnt { color: color-mix(in srgb, var(--page) 75%, transparent); }
        .ulj .check-row {
          display: flex; align-items: center; gap: 10px; padding: 7px 0;
          background: none; border: none; width: 100%; cursor: pointer; text-align: left;
          font: 500 13.5px 'Inter', sans-serif; color: var(--ink-2); transition: color .12s;
        }
        .ulj .check-row:hover { color: var(--ink); }
        .ulj .check-row .box {
          width: 16px; height: 16px; border-radius: 5px; flex-shrink: 0;
          border: 1.5px solid var(--hairline-2); background: var(--surface);
          display: grid; place-items: center; transition: .12s; color: var(--page);
        }
        .ulj .check-row.on { color: var(--ink); }
        .ulj .check-row.on .box { background: var(--ink); border-color: var(--ink); }
        .ulj .chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 4px; }
        .ulj .chip {
          padding: 5px 11px; border-radius: 999px; cursor: pointer;
          background: var(--surface); border: 1px solid var(--hairline-2);
          font: 500 12px 'Inter', sans-serif; color: var(--ink-2); transition: .12s;
        }
        .ulj .chip:hover { border-color: var(--ink-3); color: var(--ink); }
        .ulj .chip.on { background: var(--ink); border-color: var(--ink); color: var(--page); }
        .ulj .chip .n { margin-left: 6px; font: 500 10.5px 'Spline Sans Mono', monospace; color: var(--ink-3); }
        .ulj .chip.on .n { color: color-mix(in srgb, var(--page) 70%, transparent); }
        .ulj .chips.regions { padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--hairline); }
        .ulj .loc-search {
          width: 100%; height: 30px; padding: 0 10px; margin-bottom: 8px;
          background: var(--surface); color: var(--ink);
          border: 1px solid var(--hairline-2); border-radius: 8px;
          font: 500 12px 'Inter', sans-serif; outline: none;
        }
        .ulj .loc-search::placeholder { color: var(--ink-3); }
        .ulj .loc-search:focus { border-color: var(--ink-2); }
        .ulj .more-note { margin-top: 8px; font-size: 11px; color: var(--ink-3); }
        .ulj .side-note { font-size: 11.5px; color: var(--ink-3); line-height: 1.55; padding-top: 4px; }
        .ulj .saved-list { display: flex; flex-direction: column; gap: 2px; }
        .ulj .saved-link {
          display: flex; align-items: baseline; gap: 8px; width: 100%;
          padding: 6px 0; background: none; border: none; cursor: pointer; text-align: left;
          font: 500 12.5px 'Inter', sans-serif; color: var(--ink-2); transition: color .12s;
        }
        .ulj .saved-link:hover { color: var(--ink); }
        .ulj .saved-link .star { color: var(--live); font-size: 11px; flex-shrink: 0; }
        .ulj .saved-link .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .card.flash { border-color: var(--live); box-shadow: 0 0 0 3px color-mix(in srgb, var(--live) 20%, transparent); }

        /* ── Feed ── */
        .ulj .feed-bar { display: flex; align-items: baseline; gap: 14px; padding: 8px 0 16px; }
        .ulj .feed-bar .count { font-family: 'Fraunces', Georgia, serif; font-size: 17px; font-weight: 500; }
        .ulj .feed-bar .count b { font-variant-numeric: tabular-nums; }
        .ulj .feed-bar .clear { font-size: 12px; color: var(--ink-2); background: none; border: none; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; padding: 0; }
        .ulj .feed-bar .clear:hover { color: var(--ink); }
        .ulj .sort-wrap { margin-left: auto; }
        .ulj select {
          height: 32px; padding: 0 10px; background: var(--surface); color: var(--ink-2);
          border: 1px solid var(--hairline-2); border-radius: 8px; font: 500 12.5px 'Inter', sans-serif;
          outline: none; cursor: pointer;
        }

        /* ── Press-time strip ── */
        .ulj .press {
          position: relative; overflow: hidden;
          display: flex; align-items: center; gap: 10px;
          background: var(--surface); border: 1px solid var(--hairline);
          border-radius: 11px; padding: 11px 16px; margin-bottom: 14px;
          box-shadow: var(--shadow); font-size: 12.5px; color: var(--ink-2);
        }
        .ulj .press .bar {
          position: absolute; left: 0; top: 0; bottom: 0;
          background: var(--surface-2); border-right: 1px solid var(--hairline-2);
        }
        .ulj .press .bar.shimmer {
          width: 100%; border-right: none;
          background: linear-gradient(100deg, var(--surface-2) 40%, var(--surface) 50%, var(--surface-2) 60%);
          background-size: 200% 100%; animation: ulj-shimmer 1.6s infinite;
        }
        .ulj .press > *:not(.bar) { position: relative; z-index: 1; }
        .ulj .press .pdot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); animation: ulj-pulse 2.2s infinite; flex-shrink: 0; }
        .ulj .press.far .pdot { animation: none; opacity: .5; }
        .ulj .press .plabel { font-weight: 600; color: var(--ink); white-space: nowrap; }
        .ulj .press .pdetail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .press .pclock { margin-left: auto; font: 600 13px 'Spline Sans Mono', monospace; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .ulj .press .pclock .unit { font-weight: 400; color: var(--ink-3); font-size: 11px; margin: 0 5px 0 1px; }
        .ulj .press.imminent .pclock { color: var(--live); }
        .ulj .press.ingesting .pclock { color: var(--live); font-size: 12px; }
        .ulj .press.far .pclock { font-size: 12px; }

        .ulj .cards { display: flex; flex-direction: column; gap: 14px; }
        .ulj .skeleton {
          height: 190px; border-radius: 14px; border: 1px solid var(--hairline);
          background: linear-gradient(100deg, var(--surface) 40%, var(--surface-2) 50%, var(--surface) 60%);
          background-size: 200% 100%; animation: ulj-shimmer 1.4s infinite;
        }
        @keyframes ulj-shimmer { to { background-position: -200% 0; } }
        .ulj .card {
          position: relative; background: var(--surface); border: 1px solid var(--hairline);
          border-radius: 14px; padding: 20px 24px 0 24px; box-shadow: var(--shadow);
          transition: box-shadow .18s, translate .18s, border-color .18s;
          overflow: hidden;
        }
        .ulj .card::before {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: var(--sec, var(--ink-3));
        }
        .ulj .card:hover { box-shadow: var(--shadow-lift); translate: 0 -2px; border-color: var(--hairline-2); }
        .ulj .card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .ulj .sec-tag { display: inline-flex; align-items: center; gap: 7px; font-size: 10.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-2); }
        .ulj .sec-tag .dot { width: 8px; height: 8px; border-radius: 3px; background: var(--sec); }
        .ulj .verified { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ink-3); }
        .ulj .verified svg { color: var(--live); }
        .ulj .ago { margin-left: auto; font: 500 11.5px 'Spline Sans Mono', monospace; color: var(--ink-3); }
        .ulj .ago.fresh { color: var(--live); }
        .ulj .card h3 { font-family: 'Fraunces', Georgia, serif; font-size: 20px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.25; }
        .ulj .card h3 a { color: inherit; text-decoration: none; }
        .ulj .card h3 a:hover { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
        .ulj .meta { margin-top: 5px; font-size: 13px; color: var(--ink-2); }
        .ulj .meta b { color: var(--ink); font-weight: 600; }
        .ulj .meta .sep { margin: 0 7px; color: var(--ink-3); }
        .ulj .summary { margin-top: 10px; font-size: 13.5px; color: var(--ink-2); max-width: 640px; }
        .ulj .salary { margin-top: 12px; font: 600 14px 'Spline Sans Mono', monospace; color: var(--ink); }
        .ulj .salary .via { font: 500 11.5px 'Inter', sans-serif; color: var(--ink-3); margin-left: 10px; }
        .ulj .card-foot {
          margin: 16px -24px 0; padding: 12px 24px 14px 24px;
          border-top: 1px solid var(--hairline);
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        }
        .ulj .avatar {
          width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
          background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--hairline-2);
          display: grid; place-items: center; font: 600 10px 'Inter', sans-serif;
        }
        .ulj .author { font-size: 12px; color: var(--ink-2); line-height: 1.3; }
        .ulj .author b { color: var(--ink); font-weight: 600; }
        .ulj .author a { color: inherit; text-decoration: none; }
        .ulj .author a:hover { text-decoration: underline; }
        .ulj .card-actions { margin-left: auto; display: flex; gap: 8px; }
        .ulj .ghost-btn {
          height: 30px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px;
          background: none; border: 1px solid var(--hairline-2); border-radius: 8px;
          font: 600 12px 'Inter', sans-serif; color: var(--ink-2); cursor: pointer; transition: .12s;
        }
        .ulj .ghost-btn:hover { color: var(--ink); border-color: var(--ink-3); }
        .ulj .ghost-btn.saved { color: var(--live); border-color: var(--live); }
        .ulj .apply-btn {
          height: 30px; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px;
          background: var(--ink); color: var(--page); border: none; border-radius: 8px;
          font: 600 12px 'Inter', sans-serif; cursor: pointer; text-decoration: none;
        }
        .ulj .apply-btn:hover { opacity: .85; }

        .ulj .empty {
          background: var(--surface); border: 1px dashed var(--hairline-2); border-radius: 16px;
          padding: 64px 24px; text-align: center;
        }
        .ulj .empty h3 { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 500; }
        .ulj .empty p { margin: 8px 0 20px; color: var(--ink-2); font-size: 13.5px; }
        .ulj .empty button {
          padding: 9px 18px; background: var(--ink); color: var(--page); border: none;
          border-radius: 9px; font: 600 13px 'Inter', sans-serif; cursor: pointer;
        }

        .ulj .colophon {
          margin-top: 40px; padding-top: 22px;
          border-top: 1px solid var(--hairline);
          display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          font-size: 11.5px; color: var(--ink-3);
        }

        /* Mobile filters accordion header — hidden on desktop */
        .ulj .filters-head { display: none; }
        .ulj .fbadge {
          min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px;
          background: var(--ink); color: var(--page);
          font: 600 10.5px 'Spline Sans Mono', monospace;
          display: inline-grid; place-items: center;
        }

        /* ── Tablet & below: single column, collapsible filters ── */
        @media (max-width: 900px) {
          .ulj .layout { grid-template-columns: 1fr; gap: 16px; }
          .ulj .filters { position: static; padding-top: 0; gap: 0; }
          .ulj .filters-head {
            display: flex; align-items: center; gap: 8px; width: 100%;
            padding: 11px 14px; background: var(--surface);
            border: 1px solid var(--hairline-2); border-radius: 10px;
            font: 600 13px 'Inter', sans-serif; color: var(--ink); cursor: pointer;
          }
          .ulj .filters-head .chev { margin-left: auto; transition: transform .15s; }
          .ulj .filters-head .chev.up { transform: rotate(180deg); }
          .ulj .filters .fgroup, .ulj .filters .side-note { display: none; }
          .ulj .filters.open .fgroup { display: block; margin-top: 18px; }
          .ulj .filters.open .side-note { display: block; margin-top: 14px; }
          .ulj .stats { width: 100%; justify-content: space-between; }
        }

        /* ── Phones: wrap masthead, compress hero & feed ── */
        @media (max-width: 760px) {
          .ulj .masthead-in {
            flex-wrap: wrap; height: auto; padding: 10px 16px; gap: 10px; row-gap: 10px;
          }
          .ulj .search-wrap { order: 3; flex-basis: 100%; max-width: none; }
          .ulj .slash { display: none; }
          .ulj .refresh-btn { width: 36px; padding: 0; justify-content: center; }
          .ulj .refresh-btn span { display: none; }  /* icon-only so the top row fits one line */
          .ulj .hero { padding: 26px 16px 16px; gap: 18px; }
          .ulj .hero .sub { font-size: 13px; }
          .ulj .stat { padding: 0 12px; }
          .ulj .stat .num { font-size: 24px; }
          .ulj .stat .lbl { font-size: 9.5px; }
          .ulj .layout { padding: 4px 16px 40px; }
          .ulj .chip { padding: 7px 13px; }  /* bigger tap targets */
        }

        /* ── Small phones: tighter cards ── */
        @media (max-width: 640px) {
          .ulj .feed-bar { flex-wrap: wrap; row-gap: 8px; }
          .ulj .card { padding: 15px 16px 0; border-radius: 12px; }
          .ulj .card h3 { font-size: 17.5px; }
          .ulj .meta { font-size: 12.5px; }
          .ulj .summary { font-size: 13px; }
          .ulj .card-foot { margin: 14px -16px 0; padding: 10px 12px 12px 16px; flex-wrap: nowrap; }
          .ulj .author { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .ulj .card-actions { flex-shrink: 0; }
          .ulj .ghost-btn { padding: 0 10px; }
          .ulj .apply-btn { padding: 0 11px; }
          .ulj .colophon { flex-direction: column; gap: 4px; }
        }
      `}</style>
    </div>
  )
}
