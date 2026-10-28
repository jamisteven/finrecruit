import type { WorkType } from '@/types'

// The label lines recruiters use ("📍 Location: …", "Work Model: …"). Only these lines are read, so a skill like
// "secure remote access" or a hashtag string like "#onsite #hybrid #remote" is never mistaken for a work mode.
const LABEL = /^[^\p{L}\p{N}]*(?:location|locations|job location|work location|work model|work arrangement|work type|work mode|workplace|work setup|work policy)\b/iu
// "Hybrid", "3 days onsite", "2 to 3 days remote a week", "4 days onsite, Fridays remote"
const HYBRID = /\bhybrid\b|\b\d\s*(?:-|–|to)?\s*\d?\s*days?\b[^.;|]{0,30}\b(?:on-?site|in[- ]office|in the office|remote|wfh)\b|\b(?:on-?site|in[- ]office)\b[^.;|]{0,20}\b\d\s*days?\b|\b(?:mon|tues|wednes|thurs|fri)days?\b[^.;|]{0,15}\bremote\b/i
const REMOTE = /\bremote\b|\bwork from (?:home|anywhere)\b|\bwfh\b/i
// "NO REMOTE", "50% remote", "100% onsite", "temporarily remote": not a remote role
const NOT_REMOTE = /\b(?:no|not|non|never|without)[ -]+remote\b|\d+\s*%\s*remote|on-?site|in[- ]person|in[- ]office|in the office|temporar|occasional/i

/**
 * Work mode from the post's own label lines. A post that says "Location: San Jose, CA / Remote" used to be stored
 * as just "San Jose" with no work type, so it never matched a Remote target. First decisive line wins.
 */
export function workTypeFromBody(rawText?: string | null): WorkType | null {
  if (!rawText) return null
  for (const raw of rawText.slice(0, 4000).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('📍') && !LABEL.test(line)) continue
    const l = line.slice(0, 220)
    if (HYBRID.test(l)) return 'Hybrid'
    if (REMOTE.test(l) && !NOT_REMOTE.test(l)) return 'Remote'
  }
  return null
}

// Mirrors the client-side inferWorkType so the value can be stored at ingest.
// rawText is optional: when location, tags and title say nothing, the post's own location lines are read.
export function inferWorkType(
  location?: string | null,
  tags?: string[] | null,
  title?: string | null,
  rawText?: string | null
): WorkType | null {
  const text = `${location || ''} ${tags?.join(' ') || ''} ${title || ''}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'Hybrid'
  if (/\bremote\b/.test(text)) return 'Remote'
  if (/\bon.?site\b|in.?office\b|in.?person\b/.test(text)) return 'On-site'
  return workTypeFromBody(rawText)
}
