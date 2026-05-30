'use client'
import { useState, useRef, useEffect } from 'react'
import { MapPin, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { groupLocations } from '@/lib/groupLocations'

interface Props {
  locations: string[]
  selected: string[]
  onChange: (locs: string[]) => void
}

export function LocationDropdown({ locations, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const grouped = groupLocations(locations)

  // When searching, flatten and filter all cities
  const isSearching = search.length > 0
  const flatFiltered = isSearching
    ? locations.filter((l) => l.toLowerCase().includes(search.toLowerCase()) && l !== 'Unknown' && l !== 'On-site')
    : []

  const toggle = (loc: string) => {
    onChange(selected.includes(loc) ? selected.filter((s) => s !== loc) : [...selected, loc])
  }

  const toggleCountry = (country: string, cities: string[]) => {
    const allSelected = cities.every((c) => selected.includes(c))
    if (allSelected) {
      onChange(selected.filter((s) => !cities.includes(s)))
    } else {
      onChange([...new Set([...selected, ...cities])])
    }
  }

  const toggleExpand = (country: string) => {
    setExpandedCountries((prev) => {
      const next = new Set(prev)
      next.has(country) ? next.delete(country) : next.add(country)
      return next
    })
  }

  const label = selected.length === 0
    ? 'All locations'
    : selected.length === 1
    ? selected[0]
    : `${selected.length} locations`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '7px 12px',
          background: selected.length > 0 ? 'rgba(59,158,235,0.1)' : 'var(--bg-secondary)',
          border: selected.length > 0 ? '1px solid #3B9EEB' : '1px solid var(--border)',
          borderRadius: '6px',
          color: selected.length > 0 ? '#3B9EEB' : 'var(--text-secondary)',
          fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'all 0.15s',
          minWidth: '160px', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <MapPin size={11} />
          <span>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {selected.length > 0 && (
            <span onClick={(e) => { e.stopPropagation(); onChange([]) }}
              style={{ display: 'flex', alignItems: 'center', color: '#3B9EEB', padding: '0 2px' }}>
              <X size={10} />
            </span>
          )}
          <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </div>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          width: '260px', maxHeight: '400px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          zIndex: 100, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <Search size={11} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                autoFocus
                type="text"
                placeholder="Search locations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)', borderRadius: '5px',
                  padding: '6px 8px 6px 26px', color: 'var(--text-primary)',
                  fontSize: '12px', outline: 'none',
                }}
              />
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {isSearching ? (
              // Flat search results
              flatFiltered.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>No locations found</div>
              ) : flatFiltered.map((loc) => (
                <CityRow key={loc} loc={loc} active={selected.includes(loc)} onToggle={toggle} />
              ))
            ) : (
              // Grouped by country
              grouped.map(({ country, flag, cities }) => {
                const expanded = expandedCountries.has(country)
                const allSelected = cities.every((c) => selected.includes(c))
                const someSelected = cities.some((c) => selected.includes(c))

                return (
                  <div key={country}>
                    {/* Country header */}
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', cursor: 'pointer',
                        background: someSelected ? 'rgba(59,158,235,0.05)' : 'transparent',
                        borderBottom: '1px solid var(--border-subtle, #151b26)',
                      }}
                    >
                      {/* Expand toggle */}
                      <div onClick={() => toggleExpand(country)} style={{ display: 'flex', alignItems: 'center', flex: 1, gap: '8px' }}>
                        <ChevronRight size={11} style={{
                          color: 'var(--text-muted)',
                          transform: expanded ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s', flexShrink: 0,
                        }} />
                        <span style={{ fontSize: '13px' }}>{flag}</span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: someSelected ? '#3B9EEB' : 'var(--text-secondary)' }}>
                          {country}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          {cities.length}
                        </span>
                      </div>
                      {/* Select all toggle */}
                      <div
                        onClick={() => toggleCountry(country, cities)}
                        style={{
                          width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0,
                          border: allSelected ? '1px solid #3B9EEB' : someSelected ? '1px solid #3B9EEB' : '1px solid var(--border)',
                          background: allSelected ? '#3B9EEB' : someSelected ? 'rgba(59,158,235,0.3)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}
                      >
                        {allSelected && <span style={{ color: '#0A0E13', fontSize: '9px', fontWeight: 700 }}>✓</span>}
                        {someSelected && !allSelected && <span style={{ color: '#3B9EEB', fontSize: '9px', fontWeight: 700 }}>−</span>}
                      </div>
                    </div>

                    {/* Cities */}
                    {expanded && cities.map((loc) => (
                      <CityRow key={loc} loc={loc} active={selected.includes(loc)} onToggle={toggle} indent />
                    ))}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          {selected.length > 0 && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{selected.length} selected</span>
              <button onClick={() => onChange([])} style={{ fontSize: '11px', color: '#3B9EEB', background: 'none', border: 'none', cursor: 'pointer' }}>
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CityRow({ loc, active, onToggle, indent = false }: { loc: string; active: boolean; onToggle: (l: string) => void; indent?: boolean }) {
  return (
    <div
      onClick={() => onToggle(loc)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: `7px 12px 7px ${indent ? '32px' : '12px'}`,
        cursor: 'pointer', fontSize: '12px',
        color: active ? '#3B9EEB' : 'var(--text-secondary)',
        background: active ? 'rgba(59,158,235,0.08)' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <div style={{
        width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0,
        border: active ? '1px solid #3B9EEB' : '1px solid var(--border)',
        background: active ? '#3B9EEB' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {active && <span style={{ color: '#0A0E13', fontSize: '9px', fontWeight: 700 }}>✓</span>}
      </div>
      {loc}
    </div>
  )
}
