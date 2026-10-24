import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { renderPostSnapshot } from '@/lib/postSnapshot'

export const runtime = 'nodejs'

// The offer page shows a title-tapper the post they tapped, as a picture: the recruiter's own words with
// their name, contact details and links burned out. It is an image so the text cannot be selected or
// copied, and the redacted text never leaves the server.
//
// Only roles a free visitor can already read are served: anything older than FREE_DELAY_HOURS, plus the
// newest OPEN_FRESH roles (the free samples and the two teasers in app/api/jobs/route.ts). Keep in sync.
const FREE_DELAY_MS = 48 * 3600_000
const OPEN_FRESH = 5


const miss = () => NextResponse.json({ error: 'not available' }, { status: 404, headers: { 'Cache-Control': 'public, s-maxage=300' } })

// The poster's profile photo as a small data: URI. Any failure (expired LinkedIn URL, slow CDN, odd file)
// just means the grey placeholder is drawn instead.
async function profilePhoto(url: string | null | undefined): Promise<string | null> {
  try {
    if (!url) return null
    const u = new URL(url)
    if (u.protocol !== 'https:' || !u.hostname.endsWith('licdn.com')) return null
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 1500)
    const r = await fetch(u, { signal: ctl.signal }).finally(() => clearTimeout(timer))
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 3_000_000) return null
    const sharp = (await import('sharp')).default
    const out = await sharp(buf).resize(184, 184, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer()
    return `data:image/jpeg;base64,${out.toString('base64')}`
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const t0 = performance.now()
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) return miss()

  const db = createServerClient()
  const { data: job } = await db.from('jobs')
    .select('id, posted_at, raw_text, author_name, author_headline, author_avatar, is_verified_job, quality')
    .eq('id', id).maybeSingle()
  if (!job || !job.raw_text || job.is_verified_job === false || job.quality === 'low') return miss()

  const t = job.posted_at ? new Date(job.posted_at).getTime() : NaN
  const now = Date.now()
  if (isNaN(t) || t > now) return miss()
  const tDb = performance.now() - t0

  // is this role one a free visitor can read? (checked alongside the photo fetch, not before it)
  const allowed = async () => {
    if (t < now - FREE_DELAY_MS) return true
    const { data: top } = await db.from('jobs').select('id')
      .eq('is_verified_job', true).or('quality.is.null,quality.neq.low')
      .gte('posted_at', new Date(now - FREE_DELAY_MS).toISOString()).lte('posted_at', new Date(now).toISOString())
      .order('posted_at', { ascending: false }).limit(OPEN_FRESH)
    return !!top?.some((r) => String(r.id) === String(job.id))
  }
  const [ok, photo] = await Promise.all([allowed(), profilePhoto(job.author_avatar)])
  if (!ok) return miss()
  const tPrep = performance.now() - t0

  const img = renderPostSnapshot(job, now, photo)
  if (!img) return miss()
  const png = Buffer.from(await img.arrayBuffer())
  const tAll = performance.now() - t0

  return new NextResponse(png, {
    headers: {
      'Content-Type': 'image/png',
      // the post never changes, so a week at the edge; warmed ahead of visitors by /api/warm-snapshots
      'Cache-Control': 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000',
      'Server-Timing': `db;dur=${Math.round(tDb)}, prep;dur=${Math.round(tPrep - tDb)}, draw;dur=${Math.round(tAll - tPrep)}`,
    },
  })
}
