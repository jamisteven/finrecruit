'use client'
import { FilterState, Seniority } from '@/types'
import { LocationDropdown } from './LocationDropdown'
import { SectorDropdown } from './SectorDropdown'

const SENIORITIES: Array<Seniority | 'All'> = [
  'All', 'Intern', 'Junior', 'Mid', 'Senior', 'VP', 'Director', 'MD', 'Partner', 'C-Suite',
]

interface Props {
  filters: FilterState
  onChange: (f: FilterState) => void
  total: number
  availableLocations: string[]
  darkMode: boolean
  sidebar?: boolean
}

export function FilterBar({ filters, onChange, total, availableLocations, darkMode, sidebar }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })

  const dm = darkMode
  const surface = dm ? '#111827' : '#FFFFFF'
  const border = dm ? '#1E2A3A' : '#E4E7ED'
  const textMuted = dm ? '#3D4F66' : '#9AA3B2'
  const textSecondary = dm ? '#8896AB' : '#5A6478'
  const textPrimary = dm ? '#F0F4FF' : '#0B1121'
  const accent = '#2563EB'
  const accentBg = dm ? 'rgba(37,99,235,0.12)' : 'rgba(37,99,235,0.08)'
  const pillBg = dm ? '#1a2235' : '#F1F3F7'

  if (sidebar) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Seniority */}
        <div style={{ background: surface, borderRadius: '10px', border: `1px solid ${border}`, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px 8px', fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: textMuted }}>
            Seniority
          </div>
          <div style={{ padding: '0 10px 10px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {SENIORITIES.map((s) => {
              const active = filters.seniority === s
              return (
                <button key={s} onClick={() => set({ seniority: s })} style={{
                  padding: '4px 9px', borderRadius: '5px', fontSize: '11px',
                  fontWeight: active ? 600 : 400, cursor: 'pointer',
                  background: active ? accent : pillBg,
                  border: `1px solid ${active ? accent : border}`,
                  color: active ? '#fff' : textSecondary,
                  transition: 'all 0.1s',
                }}>{s}</button>
              )
            })}
          </div>
        </div>

        {/* Location */}
        <div style={{ background: surface, borderRadius: '10px', border: `1px solid ${border}`, padding: '10px 14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: textMuted, marginBottom: '8px' }}>
            Location
          </div>
          <LocationDropdown
            locations={availableLocations}
            selected={filters.locations}
            onChange={(locs) => set({ locations: locs })}
          />
        </div>
      </div>
    )
  }

  // Non-sidebar (legacy) mode
  return (
    <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <SectorDropdown selected={filters.sector} onChange={(s) => set({ sector: s })} />
        <LocationDropdown locations={availableLocations} selected={filters.locations} onChange={(locs) => set({ locations: locs })} />
        <span style={{ fontSize: '12px', color: textMuted }}>{total} jobs</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {SENIORITIES.map((s) => {
          const active = filters.seniority === s
          return (
            <button key={s} onClick={() => set({ seniority: s })} style={{
              padding: '4px 12px', borderRadius: '4px', fontSize: '11px',
              fontWeight: active ? 600 : 400, cursor: 'pointer',
              background: active ? accent : pillBg,
              border: `1px solid ${active ? accent : border}`,
              color: active ? '#fff' : textSecondary,
            }}>{s}</button>
          )
        })}
      </div>
    </div>
  )
}
