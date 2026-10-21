'use client'

// Small chart kit for /analytics: inline SVG / CSS, no libraries.
// Colours follow the dataviz palette (blue, orange, aqua in that order, grey for context); text always
// wears the ink tokens, never the series colour. Every chart sits in a ChartCard, which gives it a
// table view and a CSV button, so no number is reachable only by hovering.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { toCsv } from '@/lib/csv'

export type Series = { key: string; label: string; color: string }
export type ChartRow = { x: string; tip: string; v: Record<string, number> }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export const COLORS = { blue: 'var(--s1)', orange: 'var(--s2)', aqua: 'var(--s3)', grey: 'var(--s-grey)', pale: 'var(--s-pale)' }

// ------------------------------------------------------------------ helpers

export const fmtN = (n: number) => (Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(0)}K` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}K` : Number.isInteger(n) ? String(n) : n.toFixed(1))
export const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function niceScale(max: number) {
  const raw = Math.max(1, max) / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p)
  return { step, top: Math.max(step, Math.ceil(max / step) * step) }
}
function movingAvg(xs: number[], k: number) {
  return xs.map((_, i) => { const s = xs.slice(Math.max(0, i - k + 1), i + 1); return s.reduce((a, b) => a + b, 0) / s.length })
}
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((es) => setW(Math.max(240, Math.round(es[0].contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
function topRounded(x: number, y: number, w: number, h: number, r0: number) {
  const r = Math.max(0, Math.min(r0, w / 2, h))
  return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`
}
export function downloadCsv(name: string, rows: Row[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `backchannel-${name}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ------------------------------------------------------------------ card with table + csv

export function ChartCard({ title, sub, rows, csv, legend, children, className = '' }: {
  title: string; sub?: ReactNode; rows?: Row[]; csv?: string; legend?: Series[]; children: ReactNode; className?: string
}) {
  const [table, setTable] = useState(false)
  const cols = rows?.length ? Object.keys(rows[0]) : []
  return (
    <div className={`an-card an-chartcard ${className}`}>
      <div className="an-card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p className="an-sub2">{sub}</p>}
        </div>
        {rows && rows.length > 0 && (
          <div className="an-card-tools">
            <div className="an-seg an-seg-sm" role="group" aria-label="View">
              <button type="button" className={!table ? 'on' : ''} onClick={() => setTable(false)}>Chart</button>
              <button type="button" className={table ? 'on' : ''} onClick={() => setTable(true)}>Table</button>
            </div>
            {csv && <button type="button" className="an-btn" onClick={() => downloadCsv(csv, rows)}>CSV</button>}
          </div>
        )}
      </div>
      {legend && legend.length > 1 && !table && <Legend items={legend} />}
      {table && rows ? (
        <div className="an-tablewrap">
          <table className="an-compact">
            <thead><tr>{cols.map((c) => <th key={c} className={typeof rows[0][c] === 'number' ? 'num' : ''}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 400).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </div>
  )
}

export function Legend({ items }: { items: Series[] }) {
  return (
    <ul className="an-legend">
      {items.map((s) => <li key={s.key}><i style={{ background: s.color }} />{s.label}</li>)}
    </ul>
  )
}

// ------------------------------------------------------------------ time / category chart

export function Chart({ rows, series, kind = 'columns', avg = false, area = false, height = 200, hl, label, valueFmt = fmtN }: {
  rows: ChartRow[]; series: Series[]; kind?: 'columns' | 'stacked' | 'line'; avg?: boolean; area?: boolean
  height?: number; hl?: number[]; label: string; valueFmt?: (n: number) => string
}) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const ml = 38, mr = 10, mt = 10, mb = 24
  const pw = Math.max(60, w - ml - mr), ph = height - mt - mb
  const n = rows.length
  const cols = kind === 'columns' ? series.slice(0, 1) : series
  const totals = rows.map((r) => (kind === 'stacked' ? cols.reduce((s, k) => s + (r.v[k.key] || 0), 0) : Math.max(0, ...cols.map((k) => r.v[k.key] || 0))))
  const avgVals = avg && kind === 'columns' ? movingAvg(rows.map((r) => r.v[series[0].key] || 0), 7) : null
  const { top, step } = niceScale(Math.max(1, ...totals, ...(avgVals ?? [0])))
  const y = (v: number) => mt + ph - (v / top) * ph
  const band = pw / Math.max(1, n)
  const xc = (i: number) => ml + band * (i + 0.5)
  const barW = Math.max(2, Math.min(24, band - 2))
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const longest = Math.max(...rows.map((r) => r.x.length), 1)
  const every = Math.max(1, Math.ceil((longest * 6.6 + 12) / band))
  const hl_ = hl ? new Set(hl) : null

  const move = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))))
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); e.preventDefault() }
    if (e.key === 'ArrowLeft') { setHover((h) => Math.max(0, (h ?? n) - 1)); e.preventDefault() }
    if (e.key === 'Escape') setHover(null)
  }
  const hr = hover !== null ? rows[hover] : null
  const flip = hover !== null && xc(hover) > w * 0.55

  return (
    <div ref={ref} className="an-chart" style={{ height }}>
      <svg width={w} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={key} onBlur={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ml} x2={w - mr} y1={y(t)} y2={y(t)} className={t === 0 ? 'ax' : 'gr'} />
            <text x={ml - 6} y={y(t) + 4} textAnchor="end" className="tk">{fmtN(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => ((n - 1 - i) % every === 0 ? <text key={i} x={xc(i)} y={height - 7} textAnchor="middle" className="tk">{r.x}</text> : null))}
        {hover !== null && <rect x={xc(hover) - band / 2} y={mt} width={band} height={ph} className="hv" />}

        {kind !== 'line' && rows.map((r, i) => {
          const dim = hl_ && !hl_.has(i)
          const live = cols.filter((k) => (r.v[k.key] || 0) > 0)
          let cum = 0
          return (
            <g key={i} style={{ opacity: dim ? 0.38 : 1 }}>
              {live.map((k, j) => {
                const v = r.v[k.key] || 0
                const yTop = y(cum + v), yBase = y(cum) - (cum > 0 ? 2 : 0)
                const h = Math.max(1, yBase - yTop)
                cum += v
                return <path key={k.key} d={topRounded(xc(i) - barW / 2, yTop, barW, h, j === live.length - 1 ? 4 : 0)} style={{ fill: k.color }} />
              })}
            </g>
          )
        })}

        {kind === 'line' && (() => {
          const pts = (k: Series) => rows.map((r, i) => `${xc(i).toFixed(1)},${y(r.v[k.key] || 0).toFixed(1)}`)
          return (
            <>
              {area && cols[0] && <path d={`M${xc(0)},${y(0)}L${pts(cols[0]).join('L')}L${xc(n - 1)},${y(0)}Z`} style={{ fill: cols[0].color, opacity: 0.1 }} />}
              {cols.map((k) => <polyline key={k.key} points={pts(k).join(' ')} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: k.color }} />)}
              {cols.map((k) => <circle key={k.key} cx={xc(n - 1)} cy={y(rows[n - 1]?.v[k.key] || 0)} r={4} strokeWidth={2} className="dot" style={{ fill: k.color }} />)}
              {hover !== null && cols.map((k) => <circle key={k.key} cx={xc(hover)} cy={y(rows[hover].v[k.key] || 0)} r={4} strokeWidth={2} className="dot" style={{ fill: k.color }} />)}
            </>
          )
        })()}

        {avgVals && <polyline points={avgVals.map((v, i) => `${xc(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="avg" />}
        <rect x={ml} y={mt} width={pw} height={ph} fill="transparent" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} />
      </svg>
      {hr && hover !== null && (
        <div className="an-tip" style={flip ? { right: w - xc(hover) + 14, top: 4 } : { left: xc(hover) + 14, top: 4 }} role="status">
          <div className="an-tip-h">{hr.tip}</div>
          {cols.map((k) => <div key={k.key} className="an-tip-r"><i style={{ background: k.color }} /><b>{valueFmt(hr.v[k.key] || 0)}</b><span>{k.label}</span></div>)}
          {kind === 'stacked' && cols.length > 1 && <div className="an-tip-r an-tip-t"><b>{valueFmt(totals[hover])}</b><span>total</span></div>}
          {avgVals && <div className="an-tip-r"><i className="avgkey" /><b>{valueFmt(+avgVals[hover].toFixed(1))}</b><span>7-day average</span></div>}
        </div>
      )}
      {avg && <span className="an-avgnote"><i className="avgkey" /> 7-day average</span>}
    </div>
  )
}

// ------------------------------------------------------------------ tiles

export function Spark({ values }: { values: number[] }) {
  const W = 84, H = 26, max = Math.max(1, ...values)
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (W - 6) + 3, H - 4 - (v / max) * (H - 8)])
  return (
    <svg className="an-spark" width={W} height={H} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="sp" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} className="spd" />}
    </svg>
  )
}

/** Last 7 days against the 7 before, for a daily series. */
export function weekOverWeek(values: number[]) {
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
  const now = sum(values.slice(-7)), prev = sum(values.slice(-14, -7))
  return { now, prev, pct: prev > 0 ? Math.round((100 * (now - prev)) / prev) : null }
}

export function Tile({ value, label, delta, spark }: { value: ReactNode; label: ReactNode; delta?: { pct: number | null; now: number; prev: number }; spark?: number[] }) {
  return (
    <div className="an-tile">
      <div className="an-tile-top"><b>{value}</b>{spark && <Spark values={spark} />}</div>
      <span>{label}</span>
      {delta && (
        <small className="an-delta">
          {delta.pct === null ? <>{delta.prev === 0 && delta.now > 0 ? 'new this week' : 'no change data'}</> : (
            <><span aria-hidden="true" className={delta.pct > 0 ? 'up' : delta.pct < 0 ? 'down' : ''}>{delta.pct > 0 ? '▲' : delta.pct < 0 ? '▼' : '–'}</span> {delta.pct > 0 ? '+' : ''}{delta.pct}% vs previous 7 days ({delta.prev})</>
          )}
        </small>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ horizontal bars, funnel, heatmap

export function HBars({ rows, format = fmtN, color = 'var(--s1)', max, empty = 'Nothing yet' }: {
  rows: { label: string; value: number; note?: string; color?: string }[]; format?: (n: number) => string; color?: string; max?: number; empty?: string
}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) return <p className="an-muted">{empty}</p>
  return (
    <ul className="an-hbars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`}>
          <span className="hb-l">{r.label}</span>
          <span className="hb-t"><i style={{ width: `${Math.max(1.5, (100 * r.value) / m)}%`, background: r.color ?? color }} /></span>
          <b className="hb-v">{format(r.value)}</b>
        </li>
      ))}
    </ul>
  )
}

