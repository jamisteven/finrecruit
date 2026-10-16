'use client'

import { useEffect, useRef, useState } from 'react'

type Suggestion = { phrase: string; count: number }

// A role field with live suggestions from /api/suggest-roles — titles we
// actually carry, matched at word starts, with counts. Replaces the native
// <datalist>, which only ever saw the 120 commonest titles and so offered one
// odd compound for "aml". Whatever is typed stays valid; suggestions are a
// convenience, not a gate.
export default function RoleInput({ value, onChange, placeholder, className = 'field' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [list, setList] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const picked = useRef<string | null>(null)

  useEffect(() => {
    const q = value.trim()
    // Don't re-open the list for the value they just picked
    if (q.length < 2 || picked.current === q) { setList([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/suggest-roles?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          const hits: Suggestion[] = (d?.suggestions ?? [])
            .filter((s: Suggestion) => s.phrase !== q.toLowerCase())
          setList(hits); setIdx(-1); setOpen(hits.length > 0)
        })
        .catch(() => {})
    }, 150)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [value])

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown) }
  }, [])

  const pick = (s: Suggestion) => {
    picked.current = s.phrase
    onChange(s.phrase)
    setOpen(false); setList([])
  }

  return (
    <div ref={wrapRef} className="role-wrap">
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { picked.current = null; onChange(e.target.value) }}
        onFocus={() => { if (list.length) setOpen(true) }}
        onKeyDown={(e) => {
          if (!open || list.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, -1)) }
          else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(list[idx]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && list.length > 0 && (
        <ul className="role-sug" role="listbox">
          {list.map((s, i) => (
            <li key={s.phrase} role="option" aria-selected={i === idx} className={i === idx ? 'on' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(s) }}>
              <span className="role-sug-t">{s.phrase}</span>
              <span className="role-sug-n">{s.count} {s.count === 1 ? 'role' : 'roles'}</span>
            </li>
          ))}
        </ul>
      )}
      <style>{`
        .role-wrap { position: relative; }
        .role-sug { position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 6px); margin: 0; padding: 6px;
          list-style: none; background: #fff; border: 1px solid #DED8CC; border-radius: 12px;
          box-shadow: 0 12px 32px rgba(28,27,25,.12); max-height: 320px; overflow-y: auto; }
        .role-sug li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
          padding: 9px 10px; border-radius: 8px; cursor: pointer; font-size: 15px; color: #1C1B19; }
        .role-sug li:hover, .role-sug li.on { background: #F6F2EA; }
        .role-sug-t::first-letter { text-transform: uppercase; }
        .role-sug-n { flex: none; font-size: 12px; color: #8A8378; font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  )
}
