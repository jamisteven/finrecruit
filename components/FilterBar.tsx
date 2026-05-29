'use client'
import { FilterState, Seniority } from '@/types'
import { Search, SlidersHorizontal, MapPin, X } from 'lucide-react'

const SENIORITIES: Array<Seniority | 'All'> = [
  'All', 'Intern', 'Junior', 'Mid', 'Senior', 'VP', 'Director', 'MD', 'Partner', 'C-Suite',
]

interface Props {
  filters: FilterState
  onChange: (f: FilterState) => void
  total: number
  availableLocations: string[]
}

export function FilterBar({ filters, onChange, total, availableLocations }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })
  const selectedLocations = filters.locations || []

  const toggleLocation = (loc: string) => {
    const next = selectedLocations.includes(loc)
      ? selectedLocations.filter((l) => l !== loc)
      : [...selectedLocations, loc]
    set({ locations: next })
  }

  return (
    <div style={{
      background: 'var(--bg-primary)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: '14px',
    }}>
      {/* Search + count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search roles, companies, keywords..."
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            style={{
              width: '100%', background: 'var(--bg-secondary)',
              border: '1px solid var(--border)', borderRadius: '6px',
              padding: '8px 12px 8px 30px', color: 'var(--text-primary)',
              fontSize: '13px', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <SlidersHorizontal size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{total} jobs</span>
        </div>
      </div>

      {/* Seniority pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {SENIORITIES.map((s) => {
          const active = filters.seniority === s
          return (
            <button key={s} onClick={() => set({ seniority: s })} style={{
              padding: '4px 12px', borderRadius: '4px', fontSize: '11px',
              fontWeight: active ? 600 : 400, letterSpacing: '0.04em', cursor: 'pointer',
              transition: 'all 0.15s',
              background: active ? 'var(--gold)' : 'var(--bg-secondary)',
              border: active ? '1px solid var(--gold)' : '1px solid var(--border)',
              color: active ? '#0A0E13' : 'var(--text-secondary)',
            }}>{s}</button>
          )
        })}
      </div>

      {/* Location pills */}
      {availableLocations.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <MapPin size={11} style={{ color: 'var(--gold-dim)' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Location</span>
            {selectedLocations.length > 0 && (
              <button onClick={() => set({ locations: [] })} style={{
                fontSize: '10px', color: 'var(--text-muted)', background: 'none',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px',
              }}>
                <X size={10} /> clear
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {availableLocations.map((loc) => {
              const active = selectedLocations.includes(loc)
              return (
                <button key={loc} onClick={() => toggleLocation(loc)} style={{
                  padding: '4px 10px', borderRadius: '4px', fontSize: '11px',
                  cursor: 'pointer', transition: 'all 0.15s',
                  background: active ? 'rgba(59,158,235,0.15)' : 'var(--bg-secondary)',
                  border: active ? '1px solid #3B9EEB' : '1px solid var(--border)',
                  color: active ? '#3B9EEB' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                }}>{loc}</button>
              )
            })}
          </div>
        </div>
      )}

      {/* Sort */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <select value={filters.sortBy} onChange={(e) => set({ sortBy: e.target.value as 'newest' | 'oldest' })} style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: '6px', padding: '7px 12px', color: 'var(--text-secondary)',
          fontSize: '12px', outline: 'none', cursor: 'pointer',
        }}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
    </div>
  )
}
