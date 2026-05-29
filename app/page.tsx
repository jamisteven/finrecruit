'use client'
import { useEffect, useState, useCallback } from 'react'
import { JobPost, FilterState } from '@/types'
import { JobCard } from '@/components/JobCard'
import { FilterBar } from '@/components/FilterBar'
import { StatsBar } from '@/components/StatsBar'
import { RefreshCw, Link } from 'lucide-react'

const DEFAULT_FILTERS: FilterState = {
  seniority: 'All',
  location: '',
  search: '',
  sortBy: 'newest',
}

// Demo seed data shown before real data loads / for dev
const DEMO_JOBS: JobPost[] = [
  {
    id: '1',
    title: 'Equity Research Analyst — TMT',
    company: 'Tier 1 Hedge Fund',
    location: 'London',
    seniority: 'Senior',
    salary: '£120k–£160k + carry',
    apply_method: 'DM recruiter on LinkedIn',
    summary: 'Long/short equity fund seeking a TMT-focused analyst with 4–7 years buyside experience. Deep sector expertise and strong modelling skills required.',
    tags: ['hedge-fund', 'equities', 'tmt', 'london', 'long-short'],
    post_url: '#',
    author_name: 'Sarah Mitchell',
    author_headline: 'Executive Search | Hedge Funds & Asset Management',
    author_linkedin_url: '#',
    raw_text: '',
    posted_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    extracted_at: new Date().toISOString(),
    is_verified_job: true,
  },
  {
    id: '2',
    title: 'Private Credit Associate',
    company: 'Pan-European Credit Fund',
    location: 'Paris / London',
    seniority: 'Mid',
    salary: null,
    apply_method: 'Email CV to recruiter',
    summary: 'Growing direct lending platform hiring an associate with 2–4 years of leveraged finance or restructuring experience from a bulge bracket or elite boutique.',
    tags: ['private-credit', 'direct-lending', 'leveraged-finance', 'paris', 'london'],
    post_url: '#',
    author_name: 'Marcus Dubois',
    author_headline: 'Alternative Investments Recruiter | Private Credit & PE',
    author_linkedin_url: '#',
    raw_text: '',
    posted_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    extracted_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    is_verified_job: true,
  },
  {
    id: '3',
    title: 'Quant Researcher — Crypto Systematic',
    company: 'Crypto Trading Firm',
    location: 'Remote / Singapore',
    seniority: 'Senior',
    salary: '$200k–$400k + PnL share',
    apply_method: 'DM or apply via link in post',
    summary: 'Systematic crypto fund looking for a quant researcher to develop alpha-generating strategies. Strong Python and statistics background essential.',
    tags: ['quant', 'crypto', 'systematic', 'remote', 'singapore', 'python'],
    post_url: '#',
    author_name: 'Alex Chen',
    author_headline: 'Fintech & Quant Finance Recruiter',
    author_linkedin_url: '#',
    raw_text: '',
    posted_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    extracted_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    is_verified_job: true,
  },
  {
    id: '4',
    title: 'Investment Banking Analyst — M&A',
    company: 'Elite Boutique IB',
    location: 'New York',
    seniority: 'Junior',
    salary: '$110k base + bonus',
    apply_method: 'Send CV + cover note via DM',
    summary: 'Elite boutique M&A advisory seeking a first-year analyst. Candidates from top undergrad programs with strong modelling and deal experience preferred.',
    tags: ['investment-banking', 'ma', 'analyst', 'new-york', 'bulge-bracket'],
    post_url: '#',
    author_name: 'Jennifer Park',
    author_headline: 'Financial Services Headhunter | IB, PE & VC',
    author_linkedin_url: '#',
    raw_text: '',
    posted_at: new Date(Date.now() - 3600000 * 14).toISOString(),
    extracted_at: new Date(Date.now() - 3600000 * 14).toISOString(),
    is_verified_job: true,
  },
  {
    id: '5',
    title: 'Managing Director — Fixed Income Sales',
    company: 'Major Bank (name withheld)',
    location: 'Dubai',
    seniority: 'MD',
    salary: null,
    apply_method: 'Confidential — contact recruiter directly',
    summary: 'Confidential mandate for a senior FI sales professional to cover GCC institutional clients. Existing book of business and strong regional relationships essential.',
    tags: ['fixed-income', 'sales', 'md', 'dubai', 'gcc', 'senior'],
    post_url: '#',
    author_name: 'James Al-Rashid',
    author_headline: 'Senior Recruiter | Capital Markets & Fixed Income',
    author_linkedin_url: '#',
    raw_text: '',
    posted_at: new Date(Date.now() - 86400000).toISOString(),
    extracted_at: new Date(Date.now() - 86400000).toISOString(),
    is_verified_job: true,
  },
  {
    id: '6',
    title: 'VP Compliance — Asset Management',
    company: 'Global Asset Manager',
    location: 'Frankfurt',
    seniority: 'VP',
    salary: '€110k–€135k',
    apply_method: 'Apply via link in comments',
    summary: 'Leading asset manager expanding compliance team ahead of DORA/SFDR implementation. CISI or equivalent qualification required, 6+ years experience.',
    tags: ['compliance', 'asset-management', 'frankfurt', 'regulatory', 'sfdr', 'vp'],
    post_url: '#',
    author_name: 'Hannah Weber',
    author_headline: 'Financial Regulation & Compliance Recruiter | DACH',
    author_linkedin_url: '#',
    raw_text: '',
    posted_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    extracted_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    is_verified_job: true,
  },
]