const FUNNEL = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1)
  return (
    <ol className="an-fun">
      {steps.map((s, i) => (
        <li key={s.label} title={`${s.label}: ${s.value}`}>
          <span className="fn-l">{s.label}</span>
          <span className="fn-t"><i style={{ width: `${Math.max(1.5, (100 * s.value) / top)}%`, background: FUNNEL[Math.min(i, FUNNEL.length - 1)] }} /></span>
          <b className="fn-v">{s.value}</b>
          <small>{i ? `${Math.round((100 * s.value) / Math.max(1, steps[i - 1].value))}% of previous` : '100%'}</small>
        </li>
      ))}
    </ol>
  )
}

const RAMP = ['#EFEBE1', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']
export function Heatmap({ matrix, rowLabels, unit, hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00` }: {
  matrix: number[][]; rowLabels: string[]; unit: string; hourLabel?: (h: number) => string
}) {
  const [hv, setHv] = useState<[number, number] | null>(null)
  const max = Math.max(1, ...matrix.flat())
  const shade = (v: number) => (v <= 0 ? RAMP[0] : RAMP[1 + Math.min(RAMP.length - 2, Math.floor((v / max) * (RAMP.length - 1)))])
  return (
    <div className="an-heat" onPointerLeave={() => setHv(null)}>
      <div className="hm-grid" role="img" aria-label={`${unit} by weekday and hour`}>
        {matrix.map((row, d) => (
          <div key={d} className="hm-row">
            <span className="hm-l">{rowLabels[d]}</span>
            {row.map((v, h) => (
              <i key={h} tabIndex={0} className={hv && hv[0] === d && hv[1] === h ? 'on' : ''} style={{ background: shade(v) }}
                title={`${rowLabels[d]} ${hourLabel(h)}: ${v} ${unit}`} onPointerEnter={() => setHv([d, h])} onFocus={() => setHv([d, h])} />
            ))}
          </div>
        ))}
        <div className="hm-row hm-x"><span className="hm-l" />{Array.from({ length: 24 }, (_, h) => <em key={h}>{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</em>)}</div>
      </div>
      <p className="hm-read">{hv ? <><b>{matrix[hv[0]][hv[1]]}</b> {unit} · {rowLabels[hv[0]]} {hourLabel(hv[1])}–{hourLabel((hv[1] + 1) % 24)}</> : <span className="an-muted-inline">Hover a cell · darker = more {unit}</span>}</p>
    </div>
  )
}

// ------------------------------------------------------------------ styles

export const CHART_CSS = `
.an-page { --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s-grey:#B9B2A2; --s-pale:#E4DFD2; --grid:#E8E3D6; --up:#0A7A3D; --down:#B3261E; }
.an-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
.an-card-head h2 { margin:0; }
.an-sub2 { margin:2px 0 0; color:var(--ink-3); font-size:12.5px; line-height:1.45; max-width:62ch; }
.an-card-tools { display:flex; gap:8px; align-items:center; }
.an-seg-sm button { padding:4px 9px; font-size:12px; }
.an-btn { border:1px solid var(--hair); background:var(--surface); color:var(--ink-2); font:inherit; font-size:12px; font-weight:600; padding:5px 10px; border-radius:8px; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; }
.an-btn:hover { border-color:var(--ink-3); color:var(--ink); }
.an-btn.primary { background:var(--ink); border-color:var(--ink); color:#fff; }
.an-tablewrap { max-height:300px; overflow:auto; margin-top:6px; }
.an-legend { list-style:none; margin:4px 0 2px; padding:0; display:flex; gap:16px; flex-wrap:wrap; font-size:12.5px; color:var(--ink-2); }
.an-legend li { display:inline-flex; align-items:center; gap:6px; }
.an-legend i { width:10px; height:10px; border-radius:3px; display:inline-block; }
.an-chart { position:relative; width:100%; }
.an-chart svg { display:block; overflow:visible; }
.an-chart svg:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:6px; }
.an-chart .gr { stroke:var(--grid); stroke-width:1; }
.an-chart .ax { stroke:var(--hair); stroke-width:1; }
.an-chart .tk { fill:var(--ink-3); font-size:11px; font-variant-numeric:tabular-nums; }
.an-chart .hv { fill:var(--ink); opacity:.05; }
.an-chart .dot { stroke:var(--surface); }
.an-chart .avg { stroke:var(--ink); opacity:.75; }
.an-avgnote { position:absolute; right:10px; top:-18px; font-size:11.5px; color:var(--ink-3); display:inline-flex; align-items:center; gap:6px; }
.avgkey { display:inline-block; width:14px; height:0; border-top:2px solid var(--ink); opacity:.75; }
.an-tip { position:absolute; z-index:5; pointer-events:none; min-width:140px; padding:8px 10px; border:1px solid var(--hair); border-radius:10px; background:var(--surface); box-shadow:0 6px 20px -8px rgba(25,23,19,.28); font-size:12.5px; }
.an-tip-h { color:var(--ink-2); font-size:11.5px; margin-bottom:4px; }
.an-tip-r { display:flex; align-items:center; gap:7px; line-height:1.6; }
.an-tip-r i { width:12px; height:3px; border-radius:2px; flex:none; }
.an-tip-r b { font-variant-numeric:tabular-nums; min-width:28px; }
.an-tip-r span { color:var(--ink-2); }
.an-tip-t { border-top:1px solid var(--hair); margin-top:3px; padding-top:3px; }
.an-tip-t b { margin-left:19px; }
.an-tile-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.an-spark .sp { stroke:var(--s-grey); } .an-spark .spd { fill:var(--s1); stroke:var(--surface); stroke-width:2; }
.an-delta { color:var(--ink-3); font-size:11.5px; }
.an-delta .up { color:var(--up); } .an-delta .down { color:var(--down); }
.an-hbars { list-style:none; margin:4px 0 0; padding:0; display:grid; gap:7px; }
.an-hbars li { display:grid; grid-template-columns:minmax(80px, 38%) 1fr auto; gap:10px; align-items:center; font-size:13px; }
.hb-l { color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hb-t { height:10px; background:transparent; display:block; }
.hb-t i { display:block; height:10px; border-radius:0 4px 4px 0; }
.hb-v { font-variant-numeric:tabular-nums; min-width:32px; text-align:right; }
.an-fun { list-style:none; margin:4px 0 0; padding:0; display:grid; gap:10px; }
.an-fun li { display:grid; grid-template-columns:120px 1fr auto 118px; gap:10px; align-items:center; font-size:13px; }
.fn-t { display:block; height:18px; } .fn-t i { display:block; height:18px; border-radius:0 4px 4px 0; }
.fn-v { font-family:var(--font-fraunces), Georgia, serif; font-weight:500; font-size:18px; min-width:34px; text-align:right; }
.an-fun small { color:var(--ink-3); text-align:right; }
.hm-grid { display:grid; gap:3px; }
.hm-row { display:grid; grid-template-columns:34px repeat(24, minmax(0, 1fr)); gap:3px; align-items:center; }
.hm-row i { display:block; height:22px; border-radius:4px; cursor:default; outline-offset:1px; }
.hm-row i.on, .hm-row i:focus-visible { outline:2px solid var(--ink); }
.hm-l { font-size:11.5px; color:var(--ink-3); }
.hm-x em { font-style:normal; font-size:10.5px; color:var(--ink-3); text-align:center; overflow:visible; white-space:nowrap; }
.hm-read { margin:8px 0 0; font-size:12.5px; color:var(--ink-2); min-height:18px; }
.an-insight { margin:0; padding:12px 14px; border-radius:12px; background:var(--accent-soft); color:#1a3368; font-size:13.5px; line-height:1.55; }
.an-insight b { font-weight:600; }
.an-export { position:relative; }
.an-export summary { list-style:none; cursor:pointer; }
.an-export summary::-webkit-details-marker { display:none; }
.an-export-menu { position:absolute; right:0; top:calc(100% + 6px); z-index:20; width:min(420px, 92vw); max-height:70vh; overflow:auto; padding:8px; border:1px solid var(--hair); border-radius:12px; background:var(--surface); box-shadow:0 12px 32px -12px rgba(25,23,19,.3); display:grid; gap:2px; }
.an-export-menu a { display:grid; gap:1px; padding:7px 10px; border-radius:8px; text-decoration:none; color:var(--ink); font-size:13px; font-weight:600; }
.an-export-menu a span { color:var(--ink-3); font-weight:400; font-size:12px; }
.an-export-menu a:hover { background:var(--accent-soft); }
.an-export-menu hr { border:0; border-top:1px solid var(--hair); margin:4px 0; width:100%; }
.an-select { border:1px solid var(--hair); background:var(--surface); font:inherit; font-size:13px; font-weight:600; color:var(--ink-2); padding:7px 10px; border-radius:10px; }
.an-tools { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.an-bar-in { position:relative; display:block; height:8px; min-width:60px; } .an-bar-in i { display:block; height:8px; border-radius:0 4px 4px 0; background:var(--s1); }
@media (max-width:720px) { .an-fun li { grid-template-columns:90px 1fr auto; } .an-fun small { display:none; } .an-hbars li { grid-template-columns:minmax(70px, 42%) 1fr auto; } .hm-row { grid-template-columns:30px repeat(24, minmax(0, 1fr)); gap:2px; } .hm-row i { height:18px; } }
`
