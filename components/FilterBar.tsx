'use client'
import { FilterState, Seniority } from '@/types'
import { Search, SlidersHorizontal } from 'lucide-react'
import { LocationDropdown } from './LocationDropdown'

const SENIORITIES: Array<Seniority | 'All'> = [
  'All', 'Intern', 'Junior', 'Mid', 'Senior', 'VP', 'Director', 'MD', 'Partner', 'C-Suite',
]

interface Props {
  filters: FilterState
  onChange: (f: FilterState) => void
  total: number
  availableLocations: string[]
  darkMode: boolean
}

export function FilterBar({ filters, onChange, total, availableLocations, darkMode }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })

  return (
    <div style={{
      background: darkMode ? 'var(--bg-primary)' : '#ffffff',
      border: '1px solid var(--border)',
      borderRadius: '10px', padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: '14px',
    }}>
      {/* Search + location dropdown + count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search roles, companies, keywords..."
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            style={{
              width: '100%', background: darkMode ? 'var(--bg-secondary)' : '#f5f5f5',
              border: '1px solid var(--border)', borderRadius: '6px',
              padding: '8px 12px 8px 30px', color: 'var(--text-primary)',
              fontSize: '13px', outline: 'none',
            }}
          />
        </div>

        <LocationDropdown
          locations={availableLocations}
          selected={filters.locations}
          onChange={(locs) => set({ locations: locs })}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <SlidersHorizontal size={13} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{total} jobs</span>
        </div>
      </div>

      {/* Seniority + sort row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
          {SENIORITIES.map((s) => {
            const active = filters.seniority === s
            return (
              <button key={s} onClick={() => set({ seniority: s })} style={{
                padding: '4px 12px', borderRadius: '4px', fontSize: '11px',
                fontWeight: active ? 600 : 400, letterSpacing: '0.04em', cursor: 'pointer',
                transition: 'all 0.15s',
                background: active ? 'var(--gold)' : darkMode ? 'var(--bg-secondary)' : '#f0f0f0',
                border: active ? '1px solid var(--gold)' : '1px solid var(--border)',
                color: active ? '#0A0E13' : 'var(--text-secondary)',
              }}>{s}</button>
            )
          })}
        </div>

        <select value={filters.sortBy} onChange={(e) => set({ sortBy: e.target.value as 'newest' | 'oldest' })} style={{
          background: darkMode ? 'var(--bg-secondary)' : '#f0f0f0',
          border: '1px solid var(--border)', borderRadius: '6px',
          padding: '7px 12px', color: 'var(--text-secondary)',
          fontSize: '12px', outline: 'none', cursor: 'pointer',
        }}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
    </div>
  )
}