export default function HomePage() {
  const [jobs, setJobs] = useState<JobPost[]>(DEMO_JOBS)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [usingDemo, setUsingDemo] = useState(true)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.seniority !== 'All') params.set('seniority', filters.seniority)
      if (filters.location) params.set('location', filters.location)
      if (filters.search) params.set('search', filters.search)
      params.set('sortBy', filters.sortBy)
      params.set('limit', '100')

      const res = await fetch(`/api/jobs?${params}`)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      if (data.jobs && data.jobs.length > 0) {
        setJobs(data.jobs)
        setUsingDemo(false)
      } else {
        // Fall back to filtered demo data
        setJobs(filterDemo(DEMO_JOBS, filters))
        setUsingDemo(true)
      }
      setLastUpdated(new Date())
    } catch {
      setJobs(filterDemo(DEMO_JOBS, filters))
      setUsingDemo(true)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Header */}
      <header style={{
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '28px', height: '28px',
              background: 'var(--gold-glow)',
              border: '1px solid rgba(196,167,105,0.3)',
              borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Link size={14} style={{ color: 'var(--gold)' }} />
            </div>
            <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              FinRecruit<span style={{ color: 'var(--gold)' }}>Feed</span>
            </span>
            {usingDemo && (
              <span style={{
                fontSize: '10px', fontWeight: 500, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--gold-dim)',
                background: 'var(--gold-glow)', border: '1px solid rgba(196,167,105,0.2)',
                padding: '2px 7px', borderRadius: '3px',
              }}>
                Demo
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button
              onClick={fetchJobs}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Gold line */}
      <div className="gold-line" />

      {/* Body */}
      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Hero */}
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: '4px' }}>
            Finance jobs hidden in LinkedIn posts
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Recruiters post jobs as regular posts, not in the Jobs section. We surface them automatically, updated every 6 hours.
          </p>
        </div>

        {/* Stats */}
        <StatsBar jobs={jobs} />

        {/* Filters */}
        <FilterBar filters={filters} onChange={setFilters} total={jobs.length} />

        {/* Job list */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                height: '130px',
                opacity: 0.5,
              }} />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '15px', marginBottom: '8px' }}>No jobs match your filters</p>
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              style={{ fontSize: '12px', color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {jobs.map((job, i) => (
              <JobCard key={job.id} job={job} index={i} />
            ))}
          </div>
        )}

        {/* Footer note */}
        <div style={{
          borderTop: '1px solid var(--border)',
          paddingTop: '20px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          <span>Posts sourced from public LinkedIn. Classified by AI — verify directly with recruiter.</span>
          <span>FinRecruitFeed © {new Date().getFullYear()}</span>
        </div>
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

function filterDemo(jobs: JobPost[], filters: FilterState): JobPost[] {
  return jobs
    .filter((j) => filters.seniority === 'All' || j.seniority === filters.seniority)
    .filter((j) => !filters.location || j.location?.toLowerCase().includes(filters.location.toLowerCase()))
    .filter((j) => !filters.search ||
      j.title.toLowerCase().includes(filters.search.toLowerCase()) ||
      (j.company || '').toLowerCase().includes(filters.search.toLowerCase()) ||
      j.summary.toLowerCase().includes(filters.search.toLowerCase())
    )
    .sort((a, b) => filters.sortBy === 'newest'
      ? new Date(b.extracted_at).getTime() - new Date(a.extracted_at).getTime()
      : new Date(a.extracted_at).getTime() - new Date(b.extracted_at).getTime()
    )
}
