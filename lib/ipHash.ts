import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'

// Salted hash of the caller's IP plus Vercel's coarse geo headers. Lets us ask "did these two
// buyers come from the same network?" without keeping the raw IP. Set IP_HASH_SALT in Vercel
// (any long random string); without it the hash falls back to INGEST_SECRET, so it still works.
export function ipInfo(req: NextRequest): { ip_hash: string | null; ip_country: string | null; ip_city: string | null } {
  const raw = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || ''
  const salt = process.env.IP_HASH_SALT || process.env.INGEST_SECRET || ''
  const ip_hash = raw ? createHash('sha256').update(salt + '|' + raw).digest('hex').slice(0, 16) : null
  const country = req.headers.get('x-vercel-ip-country')
  let city: string | null = req.headers.get('x-vercel-ip-city')
  try { if (city) city = decodeURIComponent(city) } catch { /* keep raw */ }
  return { ip_hash, ip_country: country ? country.slice(0, 2) : null, ip_city: city ? city.slice(0, 80) : null }
}
