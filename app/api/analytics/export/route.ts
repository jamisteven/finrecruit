import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { createServerClient } from '@/lib/supabase'
import { buildDataset, DATASETS } from '@/lib/analyticsExport'
import { toCsv } from '@/lib/csv'
import { zip } from '@/lib/zip'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/analytics/export?dataset=<name>   one CSV
// GET /api/analytics/export?dataset=all      a .zip with every CSV plus a README
// Admin only; everyone else gets the ordinary 404.
export async function GET(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const which = new URL(req.url).searchParams.get('dataset') ?? 'all'
  const stamp = new Date().toISOString().slice(0, 10)
  const db = createServerClient()
  const cache = {}
  const noStore = { 'Cache-Control': 'private, no-store' }
  try {
    if (which !== 'all') {
      if (!(which in DATASETS)) return NextResponse.json({ error: 'Unknown dataset', datasets: Object.keys(DATASETS) }, { status: 400 })
      const csv = toCsv(await buildDataset(db, which, cache))
      return new NextResponse(csv, { headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="backchannel-${which}-${stamp}.csv"` } })
    }
    const names = Object.keys(DATASETS)
    const built = await Promise.all(names.map(async (n) => ({ n, rows: await buildDataset(db, n, cache).catch((e: Error) => [{ error: e.message }]) })))
    const readme = `backchannel.jobs analytics export, ${new Date().toISOString()}\r\nTimes are UTC. Revenue is estimated from first-payment prices (renewals are not in checkout_events).\r\n\r\n` +
      built.map(({ n, rows }) => `${n}.csv (${rows.length} rows): ${DATASETS[n]}`).join('\r\n') + '\r\n'
    const bytes = zip([{ name: 'README.txt', data: readme }, ...built.map(({ n, rows }) => ({ name: `${n}.csv`, data: toCsv(rows) }))])
    return new NextResponse(Buffer.from(bytes), { headers: { ...noStore, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="backchannel-analytics-${stamp}.zip"` } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
