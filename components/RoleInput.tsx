'use client'

import { useEffect, useRef, useState } from 'react'
import { splitRole } from '@/lib/splitRole'

type Suggestion = { phrase: string; display?: string; count: number }

// A role field with live suggestions from /api/suggest-roles — titles we
// actually carry, matched at word starts, with counts. Once a role is chosen
// (picked from the list, or typed and confirmed with Enter / leaving the box)
// it sits in the box as a pill with an × to clear it. Text that reads as two
// roles in one box ("aml,kyc", "aml/kyc", "aml or kyc") gets an offer to
// split it across boxes, because a combined keyword matches nothing.
// Whatever is typed stays valid; suggestions are a convenience, not a gate.
export default function RoleInput({ value, onChange, onSplit, placeholder, className = 'field', slotsLeft = 0 }: {
  value: string
  onChange: (v: string) => void
  /** Called with the parts when the person accepts the split offer */
  onSplit?: (parts: string[]) => void
  placeholder?: string
  className?: string
  /** How many empty role boxes a split could spill into */
  slotsLeft?: number
}) {
  const [list, setList] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  // A committed value shows as a pill; typing or clearing returns to the input
  const [editing, setEditing] = useState(!value.trim())
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The value just chosen — no suggestions are fetched for it again
  const [picked, setPicked] = useState<string | null>(null)
  // What the person last typed here, to tell their keystrokes apart from a
  // value set from outside (a chip, a split, the saved roles loading)
  const [typed, setTyped] = useState(value)

  const parts = splitRole(value)
  const compound = parts.length > 1

  // A value set from outside lands as a pill, not as text to keep editing
  if (value !== typed) {
    setTyped(value)
    const t = value.trim()
    if (t && !compound) { setPicked(t); setEditing(false); setOpen(false); setList([]) }
  }

  useEffect(() => {
    const q = value.trim()
    if (!editing || q.length < 2 || picked === q || compound) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/suggest-roles?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          const hits: Suggestion[] = d?.suggestions ?? []
          setList(hits); setIdx(-1); setOpen(true)
        })
        .catch(() => {})
    }, 150)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [value, editing, compound, picked])

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown) }
  }, [])

  const commit = (v: string) => {
    const known = list.find((s) => s.phrase === v.trim().toLowerCase())
    const t = (known?.display ?? v).trim()
    setTyped(t)
    setPicked(t)
    onChange(t)
    setOpen(false); setList([])
    if (t && splitRole(t).length < 2) setEditing(false)
  }

  const clear = () => {
    setTyped('')
    setPicked(null)
    onChange('')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const edit = () => {
    setPicked(null)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const acceptSplit = () => {
    const keep = parts.slice(0, 1 + slotsLeft)
    setTyped(keep[0])
    setPicked(keep[0])
    onSplit?.(keep)
    setEditing(false)
  }

  if (!editing && value.trim()) {
    return (
      <div ref={wrapRef} className="role-wrap">
        <div className={`${className} role-pill-box`} onClick={edit}>
          <span className="role-pill">
            <span className="role-pill-t">{value}</span>
            <button type="button" className="role-pill-x" aria-label={`Remove ${value}`}
                    onClick={(e) => { e.stopPropagation(); clear() }}>×</button>
          </span>
        </div>
        <style>{STYLE}</style>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="role-wrap">
      <input
        ref={inputRef}
        className={`${className}${compound ? ' role-compound' : ''}`}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { setTyped(e.target.value); setPicked(null); onChange(e.target.value) }}
        onFocus={() => { if (list.length) setOpen(true) }}
        onBlur={() => { if (value.trim() && !compound) commit(value) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); return }
          if (open && !compound) {
            const last = list.some((s) => s.phrase === value.trim().toLowerCase()) ? list.length - 1 : list.length
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, last)); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, -1)); return }
            if (e.key === 'Enter' && idx >= 0) {
              e.preventDefault()
              commit(idx < list.length ? (list[idx].display ?? list[idx].phrase) : value)
              return
            }
          }
          if (e.key === 'Enter' && value.trim()) { e.preventDefault(); if (!compound) commit(value) }
        }}
      />
      {open && !compound && value.trim().length >= 2 && (
        <ul className="role-sug" role="listbox">
          {list.map((s, i) => (
            <li key={s.phrase} role="option" aria-selected={i === idx} className={i === idx ? 'on' : ''}
                onMouseDown={(e) => { e.preventDefault(); commit(s.display ?? s.phrase) }}>
              <span className="role-sug-t">{s.display ?? s.phrase}</span>
              <span className="role-sug-n">{s.count} {s.count === 1 ? 'role' : 'roles'}</span>
            </li>
          ))}
          {!list.some((s) => s.phrase === value.trim().toLowerCase()) && (
            <li role="option" aria-selected={idx === list.length} className={`role-sug-own${idx === list.length ? ' on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); commit(value) }}>
              <span className="role-sug-t">Use &ldquo;{value.trim()}&rdquo;</span>
              <span className="role-sug-n">{list.length ? 'as typed' : 'new — we\u2019ll start searching for it'}</span>
            </li>
          )}
        </ul>
      )}
      {compound && (
        <div className="role-split">
          <p>
            Looks like {parts.length === 2 ? 'two' : 'several'} separate searches —{' '}
            {parts.map((p, i) => <span key={i}><b>{p}</b>{i < parts.length - 1 ? (i === parts.length - 2 ? ' and ' : ', ') : ''}</span>)}.
            {' '}Each role needs its own box to match anything.
          </p>
          {onSplit && slotsLeft > 0 ? (
            <button type="button" className="role-split-btn" onClick={acceptSplit}>
              Put them in separate boxes{parts.length > 1 + slotsLeft ? ` (first ${1 + slotsLeft})` : ''}
            </button>
          ) : (
            <span className="role-split-hint">Keep one here and clear a box below for the other.</span>
          )}
        </div>
      )}
      <style>{STYLE}</style>
    </div>
  )
}

const STYLE = `
  .role-wrap { position: relative; }
  .role-sug { position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 6px); margin: 0; padding: 6px;
    list-style: none; background: #fff; border: 1px solid #DED8CC; border-radius: 12px;
    box-shadow: 0 12px 32px rgba(28,27,25,.12); max-height: 320px; overflow-y: auto; }
  .role-sug li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 9px 10px; border-radius: 8px; cursor: pointer; font-size: 15px; color: #1C1B19; }
  .role-sug li:hover, .role-sug li.on { background: #F6F2EA; }
  .role-sug-n { flex: none; font-size: 12px; color: #8A8378; font-variant-numeric: tabular-nums; }
  .role-sug-own { color: #2F55D4; }
  .role-sug-own:not(:first-child) { margin-top: 4px; border-top: 1px solid #EFEAE0; border-radius: 0 0 8px 8px; }
  .role-pill-box { display: flex; align-items: center; cursor: text; }
  .role-pill { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 34px; padding: 0 6px 0 14px;
    border-radius: 999px; background: #2F55D4; color: #fff; font-size: 15px; font-weight: 500; line-height: 1; }
  .role-pill-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role-pill-x { flex: none; width: 24px; height: 24px; border: 0; border-radius: 999px; background: rgba(255,255,255,.22);
    color: #fff; font-size: 16px; line-height: 1; cursor: pointer; padding: 0; }
  .role-pill-x:hover { background: rgba(255,255,255,.38); }
  .role-compound { border-color: #B8860B !important; }
  .role-split { margin-top: 8px; padding: 10px 12px; border-radius: 10px; background: #FBF4E4; border: 1px solid #EAD9A8;
    font-size: 13px; color: #5A4A1E; line-height: 1.45; }
  .role-split p { margin: 0 0 8px; }
  .role-split-btn { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #1C1B19; background: #1C1B19;
    color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
  .role-split-btn:hover { background: #333; }
  .role-split-hint { font-size: 12.5px; color: #8A6D2A; }
`
