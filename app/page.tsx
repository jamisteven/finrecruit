'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { JobPost, FilterState, Sector, WorkType } from '@/types'
import { JobCard } from '@/components/JobCard'
import { FilterBar } from '@/components/FilterBar'
import { RefreshCw, Sun, Moon, Zap, TrendingUp, Scale, Megaphone, Cpu } from 'lucide-react'

const DEFAULT_FILTERS: FilterState = {
  sector: 'all', seniority: 'All', locations: [], workTypes: [], search: '', sortBy: 'newest',
}

const SECTORS: { id: Sector; label: string; icon: React.ReactNode }[] = [
  { id: 'all',       label: 'All',       icon: <Zap size={13} /> },
  { id: 'finance',   label: 'Finance',   icon: <TrendingUp size={13} /> },
  { id: 'tech',      label: 'Tech',      icon: <Cpu size={13} /> },
  { id: 'legal',     label: 'Legal',     icon: <Scale size={13} /> },
  { id: 'marketing', label: 'Marketing', icon: <Megaphone size={13} /> },
]

const WORK_TYPES: WorkType[] = ['Remote', 'On-site', 'Hybrid']

const DEMO_JOBS: JobPost[] = [
  { id: '1', title: 'Equity Research Analyst — TMT', company: 'Tier 1 Hedge Fund', location: 'London', seniority: 'Senior', salary: '£120k–£160k + carry', apply_method: 'DM recruiter', summary: 'Long/short equity fund seeking a TMT-focused analyst with 4–7 years buyside experience.', tags: ['hedge-fund', 'equities', 'london'], sector: 'finance', post_url: '#', author_name: 'Sarah Mitchell', author_headline: 'Executive Search | Hedge Funds & Asset Management', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 7200000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
  { id: '2', title: 'Senior Software Engineer — AI Platform', company: 'Series B Startup', location: 'New York', seniority: 'Senior', salary: '$180k–$220k + equity', apply_method: 'Email CV', summary: 'Fast-growing AI startup hiring a senior engineer to build core inference infrastructure.', tags: ['ai', 'backend', 'new-york'], sector: 'tech', post_url: '#', author_name: 'James Park', author_headline: 'Tech Recruiter | AI & Engineering', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 10800000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
  { id: '3', title: 'Corporate Associate — M&A', company: 'Magic Circle Law Firm', location: 'London', seniority: 'Mid', salary: '£95k–£120k', apply_method: 'Apply via link', summary: 'Top-tier law firm seeking a 3–5 PQE corporate associate for a busy M&A practice.', tags: ['legal', 'corporate', 'ma', 'london'], sector: 'legal', post_url: '#', author_name: 'Claire Hughes', author_headline: 'Legal Recruiter | City Law Firms', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 18000000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
  { id: '4', title: 'Head of Performance Marketing', company: 'DTC Scale-up', location: 'Remote', seniority: 'Director', salary: '$130k–$160k', apply_method: 'DM recruiter', summary: 'High-growth consumer brand hiring a performance marketing lead to own paid acquisition.', tags: ['performance-marketing', 'paid-social', 'remote'], sector: 'marketing', post_url: '#', author_name: 'Priya Nair', author_headline: 'Marketing Recruiter | Growth & Brand', author_linkedin_url: '#', raw_text: '', posted_at: new Date(Date.now() - 28800000).toISOString(), extracted_at: new Date().toISOString(), is_verified_job: true },
]

function splitLocations(jobs: JobPost[]): string[] {
  return [...new Set(
    jobs.flatMap((j) => {
      if (!j.location) return []
      return j.location.split(/[|,]/).map((l) => l.trim()).filter((l) => l.length > 0 && l.length < 40)
    })
  )].sort()
}

function inferWorkType(job: JobPost): WorkType | null {
  const text = `${job.location || ''} ${job.tags?.join(' ') || ''} ${job.title || ''}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'Hybrid'
  if (/\bremote\b/.test(text)) return 'Remote'
  if (/\bon.?site\b|in.?office\b|in.?person\b/.test(text)) return 'On-site'
  return null
}

export default function HomePage() {
  const [darkMode, setDarkMode] = useState(false)
  const [allJobs, setAllJobs] = useState<JobPost[]>(DEMO_JOBS)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [usingDemo, setUsingDemo] = useState(true)
  const [todayCount, setTodayCount] = useState(0)
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => { document.documentElement.classList.toggle('light', !darkMode) }, [darkMode])
  useEffect(() => { document.documentElement.classList.add('light') }, [])

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
        const today = new Date().toDateString()
        setTodayCount(data.jobs.filter((j: JobPost) => new Date(j.extracted_at).toDateString() === today).length)
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

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const displayJobs = allJobs.filter((job) => {
    if (filters.locations.length > 0) {
      if (!job.location) return false
      const jobLocs = job.location.split(/[|,]/).map((l) => l.trim().toLowerCase())
      if (!filters.locations.some((sel) => jobLocs.some((jl) => jl.includes(sel.toLowerCase()) || sel.toLowerCase().includes(jl)))) return false
    }
    if (filters.workTypes.length > 0) {
      const wt = inferWorkType(job)
      if (!wt || !filters.workTypes.includes(wt)) return false
    }
    return true
  })

  // Always count from full unfiltered allJobs for sidebar counts
  const sectorCounts = {
    all: allJobs.length,
    finance: allJobs.filter(j => j.sector === 'finance').length,
    tech: allJobs.filter(j => j.sector === 'tech').length,
    legal: allJobs.filter(j => j.sector === 'legal').length,
    marketing: allJobs.filter(j => j.sector === 'marketing').length,
  }

  const availableLocations = splitLocations(allJobs)
  const dm = darkMode
  const bg = dm ? '#0B1121' : '#F7F8FA'
  const surface = dm ? '#111827' : '#FFFFFF'
  const surfaceHover = dm ? '#1a2235' : '#F1F3F7'
  const border = dm ? '#1E2A3A' : '#E4E7ED'
  const textPrimary = dm ? '#F0F4FF' : '#0B1121'
  const textSecondary = dm ? '#8896AB' : '#5A6478'
  const textMuted = dm ? '#3D4F66' : '#9AA3B2'
  const accent = '#2563EB'
  const accentBg = dm ? 'rgba(37,99,235,0.12)' : 'rgba(37,99,235,0.08)'
  const pillBg = dm ? '#1a2235' : '#F1F3F7'

  const toggleWorkType = (wt: WorkType) => {
    const next = filters.workTypes.includes(wt)
      ? filters.workTypes.filter(w => w !== wt)
      : [...filters.workTypes, wt]
    setFilters({ ...filters, workTypes: next })
  }

  return (
    <div style={{ minHeight: '100vh', background: bg, transition: 'background 0.2s', fontFamily: "'Inter', sans-serif" }}>
      <header style={{ background: surface, borderBottom: `1px solid ${border}`, position: 'sticky', top: 0, zIndex: 100, boxShadow: dm ? 'none' : '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={15} color="#fff" fill="#fff" />
            </div>
            <span style={{ fontWeight: 700, fontSize: '15px', color: textPrimary, letterSpacing: '-0.03em' }}>
              unListed<span style={{ color: accent }}>Jobs</span>
            </span>
            {usingDemo && <span style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, background: accentBg, padding: '2px 6px', borderRadius: '3px' }}>Demo</span>}
          </div>
          {!usingDemo && todayCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: textSecondary }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              <span><strong style={{ color: textPrimary }}>{todayCount}</strong> new today</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: textMuted }}>{lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <button onClick={() => setDarkMode(!dm)} style={{ width: '32px', height: '32px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid ${border}`, cursor: 'pointer', color: textSecondary }}>
              {dm ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            <button onClick={fetchJobs} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '7px', background: accent, border: 'none', color: '#fff', fontSize: '12px', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'Scanning...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <div style={{ background: dm ? '#0D1526' : '#EEF2FF', borderBottom: `1px solid ${dm ? '#1a2540' : '#D6DFF8'}`, padding: '18px 24px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: textPrimary, letterSpacing: '-0.03em', margin: 0 }}>
              Find the jobs LinkedIn doesn't show you
            </h1>
            <p style={{ fontSize: '12px', color: textSecondary, margin: '3px 0 0' }}>Updated twice daily · Finance, Tech, Legal, Marketing · Global</p>
          </div>
          <div style={{ display: 'flex', gap: '20px' }}>
            {[{ label: 'Live jobs', value: displayJobs.length }, { label: 'Locations', value: availableLocations.length }, { label: 'Added today', value: todayCount }].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: '10px', color: textMuted, marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px', display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        {/* Sidebar */}
        <div ref={sidebarRef} style={{ width: '240px', flexShrink: 0, position: 'sticky', top: '76px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* Sector */}
          <div style={{ background: surface, borderRadius: '10px', border: `1px solid ${border}`, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px 6px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: textMuted }}>Sector</div>
            {SECTORS.map((s) => {
              const active = filters.sector === s.id
              const count = sectorCounts[s.id as keyof typeof sectorCounts] ?? 0
              return (
                <button key={s.id} onClick={() => setFilters({ ...filters, sector: s.id })} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '9px',
                  padding: '9px 14px', fontSize: '13px', fontWeight: active ? 600 : 400,
                  background: active ? accentBg : 'transparent',
                  border: 'none', borderLeft: active ? `3px solid ${accent}` : '3px solid transparent',
                  color: active ? accent : textSecondary, cursor: 'pointer', transition: 'all 0.1s', textAlign: 'left',
                }}>
                  <span style={{ color: active ? accent : textMuted }}>{s.icon}</span>
                  {s.label}
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: active ? accent : textMuted, fontFamily: "'DM Mono', monospace", opacity: 0.8 }}>{count}</span>
                </button>
              )
            })}
          </div>

          {/* Work Type */}
          <div style={{ background: surface, borderRadius: '10px', border: `1px solid ${border}`, padding: '10px 14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: textMuted, marginBottom: '10px' }}>Work Type</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {WORK_TYPES.map((wt) => {
                const active = filters.workTypes.includes(wt)
                return (
                  <button key={wt} onClick={() => toggleWorkType(wt)} style={{
                    display: 'flex', alignItems: 'center', gap: '9px', padding: '7px 10px',
                    borderRadius: '7px', fontSize: '12px', fontWeight: active ? 600 : 400,
                    cursor: 'pointer', background: active ? accentBg : pillBg,
                    border: `1px solid ${active ? accent : border}`,
                    color: active ? accent : textSecondary, transition: 'all 0.1s', textAlign: 'left',
                  }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${active ? accent : textMuted}`, background: active ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {active && <span style={{ color: '#fff', fontSize: '9px', fontWeight: 700, lineHeight: 1 }}>✓</span>}
                    </div>
                    {wt}
                  </button>
                )
              })}
            </div>
            {filters.workTypes.length > 0 && (
              <button onClick={() => setFilters({ ...filters, workTypes: [] })} style={{ marginTop: '8px', fontSize: '11px', color: textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
            )}
          </div>

          {/* Location */}
          <div style={{ background: surface, borderRadius: '10px', border: `1px solid ${border}`, padding: '10px 14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: textMuted, marginBottom: '8px' }}>Location</div>
            <FilterBar filters={filters} onChange={setFilters} total={displayJobs.length} availableLocations={availableLocations} darkMode={dm} sidebar />
          </div>
        </div>

        {/* Feed */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <svg style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: textMuted }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="text" placeholder="Search roles, companies, skills..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} style={{ width: '100%', padding: '9px 12px 9px 32px', background: surface, border: `1px solid ${border}`, borderRadius: '8px', color: textPrimary, fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <select value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'newest' | 'oldest' })} style={{ padding: '9px 12px', background: surface, border: `1px solid ${border}`, borderRadius: '8px', color: textSecondary, fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', color: textMuted }}>
              {displayJobs.length} {displayJobs.length === 1 ? 'role' : 'roles'} found
              {filters.sector !== 'all' && ` in ${SECTORS.find(s => s.id === filters.sector)?.label}`}
            </span>
            {(filters.locations.length > 0 || filters.workTypes.length > 0 || filters.search) && (
              <button onClick={() => setFilters(DEFAULT_FILTERS)} style={{ fontSize: '11px', color: accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Clear filters</button>
            )}
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[...Array(5)].map((_, i) => <div key={i} style={{ border: `1px solid ${border}`, borderRadius: '10px', height: '140px', background: surfaceHover }} />)}
            </div>
          ) : displayJobs.length === 0 ? (
            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: '12px', padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: textPrimary, marginBottom: '6px' }}>No roles match your filters</p>
              <p style={{ fontSize: '13px', color: textSecondary, marginBottom: '16px' }}>Try adjusting your sector, location, or work type</p>
              <button onClick={() => setFilters(DEFAULT_FILTERS)} style={{ padding: '8px 16px', background: accent, color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>Clear all filters</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {displayJobs.map((job, i) => <JobCard key={job.id} job={job} index={i} darkMode={dm} />)}
            </div>
          )}

          <div style={{ marginTop: '32px', paddingTop: '20px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '11px', color: textMuted }}>
            <span>Sourced from public LinkedIn posts · AI-classified · Always verify with the recruiter directly</span>
            <span>unlisted.jobs © {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        * { box-sizing: border-box; }
        input::placeholder { color: #9AA3B2; }
      `}</style>
    </div>
  )
}
