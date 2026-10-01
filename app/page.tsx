'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Analytics } from '@vercel/analytics/next'
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

// Free visitors see a role only after it is this old; a pass sees it the moment it lands.
// The cutoff itself is enforced server-side in /api/jobs, so keep that in sync with this value.
const FREE_DELAY_HOURS = 48

// POST endpoint that creates the Stripe Checkout session and returns { url }
// (app/api/stripe/checkout/route.ts)
const CHECKOUT_ENDPOINT = '/api/stripe/checkout'

// JobPost.sector is a plain string in the API payload, so accept any string
const PIPELINE_LABELS: Record<string, string> = {
  hashtags: 'Fresh roles',
  recruiters: 'Recruiter posts',
}
const sectorLabel = (s: string) =>
  PIPELINE_LABELS[s] ??
  SECTORS.find((x) => x.id === s)?.label ??
  (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other')

// ── Drop schedule (UTC) — mirrors the crons in vercel.json ──
const DROP_SECTORS_FULL = ['finance', 'tech', 'legal', 'marketing', 'realestate']
type DropBatch = { days: number[]; utcHour: number; utcMin: number; sectors: string[] }
// Fallback only — the live schedule comes from /api/schedule, derived from vercel.json
const DROP_BATCHES_FALLBACK: DropBatch[] = [
  { days: [1, 2, 3, 4, 5], utcHour: 13, utcMin: 0, sectors: DROP_SECTORS_FULL },
]
const SLOT_MS = 10 * 60_000  // sectors fire 10 minutes apart
const TAIL_MS = 5 * 60_000   // grace period after the last sector's slot

type Drop = { start: number; end: number; sectors: string[] }

function dropsAround(now: number, dropBatches: DropBatch[]): { prev: Drop | null; next: Drop | null; current: Drop | null } {
  const drops: Drop[] = []
  const base = new Date(now)
  for (let d = -8; d <= 8; d++) {
    const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + d))
    for (const b of dropBatches) {
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

const REGION_NAMES_LC = new Set(Object.keys(REGIONS).map((k) => k.toLowerCase()))

// Word-boundary keyword matching: "bern" must appear as a whole word, so it
// matches "Bern" and "bern, switzerland" but NOT "Abernathy"; "india" must not
// match "Indianapolis". Boundaries are any non-letter/non-digit (unicode-aware).
const kwRegexCache = new Map<string, RegExp>()
const matchKw = (part: string, kw: string) => {
  let re = kwRegexCache.get(kw)
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, 'u')
    kwRegexCache.set(kw, re)
  }
  return re.test(part)
}

// Split compound locations into atomic parts: "New York / London" → two cities,
// "Remote (Texas)" → remote + texas. Splits on | , / and parentheses.
const locParts = (location: string) =>
  location.replace(/[()]/g, ',').split(/[|,/]/).map((l) => l.trim().toLowerCase()).filter(Boolean)

// Tokens that are work arrangements, not places — never shown as city chips
const CITY_STOP = new Set(['hybrid', 'on-site', 'onsite', 'on site', 'office', 'flexible', 'wfh'])

const jobInRegion = (job: JobPost, region: string) => {
  const kws = REGIONS[region]
  if (!kws || !job.location) return false
  return locParts(job.location).some((p) => kws.some((k) => matchKw(p, k)))
}

