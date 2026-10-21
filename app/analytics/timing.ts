// Time-of-day / weekday maths for the Growth tab. Times are bucketed in the chosen time zone
// (Intl, so daylight saving is handled), and the "average time" is a circular mean: a plain average of
// 23:30 and 00:30 would say noon, the circular mean says midnight.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string, kind: 'parts' | 'full'): Intl.DateTimeFormat {
  const k = `${kind}|${tz}`
  let f = cache.get(k)
  if (!f) {
    f = kind === 'parts'
      ? new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      : new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    cache.set(k, f)
  }
  return f
}

export const hh = (h: number) => String(((h % 24) + 24) % 24).padStart(2, '0') + ':00'
export const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60) % 60).padStart(2, '0')}`

/** Whole-hour offset of a zone from UTC on a given date (half-hour zones round). */
export function tzOffsetHours(tz: string, at: Date): number {
  const parts = fmt(tz, 'full').formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 3_600_000)
}

/** weekday (Mon first) x hour matrix from UTC counts (index 0 = Sunday), shifted into a zone. */
export function rebase(utc: number[][], offsetHours: number): number[][] {
  const out = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const t = h + offsetHours
    const nd = (d + Math.floor(t / 24) + 7 * 4) % 7
    out[(nd + 6) % 7][((t % 24) + 24) % 24] += utc[d][h]
  }
  return out
}

export type Timing = {
  n: number; matrix: number[][]; hours: number[]; days: number[]
  avgMin: number | null; spread: number          // spread: 0 = all over the clock, 1 = everyone at the same minute
  windowStart: number; windowCount: number; topDay: number
}

export function summarise(matrix: number[][], avgFrom?: { sx: number; sy: number; n: number }): Timing {
  const hours = Array.from({ length: 24 }, (_, h) => matrix.reduce((s, r) => s + r[h], 0))
  const days = matrix.map((r) => r.reduce((a, b) => a + b, 0))
  const n = hours.reduce((a, b) => a + b, 0)
  let windowStart = 0, windowCount = -1
  for (let s = 0; s < 24; s++) {
    const c = hours[s] + hours[(s + 1) % 24] + hours[(s + 2) % 24]
    if (c > windowCount) { windowCount = c; windowStart = s }
  }
  const topDay = days.indexOf(Math.max(...days))
  let avgMin: number | null = null, spread = 0
  if (avgFrom && avgFrom.n > 0) {
    spread = Math.hypot(avgFrom.sx, avgFrom.sy) / avgFrom.n
    avgMin = (((Math.atan2(avgFrom.sy, avgFrom.sx) / (2 * Math.PI)) * 1440) % 1440 + 1440) % 1440
  }
  return { n, matrix, hours, days, avgMin, spread, windowStart, windowCount, topDay }
}

/** Bucket event times into a zone and summarise them. */
export function timingOf(isos: string[], tz: string): Timing {
  const f = fmt(tz, 'parts')
  const matrix = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  let sx = 0, sy = 0, n = 0
  for (const iso of isos) {
    const t = new Date(iso)
    if (Number.isNaN(t.getTime())) continue
    const parts = f.formatToParts(t)
    const wd = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '')
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    if (wd < 0) continue
    matrix[wd][h]++
    const a = ((h * 60 + m) / 1440) * 2 * Math.PI
    sx += Math.cos(a); sy += Math.sin(a); n++
  }
  return summarise(matrix, { sx, sy, n })
}
