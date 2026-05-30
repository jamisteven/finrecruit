'use client'
import { useEffect, useState, useCallback } from 'react'
import { JobPost, FilterState, Sector } from '@/types'
import { JobCard } from '@/components/JobCard'
import { FilterBar } from '@/components/FilterBar'
import { StatsBar } from '@/components/StatsBar'
import { RefreshCw, Sun, Moon } from 'lucide-react'

const SECTORS: { id: Sector; label: string; emoji: string }[] = [
  { id: 'all',       label: 'All',       emoji: '✦' },
  { id: 'finance',   label: 'Finance',   emoji: '📈' },
  { id: 'tech',      label: 'Tech',      emoji: '💻' },
  { id: 'legal',     label: 'Legal',     emoji: '⚖️' },
  { id: 'marketing', label: 'Marketing', emoji: '📣' },
]

const DEFAULT_FILTERS: FilterState = {
  sector: 'all', seniority: 'All', locations: [], search: '', sortBy: 'newest',
}

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

export default function HomePage() {
  const [darkMode, setDarkMode] = useState(false)
  const [allJobs, setAllJobs] = useState<JobPost[]>(DEMO_JOBS)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [usingDemo, setUsingDemo] = useState(true)

  // Apply dark/light class to html element
  useEffect(() => {
    document.documentElement.classList.toggle('light', !darkMode)
  }, [darkMode])

  // Default to light mode on mount
  useEffect(() => {
    document.documentElement.classList.add('light')
  }, [])

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.seniority !== 'All') params.set('seniority', filters.seniority)
      if (filters.search) params.set('search', filters.search)
      if (filters.sector !== 'all') params.set('sector', filters.sector)
      params.set('sortBy', filters.sortBy)
      params.set('limit', '200')

      const res = await fetch(`/api/jobs?${params}`)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      if (data.jobs?.length > 0) { setAllJobs(data.jobs); setUsingDemo(false) }
      else { setAllJobs(DEMO_JOBS); setUsingDemo(true) }
      setLastUpdated(new Date())
    } catch {
      setAllJobs(DEMO_JOBS); setUsingDemo(true)
    } finally { setLoading(false) }
  }, [filters.seniority, filters.search, filters.sector, filters.sortBy])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const displayJobs = allJobs.filter((job) => {
    if (filters.locations.length === 0) return true
    if (!job.location) return false
    const jobLocs = job.location.split(/[|,]/).map((l) => l.trim().toLowerCase())
    return filters.locations.some((sel) =>
      jobLocs.some((jl) => jl.includes(sel.toLowerCase()) || sel.toLowerCase().includes(jl))
    )
  })

  const availableLocations = splitLocations(allJobs)
  const activeSector = SECTORS.find((s) => s.id === filters.sector)

  const headerBg = darkMode ? 'var(--bg-primary)' : '#ffffff'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', transition: 'background 0.2s' }}>
      {/* Header */}
      <header style={{ background: headerBg, borderBottom: '1px solid var(--border)', padding: '0 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', background: 'var(--gold-glow)', border: '1px solid rgba(196,167,105,0.3)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>📡</div>
            <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
              Role<span style={{ color: 'var(--gold)' }}>Radar</span>
            </span>
            {usingDemo && (
              <span style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-dim)', background: 'var(--gold-glow)', border: '1px solid rgba(196,167,105,0.2)', padding: '2px 7px', borderRadius: '3px' }}>Demo</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {/* Dark/Light toggle */}
            <button onClick={() => setDarkMode(!darkMode)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px', borderRadius: '6px',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              cursor: 'pointer', color: 'var(--text-secondary)', transition: 'all 0.15s',
            }}>
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={fetchJobs} disabled={loading} style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: '6px', color: 'var(--text-secondary)', fontSize: '12px',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
            }}>
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="gold-line" />

      {/* Sector tab bar */}
      <div style={{ background: headerBg, borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex' }}>
          {SECTORS.map((s) => {
            const active = filters.sector === s.id
            return (
              <button key={s.id} onClick={() => setFilters({ ...filters, sector: s.id })} style={{
                padding: '12px 18px', fontSize: '13px', fontWeight: active ? 600 : 400,
                cursor: 'pointer', background: 'none', border: 'none',
                borderBottom: active ? '2px solid var(--gold)' : '2px solid transparent',
                color: active ? 'var(--gold)' : 'var(--text-secondary)',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
              }}>
                <span>{s.emoji}</span>{s.label}
              </button>
            )
          })}
        </div>
      </div>

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: '4px' }}>
            {activeSector?.id === 'all' ? 'Hidden jobs across all sectors' : `Hidden ${activeSector?.label} jobs`}
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Recruiters post jobs as regular LinkedIn posts, not in the Jobs section. RoleRadar surfaces them automatically.
          </p>
        </div>

        <StatsBar jobs={displayJobs} />

        <FilterBar
          filters={filters}
          onChange={setFilters}
          total={displayJobs.length}
          availableLocations={availableLocations}
          darkMode={darkMode}
        />

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '8px', height: '130px', opacity: 0.5 }} />
            ))}
          </div>
        ) : displayJobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '15px', marginBottom: '8px' }}>No jobs match your filters</p>
            <button onClick={() => setFilters(DEFAULT_FILTERS)} style={{ fontSize: '12px', color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer' }}>
              Clear all filters
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {displayJobs.map((job, i) => <JobCard key={job.id} job={job} index={i} darkMode={darkMode} />)}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '20px', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <span>Posts sourced from public LinkedIn. Classified by AI — verify directly with recruiter.</span>
          <span>RoleRadar © {new Date().getFullYear()}</span>
        </div>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
