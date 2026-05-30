'use client'
import { useState, useRef, useEffect } from 'react'
import { MapPin, ChevronDown, Search, X } from 'lucide-react'

interface Props {
  locations: string[]
  selected: string[]
  onChange: (locs: string[]) => void
}

export function LocationDropdown({ locations, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = locations.filter((l) =>
    l.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (loc: string) => {
    onChange(selected.includes(loc) ? selected.filter((s) => s !== loc) : [...selected, loc])
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
            <span
              onClick={(e) => { e.stopPropagation(); onChange([]) }}
              style={{ display: 'flex', alignItems: 'center', color: '#3B9EEB', padding: '0 2px' }}
            >
              <X size={10} />
            </span>
          )}
          <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </div>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          width: '240px', maxHeight: '320px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          zIndex: 100, display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>
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

          {/* Options */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                No locations found
              </div>
            ) : (
              filtered.map((loc) => {
                const active = selected.includes(loc)
                return (
                  <div
                    key={loc}
                    onClick={() => toggle(loc)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', cursor: 'pointer', fontSize: '12px',
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
              })
            )}
          </div>

          {/* Footer */}
          {selected.length > 0 && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
