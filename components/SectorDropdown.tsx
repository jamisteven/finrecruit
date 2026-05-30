'use client'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Sector } from '@/types'

const SECTORS: { id: Sector; label: string; emoji: string }[] = [
  { id: 'all',       label: 'All Sectors', emoji: '✦' },
  { id: 'finance',   label: 'Finance',     emoji: '📈' },
  { id: 'tech',      label: 'Tech',        emoji: '💻' },
  { id: 'legal',     label: 'Legal',       emoji: '⚖️' },
  { id: 'marketing', label: 'Marketing',   emoji: '📣' },
]

interface Props {
  selected: Sector
  onChange: (s: Sector) => void
}

export function SectorDropdown({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const active = SECTORS.find((s) => s.id === selected) || SECTORS[0]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '7px 12px',
          background: selected !== 'all' ? 'var(--gold-glow)' : 'var(--bg-secondary)',
          border: selected !== 'all' ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
          borderRadius: '6px',
          color: selected !== 'all' ? 'var(--gold)' : 'var(--text-secondary)',
          fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'all 0.15s',
          minWidth: '140px', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{active.emoji}</span>
          <span>{active.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {selected !== 'all' && (
            <span
              onClick={(e) => { e.stopPropagation(); onChange('all') }}
              style={{ display: 'flex', alignItems: 'center', color: 'var(--gold)', padding: '0 2px' }}
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
          width: '180px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          zIndex: 100, overflow: 'hidden',
        }}>
          {SECTORS.map((s) => {
            const isActive = selected === s.id
            return (
              <div
                key={s.id}
                onClick={() => { onChange(s.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', cursor: 'pointer', fontSize: '13px',
                  color: isActive ? 'var(--gold)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--gold-glow)' : 'transparent',
                  transition: 'background 0.1s',
                  fontWeight: isActive ? 600 : 400,
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <span>{s.emoji}</span>
                {s.label}
                {isActive && <span style={{ marginLeft: 'auto', fontSize: '10px' }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
