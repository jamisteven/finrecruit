import type { WorkType } from '@/types'

// Mirrors the client-side inferWorkType so the value can be stored at ingest.
export function inferWorkType(
  location?: string | null,
  tags?: string[] | null,
  title?: string | null
): WorkType | null {
  const text = `${location || ''} ${tags?.join(' ') || ''} ${title || ''}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'Hybrid'
  if (/\bremote\b/.test(text)) return 'Remote'
  if (/\bon.?site\b|in.?office\b|in.?person\b/.test(text)) return 'On-site'
  return null
}
