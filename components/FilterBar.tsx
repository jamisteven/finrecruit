'use client'
import { FilterState } from '@/types'
import { LocationDropdown } from './LocationDropdown'
import { SectorDropdown } from './SectorDropdown'

interface Props {
  filters: FilterState
  onChange: (f: FilterState) => void
  total: number
  availableLocations: string[]
  darkMode: boolean
  sidebar?: boolean
}

export function FilterBar({ filters, onChange, availableLocations, darkMode, sidebar }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch })

  if (sidebar) {
    // In sidebar mode just render the location dropdown
    return (
      <LocationDropdown
        locations={availableLocations}
        selected={filters.locations}
        onChange={(locs) => set({ locations: locs })}
      />
    )
  }

  // Legacy non-sidebar mode
  const dm = darkMode
  const surface = dm ? '#111827' : '#FFFFFF'
  const border = dm ? '#1E2A3A' : '#E4E7ED'
  const textMuted = dm ? '#3D4F66' : '#9AA3B2'

  return (
    <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px 20px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
      <SectorDropdown selected={filters.sector} onChange={(s) => set({ sector: s })} />
      <LocationDropdown locations={availableLocations} selected={filters.locations} onChange={(locs) => set({ locations: locs })} />
      <span style={{ fontSize: '12px', color: textMuted, marginLeft: 'auto' }}>{filters.locations.length > 0 ? `${filters.locations.length} location${filters.locations.length > 1 ? 's' : ''} selected` : 'All locations'}</span>
    </div>
  )
}
