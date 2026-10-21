// CSV the way spreadsheets expect it, shared by the browser (per-chart buttons) and the export route.
// Text cells that start with = + - @ are prefixed with ' so a search term like "=HYPERLINK(…)" typed by
// a stranger can't run as a formula when the file is opened in Excel or Sheets.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cell = any

function cell(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  let s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows of plain objects -> CSV text. Columns are the union of keys, in first-seen order. */
export function toCsv(rows: Record<string, Cell>[], columns?: string[]): string {
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k)
  const cols = columns ?? [...seen]
  const lines = [cols.map(cell).join(',')]
  for (const r of rows) lines.push(cols.map((c) => cell(r[c])).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'   // BOM so Excel reads UTF-8 (Zürich, São Paulo) correctly
}