function inferWorkType(job: JobPost): WorkType | null {
  const text = `${job.location || ''} ${job.tags?.join(' ') || ''} ${job.title || ''}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'Hybrid'
  if (/\bremote\b/.test(text)) return 'Remote'
  if (/\bon.?site\b|in.?office\b|in.?person\b/.test(text)) return 'On-site'
  return null
}

// A role the free tier can see only as a title; everything else stays on the server.
type LockedJob = { title: string; sector: string; posted_at: string | null }

const toTime = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0)

// Search shorthand -> phrases people actually write in titles (keep in sync with the jobs route)
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

// Edit distance (insert / delete / substitute / swap-adjacent), giving up above `max`.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev2: number[] = []
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2.length = 0
    prev2.push(...prev)
    prev = cur
  }
  return prev[b.length]
}

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

const HOW_STEPS = [
  { t: 'We monitor recruiter posts', d: 'AI tracks public posts from hiring managers, recruiters and talent teams.' },
  { t: 'We pick out real roles', d: 'Genuine openings, not generic career content.' },
  { t: 'You see them first', d: 'Roles land here before the job boards.' },
]

const BoltIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" /></svg>
)
const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
)

export default function HomePage() {
  const [dark, setDark] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)   // false until we know whether a session exists
  const [firstLoad, setFirstLoad] = useState(false)        // true once the first /api/jobs response has landed
  const [passExpires, setPassExpires] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const acctRef = useRef<HTMLDivElement>(null)
  // close the account menu on any outside click/tap or Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (acctRef.current && !acctRef.current.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState(false)
  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)).catch(() => {}).finally(() => setAuthChecked(true))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setUserEmail(s?.user?.email ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])
  const signOut = async () => {
    try { await createClient().auth.signOut() } catch {}
    window.location.reload()
  }
  const [rawJobs, setAllJobs] = useState<JobPost[]>([])   // everything the API sent this visitor
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)

  // Search runs in the browser over the loaded roles, so results and suggestions appear instantly
  // (no request per keystroke). The API only ever sends roles this visitor may see, so gating is unaffected.
  const searchIndex = useMemo(() => rawJobs.map((j) => ({
    hay: `${j.title ?? ''} ${j.company ?? ''} ${j.summary ?? ''}`.toLowerCase(),
    tags: new Set((Array.isArray(j.tags) ? j.tags : []).map((t: string) => String(t).toLowerCase())),
  })), [rawJobs])
  // Words that appear in titles, companies and tags: the pool we correct misspellings against
  const vocab = useMemo(() => {
    const m = new Map<string, number>()
    for (const j of rawJobs) {
      const words = `${j.title ?? ''} ${j.company ?? ''} ${Array.isArray(j.tags) ? j.tags.join(' ') : ''}`.toLowerCase().split(/[^a-z0-9+#]+/)
      for (const w of words) if (w.length >= 4) m.set(w, (m.get(w) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [rawJobs])

  // Per typed word: what to look for, and whether we silently fixed a likely typo
  const searchTerms = useMemo(() => {
    const tokens = filters.search.toLowerCase().replace(/[,()%*\\"]/g, ' ').split(/\s+/).filter(Boolean)
    return tokens.map((tok) => {
      const known = SEARCH_SYNONYMS[tok]
      if (known) return { tok, phrases: known, fixed: null as string | null }
      // Only try to correct whole-looking words that match nothing as typed
      if (tok.length >= 5 && rawJobs.length > 0 && !searchIndex.some((s) => s.hay.includes(tok))) {
        const max = tok.length >= 8 ? 2 : 1
        const close = vocab
          .map(([w, n]) => ({ w, n, d: editDistance(tok, w, max) }))
          .filter((x) => x.d <= max)
          .sort((x, y) => x.d - y.d || y.n - x.n)
          .slice(0, 3)
        if (close.length > 0) return { tok, phrases: close.map((x) => x.w), fixed: close[0].w }
      }
      return { tok, phrases: [tok], fixed: null as string | null }
    })
  }, [filters.search, rawJobs, searchIndex, vocab])
  const searchFixes = searchTerms.filter((t) => t.fixed)

  const allJobs = useMemo(() => {
    if (searchTerms.length === 0) return rawJobs
    return rawJobs.filter((_, i) => {
      const { hay, tags } = searchIndex[i]
      return searchTerms.every(({ tok, phrases }) => tags.has(tok) || phrases.some((ph) => hay.includes(ph)))
    })
  }, [rawJobs, searchIndex, searchTerms])
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(150)
  const [hasPass, setHasPass] = useState(false)
  const [withheld, setWithheld] = useState(0)
  const [addedToday, setAddedToday] = useState(0)
  const [previewCount, setPreviewCount] = useState(0)
  const [previewIds, setPreviewIds] = useState<string[]>([])
  const [lockedJobs, setLockedJobs] = useState<LockedJob[]>([])
  const [dropBatches, setDropBatches] = useState<DropBatch[]>(DROP_BATCHES_FALLBACK)
  useEffect(() => {
    fetch('/api/schedule')
      .then((r) => r.json())
      .then((d) => { if (d.drops?.length) setDropBatches(d.drops) })
      .catch(() => {})
  }, [])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [locQuery, setLocQuery] = useState('')
  const [cityExpanded, setCityExpanded] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)  // mobile filter accordion
  const [nowTs, setNowTs] = useState<number | null>(null)  // null until mounted — avoids SSR hydration mismatch
  const visitorId = useRef<string | null>(null)
  useEffect(() => {
    try {
      let id = localStorage.getItem('bcj_vid')
      if (!id) { id = crypto.randomUUID(); localStorage.setItem('bcj_vid', id) }
      visitorId.current = id
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: id, referrer: document.referrer }),
      }).catch(() => {})
    } catch { /* storage blocked */ }
  }, [])

  const searchRef = useRef<HTMLInputElement>(null)
  const prevSlotKey = useRef<string | null>(null)

  const fetchSeq = useRef(0)  // only the newest request may write results (older, slower ones are dropped)
  const fetchJobs = useCallback(async () => {
    const seq = ++fetchSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      // NOTE: sector is deliberately NOT sent to the API — it's filtered client-side
      // so the sidebar counts always reflect the full dataset.
      params.set('sortBy', filters.sortBy)
      params.set('limit', '20000')

      // Stage 1: a small page so the feed and stats paint immediately.
      const fast = new URLSearchParams(params)
      fast.set('limit', '400')
      const res = await fetch(`/api/jobs?${fast}`)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      if (seq !== fetchSeq.current) return

      setAllJobs(data.jobs ?? [])
      setHasPass(!!data.hasPass)
      setPassExpires(data.passExpiresAt ?? null)
      setFirstLoad(true)
      setWithheld(data.withheld ?? 0)
      setAddedToday(data.addedToday ?? 0)
      setPreviewCount(data.previewCount ?? 0)
      setPreviewIds(data.previewIds ?? [])
      setLockedJobs(data.lockedJobs ?? [])
      setLastUpdated(new Date())
      setLoading(false)

      // Stage 2: the rest, in the background, so the sidebar facet counts
      // reflect the whole dataset. Replaces the array once it lands.
      fetch(`/api/jobs?${params}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((full) => { if (seq === fetchSeq.current && full?.jobs?.length) setAllJobs(full.jobs) })
        .catch(() => {})
    } catch {
      setLoading(false)
    } finally { setLoading(false) }
  }, [filters.sortBy])

  // Debounced so typing in search doesn't fire a request per keystroke
  useEffect(() => {
    const t = setTimeout(fetchJobs, 250)
    return () => clearTimeout(t)
  }, [fetchJobs])

  // Infinite scroll — load more jobs as user scrolls
  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
        setVisibleCount((c) => c + 150)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(150) }, [filters])


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

  const savedJobs = useMemo(() => rawJobs.filter((j) => saved.has(j.id)), [rawJobs, saved])

  // Jump to a saved job's card in the feed; reset filters first if they're hiding it
  // ── Search suggestions (typeahead) ──
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const [sugOpen, setSugOpen] = useState(false)
  const [sugIdx, setSugIdx] = useState(-1)
  useEffect(() => {
    if (!sugOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setSugOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown) }
  }, [sugOpen])

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
      const { next, current } = dropsAround(t, dropBatches)
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
    const { current } = dropsAround(nowTs, dropBatches)
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
    const { prev, next, current } = dropsAround(nowTs, dropBatches)

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
    const lineup =
      names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} then ${names[1]}`
      : `${names[0]} first, then ${names.slice(1).join(', ')}`
    return {
      cls: '', barW, label: 'Next drop',
      detail: `${startsLocal} · ${lineup}`,
      clock: h > 0 ? [{ v: h, u: 'h' }, { v: m, u: 'm' }] : [{ v: m, u: 'm' }],
    }
  }, [nowTs, dropBatches])

  const displayJobs = useMemo(() => {
    const list = allJobs.filter((job) => {
      if (filters.sector !== 'all' && job.sector !== filters.sector) return false
      if (filters.locations.length > 0) {
        if (!job.location) return false
        const jobLocs = locParts(job.location)
        // Hierarchical: regions scope (OR among them), cities refine (OR among them),
        // and when both are selected a job must satisfy both groups — so
        // "United States" + "New York" narrows to New York, not the union.
        const selRegions = filters.locations.filter((l) => REGIONS[l])
        const selCities = filters.locations.filter((l) => !REGIONS[l])
        // Exact part match — same rule the chip counts use, so chip number === feed result
        const matchCity = (sel: string) => jobLocs.includes(sel.toLowerCase())
        if (selRegions.length > 0 && !selRegions.some((r) => jobInRegion(job, r))) return false
        if (selCities.length > 0 && !selCities.some(matchCity)) return false
      }
      if (filters.workTypes.length > 0) {
        const wt = job.work_type ?? inferWorkType(job)
        if (!wt || !filters.workTypes.includes(wt)) return false
      }
      return true
    })
    // Client-side sort fallback (API also sorts; demo data needs it)
    return [...list].sort((a, b) => {
      const d = toTime(b.posted_at) - toTime(a.posted_at)
      return filters.sortBy === 'newest' ? d : -d
    })
  }, [allJobs, filters.sector, filters.locations, filters.workTypes, filters.sortBy])

  // Log settled filter states — not every keystroke, and not the default view
  useEffect(() => {
    const active = filters.search || filters.sector !== 'all'
      || filters.locations.length > 0 || filters.workTypes.length > 0
    if (!active) return
    const t = setTimeout(() => {
      fetch('/api/track-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: visitorId.current,
          term: filters.search,
          sector: filters.sector,
          locations: filters.locations,
          work_types: filters.workTypes,
          result_count: displayJobs.length,
        }),
      }).catch(() => {})
    }, 1200)
    return () => clearTimeout(t)
  }, [filters.search, filters.sector, filters.locations, filters.workTypes, displayJobs.length])

  const sectorCounts = useMemo(() => ({
    all: allJobs.length,
    finance: allJobs.filter((j) => j.sector === 'finance').length,
    tech: allJobs.filter((j) => j.sector === 'tech').length,
    legal: allJobs.filter((j) => j.sector === 'legal').length,
    marketing: allJobs.filter((j) => j.sector === 'marketing').length,
    realestate: allJobs.filter((j) => j.sector === 'realestate').length,
  }), [allJobs])

  // Base for location facet counts: every active filter EXCEPT location itself,
  // so region/city counts respond to the selected sector and work types.
  const locBase = useMemo(() => allJobs.filter((job) => {
    if (filters.sector !== 'all' && job.sector !== filters.sector) return false
    if (filters.workTypes.length > 0) {
      const wt = job.work_type ?? inferWorkType(job)
      if (!wt || !filters.workTypes.includes(wt)) return false
    }
    return true
  }), [allJobs, filters.sector, filters.workTypes])

  const regionCounts = useMemo(() =>
    Object.keys(REGIONS)
      .map((name) => ({ name, count: locBase.filter((j) => jobInRegion(j, name)).length }))
      // hide empty regions, but never hide one the user has selected
      .filter((r) => r.count > 0 || filters.locations.includes(r.name))
      .sort((a, b) => b.count - a.count),
    [locBase, filters.locations])

  // City list is scoped to the selected region(s): US selected → only US cities show
  const cityBase = useMemo(() => {
    const selRegions = filters.locations.filter((l) => REGIONS[l])
    if (selRegions.length === 0) return locBase
    return locBase.filter((j) => selRegions.some((r) => jobInRegion(j, r)))
  }, [locBase, filters.locations])

  // City counts use the SAME exact-part matcher as the feed filter, so a chip's
  // number always equals the number of roles clicking it produces. A job located
  // "New York / London" counts once under each city. Region names and work-mode
  // tokens (hybrid etc.) never appear as cities.
  const cityStats = useMemo(() => {
    // Single pass: parse each job's location once and tally every part it
    // contains. The previous version re-parsed every job for every city name,
    // which was ~1k names x ~6k jobs of regex work on each filter change.
    const tally = new Map<string, { name: string; count: number }>()
    for (const j of cityBase) {
      if (!j.location) continue
      const seen = new Set<string>()
      for (const raw of j.location.replace(/[()]/g, ',').split(/[|,/]/)) {
        const name = raw.trim()
        if (!name || name.length >= 40) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        if (REGION_NAMES_LC.has(key) || CITY_STOP.has(key)) continue
        const cur = tally.get(key)
        if (cur) cur.count++
        else tally.set(key, { name, count: 1 })
      }
    }
    return [...tally.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [cityBase])

  // City chips: selected ones always visible (even at 0), then matches for the
  // typed query (or the most frequent cities when nothing is typed).
  // Collapsed shows the top 24; expanded shows everything in a scrollable area.
  const CITY_LIMIT = 24
  const visibleCities = useMemo(() => {
    const q = locQuery.trim().toLowerCase()
    const matches = q ? cityStats.filter((l) => l.name.toLowerCase().includes(q)) : cityStats
    const selectedNames = filters.locations.filter((l) => !REGIONS[l])
    const selected = selectedNames.map((name) => cityStats.find((l) => l.name === name) ?? { name, count: 0 })
    const rest = matches.filter((l) => !selectedNames.includes(l.name))
    const limit = cityExpanded ? rest.length : CITY_LIMIT
    return { shown: [...selected, ...rest.slice(0, limit)], hidden: Math.max(0, rest.length - limit) }
  }, [cityStats, locQuery, filters.locations, cityExpanded])
  const todayCount = useMemo(() => {
    const today = new Date().toDateString()
    return allJobs.filter((j) => j.extracted_at && new Date(j.extracted_at).toDateString() === today).length
  }, [allJobs])

  const SUG_MAX = 6
  const sugList = filters.search.trim().length >= 2 ? displayJobs.slice(0, SUG_MAX) : []
  const showSug = sugOpen && sugList.length > 0
  const pickSuggestion = (id: string) => {
    track('search_suggestion_click', { term: filters.search })
    setSugOpen(false)
    searchRef.current?.blur()
    jumpToJob(id)
  }

  const daysLeft = passExpires ? Math.max(0, Math.ceil((new Date(passExpires).getTime() - Date.now()) / 86400000)) : null

  const anyFilter = filters.sector !== 'all' || filters.locations.length > 0 || filters.workTypes.length > 0 || filters.search !== ''
  const activeFilterCount = (filters.sector !== 'all' ? 1 : 0) + filters.workTypes.length + filters.locations.length

  const toggleWorkType = (wt: WorkType) => {
    const next = filters.workTypes.includes(wt)
      ? filters.workTypes.filter((w) => w !== wt)
      : [...filters.workTypes, wt]
    track('filter_worktype', { work_types: next.join(',') || 'cleared' })
    setFilters({ ...filters, workTypes: next })
  }

  const [openDrop, setOpenDrop] = useState<'region' | 'city' | null>(null)
  const selRegion = filters.locations.find((l) => REGIONS[l]) ?? null
  const selCity = filters.locations.find((l) => !REGIONS[l]) ?? null
  // Radio-style pickers: one region and one city at a time (null = Any)
  const pickLocation = (kind: 'region' | 'city', value: string | null) => {
    const region = kind === 'region' ? value : selRegion
    const city = kind === 'city' ? value : selCity
    const next = [region, city].filter(Boolean) as string[]
    track('filter_location', { locations: next.join(',') || 'cleared' })
    setFilters({ ...filters, locations: next })
    setOpenDrop(null)
    setLocQuery('')
  }

  const toggleLocation = (loc: string) => {
    const next = filters.locations.includes(loc)
      ? filters.locations.filter((l) => l !== loc)
      : [...filters.locations, loc]
    track('filter_location', { locations: next.join(',') || 'cleared' })
    setFilters({ ...filters, locations: next })
  }

  const track = (name: string, params: Record<string, unknown> = {}) => {
    try {
      const w = window as unknown as { gtag?: (...a: unknown[]) => void }
      w.gtag?.('event', name, params)
    } catch { /* analytics must never break the page */ }
  }

  // Every early-access button goes straight to Stripe Checkout. If the session can't be
  // created we say so and log why, rather than silently sending people to another page.
  const startCheckout = async (where: string) => {
    if (checkingOut) return
    track('cta_click', { where })
    setCheckingOut(true)
    setCheckoutError(false)
    try {
      const res = await fetch(CHECKOUT_ENDPOINT, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) { window.location.href = data.url; return }
      console.error('[checkout] failed', res.status, data)
    } catch (err) {
      console.error('[checkout] request error', err)
    }
    setCheckingOut(false)
    setCheckoutError(true)
    setTimeout(() => setCheckoutError(false), 6000)
  }

  const trackJobClick = (job: JobPost, index: number) => {
    const ageDays = job.posted_at
      ? Math.floor((Date.now() - new Date(job.posted_at).getTime()) / 86400000)
      : null
    // fire-and-forget; keepalive lets it survive the tab navigating away
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          job_id: job.id,
          visitor_id: visitorId.current,
          sector: job.sector,
          location: job.location,
          seniority: job.seniority,
          quality: (job as unknown as { quality?: string }).quality ?? null,
          list_position: index + 1,
          age_days: ageDays,
        }),
      }).catch(() => {})
    } catch { /* never break the click */ }
    return track('job_click', {
    sector: job.sector,
    location: job.location ?? 'unknown',
    seniority: job.seniority ?? 'unknown',
    company: job.company ?? 'unknown',
    list_position: index + 1,
    age_days: ageDays,
    })
  }

  const filtersActive = !!filters.search || filters.sector !== 'all'
    || filters.locations.length > 0 || filters.workTypes.length > 0
  const splitFeed = !hasPass && !filtersActive && previewIds.length > 0
  const previewSet = useMemo(() => new Set(previewIds), [previewIds])
  const todayJobs = useMemo(
    () => (splitFeed ? displayJobs.filter((j) => previewSet.has(j.id)) : []),
    [splitFeed, displayJobs, previewSet])
  const earlierJobs = useMemo(
    () => (splitFeed ? displayJobs.filter((j) => !previewSet.has(j.id)) : displayJobs),
    [splitFeed, displayJobs, previewSet])

  const resetAll = () => setFilters(DEFAULT_FILTERS)

  // Title-only locked roles: only shown when no search/location/work-type filter is active,
  // and narrowed to the selected sector so the cards never contradict the filter.
  const lockedShown = !hasPass && !filters.search && filters.locations.length === 0 && filters.workTypes.length === 0
    ? lockedJobs.filter((l) => filters.sector === 'all' || l.sector === filters.sector)
    : []
  const renderLocked = (l: LockedJob, i: number) => (
    <article key={`locked-${i}`} className="card locked-title" style={{ ['--sec' as string]: `var(--sec-${l.sector}, var(--ink-3))` }}>
      <div className="card-top">
        <span className="sec-tag"><span className="dot" />{sectorLabel(l.sector)}</span>
        {l.posted_at && <span className="ago fresh">{timeAgo(l.posted_at)}</span>}
      </div>
      <h3 className="locked-h">{l.title}</h3>
      <div className="locked-blur" aria-hidden="true">
        <p className="meta"><b>Company name hidden</b><span className="sep">·</span>Senior</p>
        <p className="summary">The details of this role are available with early access. Unlock it to read the full post and reach the recruiter.</p>
        <p className="salary"><span className="via">via: link or DM</span></p>
      </div>
      <div className="card-foot lock-foot">
        <div className="card-actions">
          <button type="button" className="btn-primary" onClick={() => startCheckout('locked_title')} disabled={checkingOut}><BoltIcon />Unlock</button>
        </div>
      </div>
    </article>
  )

  return (
    <div className={`ulj${dark ? ' dark' : ''}`}>

      {/* ── Masthead ─────────────────────────── */}
      <header className="masthead">
        <div className="masthead-in">
          <a className="wordmark" href="/"><span className="mark">B</span><span>backchannel<em>.jobs</em></span></a>

          <div className="search-wrap" ref={searchWrapRef}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input
              ref={searchRef}
              className="search"
              type="search"
              enterKeyHint="search"
              inputMode="search"
              placeholder="Search roles, companies, skills…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && showSug) { e.preventDefault(); setSugIdx((i) => (i + 1) % sugList.length) }
                else if (e.key === 'ArrowUp' && showSug) { e.preventDefault(); setSugIdx((i) => (i <= 0 ? sugList.length - 1 : i - 1)) }
                else if (e.key === 'Escape') { setSugOpen(false) }
                else if (e.key === 'Enter') {
                  // a highlighted suggestion opens that role; otherwise Search/Return shows all results
                  if (showSug && sugIdx >= 0) { e.preventDefault(); pickSuggestion(sugList[sugIdx].id) }
                  else {
                    setSugOpen(false)
                    e.currentTarget.blur()
                    document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                }
              }}
              value={filters.search}
              onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setSugOpen(true); setSugIdx(-1) }}
              onFocus={() => setSugOpen(true)}
              role="combobox"
              aria-expanded={showSug}
              aria-controls="search-sug"
            />
            <span className="slash">/</span>
            {showSug && (
              <div className="sug" id="search-sug" role="listbox">
                {sugList.map((j, n) => (
                  <button
                    type="button" role="option" aria-selected={n === sugIdx} key={j.id}
                    className={`sug-row${n === sugIdx ? ' on' : ''}`}
                    style={{ ['--sec' as string]: `var(--sec-${j.sector}, var(--ink-3))` }}
                    onMouseEnter={() => setSugIdx(n)}
                    onClick={() => pickSuggestion(j.id)}
                  >
                    <span className="sd" />
                    <span className="st">
                      <b>{j.title}</b>
                      <span>{[j.company, j.location].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                ))}
                {displayJobs.length > SUG_MAX && (
                  <button type="button" className="sug-all" onClick={() => { setSugOpen(false); searchRef.current?.blur(); document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                    See all {displayJobs.length} results
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mast-actions">
            <div className="acct-wrap" ref={acctRef}>
              <button className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Account menu" title="Account">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              {menuOpen && (
                <div className="acct-menu">
                  <button onClick={() => { setMenuOpen(false); fetchJobs() }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh roles'}</button>
                  {userEmail ? (
                    <>
                      <div className="acct-email">{userEmail}</div>
                      {hasPass && <div className="acct-badge">Early access active</div>}
                      <button onClick={signOut}>Sign out</button>
                    </>
                  ) : (
                    <>
                      <a href="/login">Sign in</a>
                      <a href="/offer">Pricing</a>
                    </>
                  )}
                </div>
              )}
            </div>
            <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode" title="Toggle dark mode">
              {dark
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>}
            </button>

            {!hasPass && !userEmail && (
              <button type="button" className="btn-primary signup" onClick={() => startCheckout('header_signup')} disabled={checkingOut}>Sign up</button>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────── */}
      {authChecked && !userEmail && (<>
      <section className="hero">
        <div className="hero-copy">
          <h1>The jobs LinkedIn<br /><em>doesn&apos;t show you.</em></h1>
          <p className="sub">Roles recruiters and hiring managers share with their networks before posting them publicly - tracked by AI and delivered in real time.</p>
          <div className="cta-row">
            {!hasPass && (
              <button type="button" className="btn-primary lg" onClick={() => startCheckout('hero')} disabled={checkingOut}>
                <BoltIcon />See new roles first - $9
              </button>
            )}
            <a className="btn-ghost lg" href="#feed">See today&apos;s roles <ArrowRight /></a>
          </div>
          {!hasPass && (
            <div className="offer">
              <div><b>Free</b>Roles older than {FREE_DELAY_HOURS} hours, plus {previewCount || 3} fresh roles a day.</div>
              <div><b>$9 early access</b>Every role the moment it drops. 14 days, no subscription.</div>
            </div>
          )}
        </div>

        <div className="art" role="img" aria-label="Example: a recruiter's LinkedIn post becomes a listing on backchannel.jobs">
          <div className="art-post">
            <div className="art-h"><span className="li">in</span><div><b>Senior Recruiter</b><small>2h ago · LinkedIn</small></div></div>
            <p>I&apos;m working with a Series B SaaS company looking for a Senior Product Manager. Great team, remote friendly. DM me if interested!</p>
          </div>
          <div className="art-note">
            <svg viewBox="0 0 60 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M52 8C40 6 24 10 10 26M10 26l1-11M10 26l11-3" /></svg>
            <span>We find these posts and turn them into real opportunities.</span>
          </div>
          <div className="art-role">
            <div className="art-top"><span className="new">New · 42m ago</span><span className="art-eg">Example</span></div>
            <h3>Senior Product Manager</h3>
            <div className="art-meta">Series B SaaS · San Francisco, CA (Hybrid)</div>
            <ul className="art-facts">
              <li>Posted by: Senior Recruiter at Redwood Talent</li>
              <li>Source: LinkedIn personal post</li>
            </ul>
            <p className="art-quote">“I&apos;m helping a Series B SaaS company hire a Senior Product Manager. Great team, competitive comp, remote friendly…”</p>
            <div className="art-tags"><span>Product</span><span>SaaS</span><span>Remote friendly</span></div>
            <div className="art-actions"><a className="btn-ghost sm" href="#feed">See live roles <ArrowRight /></a></div>
          </div>
        </div>
      </section>

      <div className="howbar-wrap" id="how">
        <div className="howbar">
          <div className="hb-title">How it works</div>
          <ol className="hb-steps">
            {HOW_STEPS.map((st, n) => (
              <li key={st.t}><i>{n + 1}</i><div><b>{st.t}</b><span>{st.d}</span></div></li>
            ))}
          </ol>
        </div>
      </div>

      </>)}

      {/* ── Signed-in strip: replaces the pitch once someone has an account ── */}
      {userEmail && firstLoad && (
        <div className="member-wrap">
          {hasPass ? (
            <div className="member-bar active">
              <span className="mb-dot" />
              <b>Early access active</b>
              {daysLeft !== null && <span className="mb-sub">{daysLeft <= 0 ? 'ends today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}</span>}
              {daysLeft !== null && daysLeft <= 3 && (
                <button type="button" className="mb-link" onClick={() => startCheckout('renew')} disabled={checkingOut}>Extend - $9</button>
              )}
            </div>
          ) : (
            <div className="member-bar free">
              <div className="mb-copy"><b>Free account</b><span className="mb-sub">Roles older than {FREE_DELAY_HOURS} hours, plus {previewCount || 3} fresh roles a day.</span></div>
              <button type="button" className="btn-primary" onClick={() => startCheckout('member_bar')} disabled={checkingOut}><BoltIcon />See new roles first - $9</button>
            </div>
          )}
        </div>
      )}

      <div className="layout" id="feed">
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
                  onClick={() => { track('filter_sector', { sector: s.id }); setFilters({ ...filters, sector: s.id }) }}
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
              {filters.locations.length > 0 && <button onClick={() => { setFilters({ ...filters, locations: [] }); setOpenDrop(null) }}>Clear</button>}
            </div>

            <div className="drop">
              <button type="button" className={`drop-btn${openDrop === 'region' ? ' open' : ''}`} aria-expanded={openDrop === 'region'} onClick={() => setOpenDrop(openDrop === 'region' ? null : 'region')}>
                <span className="dl">Region</span><span className="dv">{selRegion ?? 'Any'}</span>
                <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {openDrop === 'region' && (
                <div className="drop-panel" role="radiogroup" aria-label="Region">
                  <button type="button" role="radio" aria-checked={!selRegion} className={`radio-row${!selRegion ? ' on' : ''}`} onClick={() => pickLocation('region', null)}>
                    <span className="rad" />Any region<span className="n">{locBase.length}</span>
                  </button>
                  {regionCounts.map((r) => (
                    <button type="button" role="radio" aria-checked={selRegion === r.name} key={r.name} className={`radio-row${selRegion === r.name ? ' on' : ''}`} onClick={() => pickLocation('region', r.name)}>
                      <span className="rad" />{r.name}<span className="n">{r.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="drop">
              <button type="button" className={`drop-btn${openDrop === 'city' ? ' open' : ''}`} aria-expanded={openDrop === 'city'} onClick={() => setOpenDrop(openDrop === 'city' ? null : 'city')}>
                <span className="dl">City</span><span className="dv">{selCity ?? 'Any'}</span>
                <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {openDrop === 'city' && (
                <div className="drop-panel" role="radiogroup" aria-label="City">
                  <input
                    className="loc-search"
                    type="text"
                    placeholder="Search cities…"
                    value={locQuery}
                    onChange={(e) => setLocQuery(e.target.value)}
                  />
                  <div className="drop-list">
                    <button type="button" role="radio" aria-checked={!selCity} className={`radio-row${!selCity ? ' on' : ''}`} onClick={() => pickLocation('city', null)}>
                      <span className="rad" />Any city
                    </button>
                    {visibleCities.shown.map((l) => (
                      <button type="button" role="radio" aria-checked={selCity === l.name} key={l.name} className={`radio-row${selCity === l.name ? ' on' : ''}`} onClick={() => pickLocation('city', l.name)}>
                        <span className="rad" />{l.name}<span className="n">{l.count}</span>
                      </button>
                    ))}
                    {visibleCities.hidden > 0 && (
                      <button type="button" className="more-note" onClick={() => setCityExpanded(true)}>Show all (+{visibleCities.hidden} more)</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {!hasPass && (
            <div className="pass pass-side">
              <span className="tagline">Most roles fill inside 48 hours</span>
              <h3>Don&apos;t wait {FREE_DELAY_HOURS} hours.</h3>
              <div className="price"><b>$9</b><span>14 days · one payment</span></div>
              <button type="button" className="btn-primary block" onClick={() => startCheckout('sidebar')} disabled={checkingOut}>See new roles first - $9</button>
              <ul>
                <li><CheckIcon />Every role the moment it drops</li>
                <li><CheckIcon />No subscription, expires on its own</li>
              </ul>
            </div>
          )}

          <p className="side-note">Sourced from public posts. Always verify details with the recruiter before applying.</p>
        </aside>

        {/* ── Feed ────────────────────────────── */}
        <main>
          <div className="feed-bar">
            <span className="count">
              <b>{displayJobs.length}</b> {displayJobs.length === 1 ? 'role' : 'roles'}
              {filters.sector !== 'all' && ` in ${sectorLabel(filters.sector)}`}
            </span>
            {!anyFilter && addedToday > 0 && (
              <span className="new-today"><span className="nd" />{addedToday} new today</span>
            )}
            {anyFilter && <button className="clear" onClick={resetAll}>Reset filters</button>}
            <div className="sort-wrap">
              <select value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'newest' | 'oldest' })}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
          {searchFixes.length > 0 && (
            <div className="dym">Showing results for <b>{searchTerms.map((t) => t.fixed ?? t.tok).join(' ')}</b></div>
          )}

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
            <>
            {splitFeed && todayJobs.length > 0 && (
              <div className="today-wrap">
                <div className="sec-head"><span>Today&apos;s roles</span><i /></div>
                <div className="cards today-cards">
                  {todayJobs.map((job, i) => (
                    <article key={job.id} className="card" style={{ ['--sec' as string]: `var(--sec-${job.sector}, var(--ink-3))` }}>
                      <div className="card-top">
                        <span className="sec-tag"><span className="dot" />{sectorLabel(job.sector)}{job.location && <> · {job.location}</>}</span>
                        <span className="sample-flag">Free sample</span>
                        {job.posted_at && <span className="ago fresh">{timeAgo(job.posted_at)}</span>}
                      </div>
                      <h3><a href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, i)}>{job.title}</a></h3>
                      <p className="meta">
                        <b>{job.company ?? 'Company not disclosed'}</b>
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
                        <span className="avatar">
                        {job.author_avatar
                          ? <img src={job.author_avatar} alt="" loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          : null}
                        <i>{initials(job.author_name || '?')}</i>
                      </span>
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
                          <a className="apply-btn" href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, i)}>
                            View post
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17 17 7M7 7h10v10" /></svg>
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                  {lockedShown.map(renderLocked)}
                </div>
              </div>
            )}

            {!hasPass && (
              <div className="inline-cta">
                <div>
                  <h3>{withheld > 0 ? `${withheld} newer roles are waiting.` : 'See these now, not in 48 hours.'}</h3>
                  <p>14 days of early access for $9. Every new role the moment it drops. No subscription.</p>
                </div>
                <button type="button" className="btn-primary lg" onClick={() => startCheckout('inline')} disabled={checkingOut}><BoltIcon />See new roles first - $9</button>
              </div>
            )}

            {splitFeed && <div className="sec-head"><span>Earlier roles</span><i />{!hasPass && <em className="sec-note">Older than {FREE_DELAY_HOURS} hours</em>}</div>}
            <div className="cards">
              {!splitFeed && lockedShown.map(renderLocked)}
              {earlierJobs.slice(0, visibleCount).map((job, jobIndex) => {
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

                    <h3><a href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, jobIndex)}>{job.title}</a></h3>
                    <p className="meta">
                      <b>{job.company ?? 'Company not disclosed'}</b>
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
                      <span className="avatar">
                        {job.author_avatar
                          ? <img src={job.author_avatar} alt="" loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          : null}
                        <i>{initials(job.author_name || '?')}</i>
                      </span>
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
                        <a className="apply-btn" href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, jobIndex)}>
                          View post
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17 17 7M7 7h10v10" /></svg>
                        </a>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
            </>
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
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500;600&family=Caveat:wght@600&display=swap');

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
          --link:      #1B4F82;
          --accent:    #24468f;
          --accent-soft:#E4EAF6;
          --cta:       #2F6BF2;
          --cta-hover: #2458D4;
          --cta-fg:    #FFFFFF;
          --line-strong:#B9B2A2;
          --live-soft: #E2F0E6;
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
          --link:      #7FB3E3;
          --accent:    #6F97EE;
          --accent-soft:#212B45;
          --cta:       #6B98FF;
          --cta-hover: #85AAFF;
          --cta-fg:    #0B1224;
          --line-strong:#5A5649;
          --live-soft: #1B2E22;
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
        .ulj .search { -webkit-appearance: none; appearance: none; }
        .ulj .search::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
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
          background: var(--surface); color: var(--ink-2); border: 1px solid var(--hairline-2); border-radius: 10px;
          font: 600 12.5px 'Inter', sans-serif; cursor: pointer; transition: .15s;
        }
        .ulj .refresh-btn:hover { color: var(--ink); border-color: var(--ink-3); }
        .ulj .refresh-btn:disabled { cursor: not-allowed; opacity: .7; }
        .ulj .refresh-btn.spinning svg { animation: ulj-spin 0.9s linear infinite; }
        @keyframes ulj-spin { to { transform: rotate(360deg); } }

        /* ── Hero ── */
        .ulj .hero { max-width: 1200px; margin: 0 auto; padding: 40px 28px 30px; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px 48px; align-items: center; }
        .ulj .hero h1 {
          font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(38px, 5.4vw, 64px);
          line-height: 1.04; letter-spacing: -0.025em; margin-bottom: 18px;
        }
        .ulj .hero h1 em { font-style: italic; font-weight: 400; }
        .ulj .hero .sub { font-size: 17px; color: var(--ink-2); max-width: 54ch; margin-bottom: 24px; }
        .ulj .cta-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .ulj .offer { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; max-width: 620px; border: 1px solid var(--hairline-2); background: var(--surface); border-radius: 12px; overflow: hidden; }
        .ulj .offer > div { padding: 12px 16px; font-size: 13px; color: var(--ink-2); }
        .ulj .offer > div + div { border-left: 1px solid var(--hairline-2); background: var(--accent-soft); color: var(--ink); }
        .ulj .offer b { display: block; font-weight: 600; color: var(--ink); margin-bottom: 2px; font-size: 14px; }
        /* Hero art: a recruiter post becoming a listing */
        .ulj .art { position: relative; width: 100%; max-width: 520px; margin-left: auto; }
        .ulj .art-post { position: relative; z-index: 2; width: 66%; background: var(--surface); border: 1px solid var(--hairline); border-radius: 14px; padding: 14px 16px; box-shadow: var(--shadow); }
        .ulj .art-h { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .ulj .art-h b { display: block; font-size: 14px; line-height: 1.2; }
        .ulj .art-h small { display: block; font-size: 12px; color: var(--ink-2); }
        .ulj .art .li { width: 30px; height: 30px; border-radius: 6px; background: #0A66C2; color: #fff; display: grid; place-items: center; font: 700 15px 'Inter', sans-serif; flex: none; }
        .ulj .art-post p { font-size: 13.5px; color: var(--ink-2); }
        .ulj .art-note { position: absolute; z-index: 3; top: 2px; right: 0; width: 31%; display: flex; flex-direction: column; font: 600 22px/1.02 'Caveat', 'Segoe Print', 'Bradley Hand', cursive; color: var(--ink); transform: rotate(-4deg); transform-origin: left center; }
        .ulj .art-note svg { width: 54px; height: 36px; margin: 0 0 2px -34px; }
        .ulj .art-role { position: relative; z-index: 1; margin-top: -12px; background: var(--surface); border: 1px solid var(--hairline); border-radius: 16px; padding: 30px 20px 18px; box-shadow: var(--shadow-lift); }
        .ulj .art-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .ulj .art .new { font: 600 12px 'Inter', sans-serif; padding: 3px 10px; border-radius: 999px; background: var(--live-soft); color: var(--live); }
        .ulj .art-eg { font: 500 11px 'Spline Sans Mono', monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
        .ulj .art-role h3 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 26px; line-height: 1.15; letter-spacing: -.01em; margin-bottom: 4px; }
        .ulj .art-meta { font-size: 14px; color: var(--ink-2); }
        .ulj .art-facts { list-style: none; padding: 0; margin: 12px 0 10px; display: grid; gap: 2px; font-size: 13.5px; color: var(--ink-2); }
        .ulj .art-quote { font-size: 13.5px; }
        .ulj .art-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .ulj .art-tags span { font-size: 12px; padding: 2px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
        .ulj .art-actions { display: flex; gap: 8px; margin-top: 14px; }

        /* ── Buttons: solid blue is reserved for the early-access CTA ── */
        .ulj .btn-primary {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          height: 38px; padding: 0 16px; border-radius: 10px; white-space: nowrap;
          background: var(--cta); color: var(--cta-fg); border: 1px solid var(--cta);
          font: 600 13.5px 'Inter', sans-serif; text-decoration: none; cursor: pointer;
          box-shadow: 0 4px 14px color-mix(in srgb, var(--cta) 32%, transparent);
          transition: background .12s, border-color .12s;
        }
        .ulj .btn-primary:hover { background: var(--cta-hover); border-color: var(--cta-hover); }
        .ulj .btn-primary:disabled { opacity: .7; cursor: wait; }
        .ulj .checkout-error { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(18px + env(safe-area-inset-bottom, 0px)); z-index: 80; display: flex; align-items: center; gap: 14px; width: max-content; max-width: calc(100vw - 32px); padding: 12px 16px; border-radius: 12px; background: #8A1F1F; color: #fff; font-size: 13.5px; box-shadow: 0 12px 32px -10px rgba(0,0,0,.45); }
        .ulj .checkout-error button { background: none; border: none; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; opacity: .8; }
        .ulj .btn-primary.lg { height: 48px; padding: 0 22px; font-size: 15px; border-radius: 12px; }
        .ulj .btn-primary.block { width: 100%; }
        .ulj .btn-ghost {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          height: 38px; padding: 0 16px; border-radius: 10px; white-space: nowrap;
          background: transparent; color: var(--ink); border: 1.5px solid var(--line-strong);
          font: 500 13.5px 'Inter', sans-serif; text-decoration: none; cursor: pointer; transition: .12s;
        }
        .ulj .btn-ghost:hover { background: var(--surface-2); border-color: var(--ink); }
        .ulj .btn-ghost.lg { height: 48px; padding: 0 22px; font-size: 15px; border-radius: 12px; }
        .ulj .btn-ghost.sm { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 9px; }
        .ulj .cta-short { display: none; }
        .ulj .nav-link { font-size: 14px; color: var(--ink-2); text-decoration: none; padding: 0 6px; }
        .ulj .nav-link:hover { color: var(--ink); }

        /* ── Layout ── */
        .ulj .layout { max-width: 1200px; margin: 0 auto; padding: 8px 28px 60px; display: grid; grid-template-columns: 218px 1fr; gap: 40px; align-items: start; }
        .ulj .layout > * { min-width: 0; }  /* let grid children shrink below content width */

        /* ── Sidebar ── */
        .ulj .filters {
          position: sticky; top: 84px;
          display: flex; flex-direction: column; gap: 26px;
          /* Scroll independently of the feed — otherwise a tall filter column's
             bottom is unreachable until the whole page is scrolled through */
          max-height: calc(100vh - 100px);
          overflow-y: auto; overflow-x: hidden;
          margin: 0 -10px; padding: 8px 10px 24px;
          scrollbar-width: none;  /* scrolls via wheel/trackpad; bar itself hidden */
        }
        .ulj .filters::-webkit-scrollbar { display: none; }
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
        .ulj .sector-row.active { background: var(--accent-soft); box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--ink); font-weight: 600; }
        .ulj .sector-row .dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; background: var(--dot, var(--ink-3)); }
                .ulj .sector-row .cnt { margin-left: auto; font: 500 11.5px 'Spline Sans Mono', monospace; color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .ulj .sector-row.active .cnt { color: var(--ink); }
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
        .ulj .check-row.on .box { background: var(--accent); border-color: var(--accent); color: #fff; }
        .ulj .chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 4px; }
        .ulj .chip {
          padding: 5px 11px; border-radius: 999px; cursor: pointer;
          background: var(--surface); border: 1px solid var(--hairline-2);
          font: 500 12px 'Inter', sans-serif; color: var(--ink-2); transition: .12s;
        }
        .ulj .chip:hover { border-color: var(--ink-3); color: var(--ink); }
        .ulj .chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--ink); }
        .ulj .chip .n { margin-left: 6px; font: 500 10.5px 'Spline Sans Mono', monospace; color: var(--ink-3); }
        .ulj .chip.on .n { color: var(--ink-2); }
        .ulj .chips.regions { padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--hairline); }
        .ulj .loc-search {
          width: 100%; height: 30px; padding: 0 10px; margin-bottom: 8px;
          background: var(--surface); color: var(--ink);
          border: 1px solid var(--hairline-2); border-radius: 8px;
          font: 500 12px 'Inter', sans-serif; outline: none;
        }
        .ulj .loc-search::placeholder { color: var(--ink-3); }
        .ulj .loc-search:focus { border-color: var(--ink-2); }
        .ulj .more-note {
          margin-top: 8px; font-size: 11px; color: var(--ink-3);
          background: none; border: none; cursor: pointer; padding: 0;
          text-decoration: underline; text-underline-offset: 3px;
        }
        .ulj .more-note:hover { color: var(--ink); }
        .ulj .chips.cities.expanded { max-height: 300px; overflow-y: auto; padding-right: 4px; }
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
        .ulj .new-today { align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: var(--live-soft); color: var(--live); font: 600 12px 'Inter', sans-serif; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .ulj .new-today .nd { width: 6px; height: 6px; border-radius: 50%; background: var(--live); animation: ulj-pulse 2.2s infinite; }
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
        .ulj .wordmark { display: inline-flex; align-items: center; gap: 10px; }
        .ulj .wordmark .mark { flex: none; width: 30px; height: 30px; border-radius: 7px;
          background: #185FA5; color: #FFFFFF; display: inline-flex; align-items: center;
          justify-content: center; font-family: 'Fraunces', Georgia, serif; font-size: 18px;
          font-weight: 500; line-height: 1; }
        @media (max-width: 560px) {
          .ulj .wordmark .mark { width: 26px; height: 26px; font-size: 16px; border-radius: 6px; }
          .ulj .wordmark { gap: 8px; }
        }
        .ulj .acct-wrap { position: relative; }
        .ulj .acct-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60;
          min-width: 200px; background: #FFFDF9; border: 1px solid #DDD6C8;
          border-radius: 10px; padding: 6px; display: flex; flex-direction: column;
          box-shadow: 0 8px 28px -6px rgba(25,23,19,0.22); }
        .ulj.dark .acct-menu { background: #1C1A17; border-color: #35322C;
          box-shadow: 0 8px 28px -6px rgba(0,0,0,0.55); }
        .ulj .acct-menu a, .ulj .acct-menu button { display: block; width: 100%; text-align: left;
          font: 500 13px 'Inter', sans-serif; color: var(--ink); background: none; border: none;
          padding: 8px 10px; border-radius: 7px; cursor: pointer; text-decoration: none; }
        .ulj .acct-menu a:hover, .ulj .acct-menu button:hover { background: var(--page); }
        .ulj .acct-email { font-size: 11.5px; color: var(--ink-2); padding: 7px 10px 4px; word-break: break-all; }
        .ulj .acct-badge { font-size: 11px; color: var(--ink-2); padding: 0 10px 7px; }
        .ulj .cards { padding-bottom: 92px; }
        .ulj .sec-head { display: flex; align-items: center; gap: 10px; padding: 4px 0 12px; }
        .ulj .sec-head span { font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-3); }
        .ulj .sec-head i { flex: 1; height: 1px; background: var(--hairline); }
        .ulj .today-wrap { margin-bottom: 26px; }
        .ulj .today-cards { padding-bottom: 0; }
        .ulj .withheld-note { grid-column: 1 / -1; padding: 2px 0 6px; }
        .ulj .withheld-note b { display: block; font-family: 'Fraunces', Georgia, serif;
          font-size: 17px; font-weight: 500; color: var(--ink); }
        .ulj .withheld-note span { font-size: 12.5px; color: var(--ink-2); }
        .ulj .card.mini h3 { font-size: 16px; margin: 2px 0 0; }
        .ulj .convert-old { margin: 34px 0 0; padding: 28px 26px; border-radius: 14px; background: var(--ink); }
        .ulj .convert h2 { font-family: 'Fraunces', Georgia, serif; font-size: 21px; font-weight: 500; color: var(--page); margin: 0 0 6px; }
        .ulj .convert p { font-size: 13.5px; color: var(--ink-3); margin: 0 0 16px; }
        .ulj .convert-cta { display: inline-block; background: var(--page); color: var(--ink); font-size: 13px; padding: 10px 18px; border-radius: 8px; text-decoration: none; }
        .ulj .card.locked-unused { border-left: 3px solid var(--ink-3); background: var(--card); }
        .ulj .locked-body { padding: 22px 4px; text-align: center; }
        .ulj .locked-count { font-family: 'Fraunces', Georgia, serif; font-size: 20px; font-weight: 500; color: var(--ink); }
        .ulj .locked-sub { font-size: 13px; color: var(--ink-2); margin: 6px 0 14px; }
        .ulj .sec-tag { display: inline-flex; align-items: center; gap: 7px; font-size: 10.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-2); }
        .ulj .sec-tag .dot { width: 8px; height: 8px; border-radius: 3px; background: var(--sec); }
        .ulj .verified { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ink-3); }
        .ulj .verified svg { color: var(--live); }
        .ulj .ago { margin-left: auto; font: 500 11.5px 'Spline Sans Mono', monospace; color: var(--ink-3); }
        .ulj .ago.fresh { color: var(--live); }
        .ulj .card h3 { font-family: 'Fraunces', Georgia, serif; font-size: 20px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.25; }
        /* Titles carry the brand blue — they're the thing people scan, and it
           breaks up an otherwise all-black page. */
        .ulj .card h3 a { color: #1B4F82; text-decoration: none; }
        .ulj.dark .card h3 a { color: #7FB3E3; }
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
          display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;
        }
        /* keeps a long headline from pushing the avatar onto its own line */
        .ulj .card-foot .author { flex: 1; min-width: 0; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; }
        .ulj .avatar {
          position: relative; overflow: hidden;
          width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
          background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--hairline-2);
          display: grid; place-items: center; font: 600 13px 'Inter', sans-serif;
        }
        /* Photo sits over the initials; if the signed LinkedIn url has expired
           the img hides itself on error and the initials show through. */
        .ulj .avatar img { position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; border-radius: 50%; }
        .ulj .avatar i { font-style: normal; }
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
          background: transparent; color: var(--ink); border: 1.5px solid var(--line-strong); border-radius: 8px;
          font: 600 12px 'Inter', sans-serif; cursor: pointer; text-decoration: none; transition: .12s;
        }
        .ulj .apply-btn:hover { background: var(--surface-2); border-color: var(--ink); }

        .ulj .empty {
          background: var(--surface); border: 1px dashed var(--hairline-2); border-radius: 16px;
          padding: 64px 24px; text-align: center;
        }
        .ulj .empty h3 { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 500; }
        .ulj .empty p { margin: 8px 0 20px; color: var(--ink-2); font-size: 13.5px; }
        .ulj .empty button {
          padding: 9px 18px; background: transparent; color: var(--ink); border: 1.5px solid var(--line-strong);
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
          background: var(--accent); color: #fff;
          font: 600 10.5px 'Spline Sans Mono', monospace;
          display: inline-grid; place-items: center;
        }

        /* ── Tablet & below: single column, collapsible filters ── */
        @media (max-width: 900px) {
          .ulj .layout { grid-template-columns: 1fr; gap: 16px; }
          .ulj .filters { position: static; padding: 0; margin: 0; gap: 0; max-height: none; overflow: visible; }
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
          .ulj .hero { grid-template-columns: 1fr; align-items: start; }
          .ulj .art { margin: 0 auto 0 0; }
          .ulj .pass-side { display: none; }
        }

        /* ── Phones: wrap masthead, compress hero & feed ── */
        @media (max-width: 760px) {
          .ulj .masthead-in {
            flex-wrap: wrap; height: auto; padding: 10px 16px; gap: 10px; row-gap: 10px;
          }
          .ulj .search-wrap { order: 3; flex-basis: 100%; max-width: none; }
          .ulj .search { font-size: 16px; }  /* iOS zooms the page on focus below 16px */
          .ulj .slash { display: none; }
          .ulj .refresh-btn { width: 36px; padding: 0; justify-content: center; }
          .ulj .refresh-btn span { display: none; }  /* icon-only so the top row fits one line */
          .ulj .hero { padding: 26px 16px 16px; gap: 24px; }
          .ulj .hero .sub { font-size: 15px; }
          .ulj .offer { grid-template-columns: 1fr; }
          .ulj .offer > div + div { border-left: none; border-top: 1px solid var(--hairline-2); }
          .ulj .art-post { width: 100%; }
          .ulj .art-note { position: static; width: auto; transform: none; flex-direction: row; align-items: center; gap: 8px; margin: 8px 0 0 8px; font-size: 21px; }
          .ulj .art-note svg { margin: 0; flex: none; transform: rotate(-90deg) scaleX(-1); }
          .ulj .art-role { margin-top: 0; padding-top: 20px; }
          .ulj .nav-link { display: none; }
          .ulj .layout { padding: 4px 16px 40px; }
          .ulj .chip { padding: 7px 13px; }  /* bigger tap targets */
        }

        @media (max-width: 560px) { .ulj .refresh-btn { display: none; } .ulj .cta-full { display: none; } .ulj .cta-short { display: inline; } }

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


        /* ── Phone polish: one-row header, full-width hero buttons, compact sticky bar ── */
        @media (max-width: 560px) {
          .ulj .masthead-in { padding: 10px 16px; row-gap: 10px; }
          .ulj .masthead-in { gap: 8px; }
          .ulj .wordmark { font-size: 18px; margin-right: auto; display: inline-flex; align-items: center; gap: 7px; }
          .ulj .wordmark .mark { width: 26px; height: 26px; font-size: 14px; }
          .ulj .mast-actions { gap: 6px; margin-left: 0; }
          .ulj .mast-actions .icon-btn { width: 34px; height: 34px; }
          .ulj .mast-actions > .btn-primary:not(.signup) { display: none; }  /* the hero already carries the checkout CTA */
          .ulj .mast-actions > .signup { height: 34px; padding: 0 12px; font-size: 13px; }
          .ulj .cta-row { flex-direction: column; align-items: stretch; gap: 10px; }
          .ulj .cta-row .btn-primary, .ulj .cta-row .btn-ghost { width: 100%; }
          .ulj .offer > div { padding: 11px 14px; }
        }


        /* ── Location dropdowns (radio) ── */
        .ulj .drop { margin-top: 8px; }
        .ulj .drop-btn { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 12px; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 9px; cursor: pointer; font: 500 13px 'Inter', sans-serif; color: var(--ink); text-align: left; }
        .ulj .drop-btn:hover { border-color: var(--ink-3); }
        .ulj .drop-btn.open { border-color: var(--ink-2); }
        .ulj .drop-btn .dl { color: var(--ink-3); font-size: 12px; }
        .ulj .drop-btn .dv { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
        .ulj .drop-btn .chev { flex: none; color: var(--ink-3); transition: transform .15s; }
        .ulj .drop-btn.open .chev { transform: rotate(180deg); }
        .ulj .drop-panel { margin-top: 6px; padding: 6px; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 10px; }
        .ulj .drop-panel .loc-search { margin: 2px 0 6px; }
        .ulj .drop-list { max-height: 240px; overflow-y: auto; }
        .ulj .drop-panel > .radio-row, .ulj .drop-list > .radio-row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; background: none; border: none; border-radius: 7px; cursor: pointer; font: 500 13px 'Inter', sans-serif; color: var(--ink-2); text-align: left; }
        .ulj .radio-row:hover { background: var(--page); color: var(--ink); }
        .ulj .radio-row.on { color: var(--ink); }
        .ulj .radio-row .rad { flex: none; width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--hairline-2); background: var(--surface); display: grid; place-items: center; }
        .ulj .radio-row.on .rad { border-color: var(--accent); }
        .ulj .radio-row.on .rad::after { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
        .ulj .radio-row .n { margin-left: auto; font: 500 10.5px 'Spline Sans Mono', monospace; color: var(--ink-3); }
        .ulj .drop-list .more-note { margin: 6px 8px 4px; }


        /* ── Signed-in strip (replaces hero + how-it-works) ── */
        .ulj .member-wrap { max-width: 1200px; margin: 0 auto; padding: 20px 28px 0; }
        .ulj .member-bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid var(--hairline-2); border-radius: 12px; background: var(--surface); font-size: 13.5px; }
        .ulj .member-bar b { font-weight: 600; }
        .ulj .member-bar .mb-sub { color: var(--ink-2); font-size: 13px; }
        .ulj .member-bar.active { background: var(--live-soft); border-color: transparent; }
        .ulj .member-bar.active b { color: var(--live); }
        .ulj .mb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--live); animation: ulj-pulse 2.2s infinite; flex: none; }
        .ulj .mb-link { margin-left: auto; background: none; border: none; cursor: pointer; font: 600 13px 'Inter', sans-serif; color: var(--link); text-decoration: underline; text-underline-offset: 3px; }
        .ulj .member-bar.free { background: var(--accent-soft); border-color: transparent; }
        .ulj .member-bar.free .mb-copy { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; flex: 1; min-width: 0; }
        .ulj .member-bar.free .btn-primary { margin-left: auto; height: 34px; }
        @media (max-width: 720px) { .ulj .member-wrap { padding: 14px 16px 0; } }
        @media (max-width: 560px) {
          .ulj .member-bar.free { flex-direction: column; align-items: stretch; gap: 10px; }
          .ulj .member-bar.free .btn-primary { margin: 0; height: 40px; }
        }


        .ulj .dym { margin: -4px 0 12px; font-size: 13px; color: var(--ink-2); }
        .ulj .dym b { color: var(--ink); font-weight: 600; }

        /* ── Search suggestions ── */
        .ulj .sug { position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 70; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 12px; padding: 6px; box-shadow: 0 16px 40px -12px rgba(0,0,0,.28); max-height: min(70vh, 460px); overflow-y: auto; }
        .ulj .sug-row { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 9px 10px; background: none; border: none; border-radius: 8px; cursor: pointer; text-align: left; font-family: 'Inter', sans-serif; }
        .ulj .sug-row.on, .ulj .sug-row:hover { background: var(--accent-soft); }
        .ulj .sug-row .sd { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--sec); }
        .ulj .sug-row .st { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .ulj .sug-row .st b { font-size: 14px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .sug-row .st span { font-size: 12.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .sug-all { display: block; width: 100%; margin-top: 4px; padding: 9px 10px; border: none; border-top: 1px solid var(--hairline); background: none; text-align: left; cursor: pointer; font: 600 13px 'Inter', sans-serif; color: var(--link); border-radius: 0 0 8px 8px; }
        .ulj .sug-all:hover { text-decoration: underline; text-underline-offset: 3px; }

        /* ── Free sample flag, section notes ── */
        .ulj .sample-flag { font: 500 11px 'Spline Sans Mono', monospace; letter-spacing: .06em; text-transform: uppercase; background: var(--live-soft); color: var(--live); padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
        .ulj .sec-head .sec-note { font-style: normal; font-size: 11.5px; color: var(--ink-2); background: var(--accent-soft); padding: 3px 10px; border-radius: 999px; }
        .ulj .sec-head span { white-space: nowrap; }

        /* ── Title-only locked roles ── */
        .ulj .card.locked-title:hover { translate: 0 0; box-shadow: var(--shadow); border-color: var(--hairline); }
        .ulj .card h3.locked-h { color: var(--link); }
        .ulj .locked-blur { filter: blur(5px); user-select: none; pointer-events: none; }
        .ulj .lock-foot { background: linear-gradient(90deg, var(--accent-soft), transparent 85%); justify-content: flex-end; }

        /* ── Sidebar pass card ── */
        .ulj .pass { background: #14213D; color: #F3F1EA; border-radius: 16px; padding: 20px; }
        .ulj.dark .pass { background: #0E1830; }
        .ulj .pass .tagline { display: block; font: 500 11px 'Spline Sans Mono', monospace; letter-spacing: .08em; text-transform: uppercase; color: #A9B4CC; margin-bottom: 8px; }
        .ulj .pass h3 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 26px; line-height: 1.1; letter-spacing: -.01em; margin-bottom: 6px; }
        .ulj .pass .price { display: flex; align-items: baseline; gap: 8px; margin-bottom: 14px; }
        .ulj .pass .price b { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 46px; line-height: 1; }
        .ulj .pass .price span { font-size: 13px; color: #A9B4CC; }
        .ulj .pass ul { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 6px; font-size: 13px; color: #A9B4CC; }
        .ulj .pass li { display: flex; gap: 8px; align-items: center; }
        .ulj .pass li svg { color: #7FD69B; flex: none; }

        /* ── Inline pass CTA in the feed ── */
        .ulj .inline-cta { display: grid; grid-template-columns: 1fr auto; gap: 16px 24px; align-items: center; background: #14213D; color: #F3F1EA; border-radius: 16px; padding: 22px 24px; margin: 4px 0 30px; }
        .ulj.dark .inline-cta { background: #0E1830; }
        .ulj .inline-cta h3 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 26px; line-height: 1.15; margin-bottom: 4px; }
        .ulj .inline-cta p { font-size: 14px; color: #A9B4CC; }
        @media (max-width: 640px) { .ulj .inline-cta { grid-template-columns: 1fr; } }

        /* ── How it works bar (sits where the stat band was) ── */
        .ulj #feed { scroll-margin-top: 76px; }
        @media (max-width: 760px) { .ulj #feed { scroll-margin-top: 118px; } }
        .ulj .howbar-wrap { max-width: 1200px; margin: 0 auto; padding: 0 28px; scroll-margin-top: 80px; }
        .ulj .howbar { display: flex; border-block: 1px solid var(--hairline-2); margin-bottom: 32px; }
        .ulj .hb-title { flex: 0 0 190px; align-self: center; padding: 14px 20px 14px 0; font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 22px; line-height: 1.15; letter-spacing: -.01em; }
        .ulj .hb-steps { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; padding: 0; }
        .ulj .hb-steps li { display: grid; grid-template-columns: 26px 1fr; column-gap: 12px; align-items: start; padding: 16px 20px; border-left: 1px solid var(--hairline-2); }
        .ulj .hb-steps i { font: 500 12px 'Spline Sans Mono', monospace; font-style: normal; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); }
        .ulj .hb-steps b { display: block; font: 600 14px/1.3 'Inter', sans-serif; margin-top: 3px; }
        .ulj .hb-steps span { display: block; margin-top: 2px; font-size: 12.5px; line-height: 1.4; color: var(--ink-2); }
        @media (max-width: 900px) {
          .ulj .howbar { flex-direction: column; }
          .ulj .hb-title { flex: none; padding: 14px 0 4px; }
          .ulj .hb-steps li:first-child { border-left: none; padding-left: 0; }
        }
        @media (max-width: 720px) {
          .ulj .howbar-wrap { padding: 0 16px; }
          .ulj .hb-steps { grid-template-columns: 1fr; }
          .ulj .hb-steps li { border-left: none; border-top: 1px solid var(--hairline-2); padding: 12px 0; }
          .ulj .hb-steps li:first-child { border-top: none; }
        }
      `}</style>

      {checkoutError && (
        <div className="checkout-error" role="alert">
          We couldn&apos;t start checkout. Please try again in a moment.
          <button onClick={() => setCheckoutError(false)} aria-label="Dismiss">×</button>
        </div>
      )}

      <Analytics />
    </div>
  )
}
