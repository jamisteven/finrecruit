import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'
export const revalidate = 3600

type Cron = { path: string; schedule: string }
type Drop = { days: number[]; utcHour: number; utcMin: number; kind: string; sectors: string[] }

function expandDays(field: string): number[] {
  if (field === '*') return [0, 1, 2, 3, 4, 5, 6]
  const out = new Set<number>()
  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      for (let d = a; d <= b; d++) out.add(d % 7)
    } else out.add(Number(part) % 7)
  }
  return [...out].sort()
}

export async function GET() {
  try {
    const raw = readFileSync(join(process.cwd(), 'vercel.json'), 'utf-8')
    const crons: Cron[] = JSON.parse(raw).crons ?? []

    // group crons that fire within the same hour into one "drop"
    const byKey = new Map<string, Drop>()

    for (const c of crons) {
      const [min, hour, , , dow] = c.schedule.split(' ')
      if (hour.includes('*') || hour.includes('/')) continue // skip non-fixed hours

      const kind = c.path.includes('ingest-hashtags') ? 'hashtags'
        : c.path.includes('ingest-recruiters') ? 'recruiters'
        : 'keyword'

      const sectorMatch = c.path.match(/sector=(\w+)/)
      const days = expandDays(dow)
      const key = `${days.join('')}|${hour}|${kind}`

      const existing = byKey.get(key)
      if (existing) {
        if (sectorMatch) existing.sectors.push(sectorMatch[1])
        existing.utcMin = Math.min(existing.utcMin, Number(min))
      } else {
        byKey.set(key, {
          days,
          utcHour: Number(hour),
          utcMin: Number(min),
          kind,
          sectors: sectorMatch ? [sectorMatch[1]] : [kind],
        })
      }
    }

    const drops = [...byKey.values()].sort(
      (a, b) => a.utcHour - b.utcHour || a.utcMin - b.utcMin
    )

    return NextResponse.json({ drops })
  } catch (e) {
    return NextResponse.json({ drops: [], error: String(e) }, { status: 200 })
  }
}
