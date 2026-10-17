// Collapsing reposts of the same mandate.
//
// Agencies and in-house recruiters put the same role up within hours of each
// other — eight "Murex Market Risk Lead / Remote" posts on one day, three
// companies named between them. Dedupe by post URL can't see that, and the
// company can't be part of the key because the end client and its agencies
// all name someone different. So the key is the title and location, within a
// short window, with a guard so that two genuinely different "Java Developer"
// openings are never merged just because they share a common title.

export type RepostRow = {
  id: string
  title: string | null
  company: string | null
  location: string | null
  posted_at: string | null
}

const WINDOW_MS = 7 * 86400_000

// Words that don't identify a role: seniority, grammar, and location/mode noise
const FILLER = new Set([
  'senior', 'sr', 'junior', 'jr', 'mid', 'level', 'lead', 'principal', 'staff',
  'the', 'and', 'of', 'for', 'with', 'in', 'at', 'a', 'an', 'to', 'or',
  'remote', 'hybrid', 'onsite', 'on-site', 'm/f/d', 'f/m/d', 'w/m/d', 'm/w/d', 'f/m/x', 'm/f/x',
  'urgent', 'immediate', 'hiring', 'needed', 'required', 'wanted', 'opportunity', 'role', 'position',
])

// Fewer distinctive words than this and a title is too common to merge across companies
const DISTINCTIVE_MIN = 3

function titleTokens(title: string | null): string[] {
  return String(title ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9.+#/ -]/g, ' ')
    .split(/[\s\-–—|,:]+/)
    .map((t) => t.replace(/^[./]+|[./]+$/g, ''))
    .filter((t) => t && !FILLER.has(t))
}

const norm = (s: string | null) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const ts = (s: string | null) => {
  const t = s ? new Date(s).getTime() : NaN
  return isNaN(t) ? 0 : t
}

/**
 * Returns the rows with reposts removed. The newest post of each cluster
 * survives and carries `repost_count`: how many others were folded into it.
 * Input order is preserved for the survivors.
 */
export function dedupeReposts<T extends RepostRow>(rows: T[]): (T & { repost_count?: number })[] {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const toks = titleTokens(r.title)
    if (toks.length === 0) continue
    const key = `${toks.join(' ')}|${norm(r.location)}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  const drop = new Set<string>()
  const folded = new Map<string, number>()

  for (const list of groups.values()) {
    if (list.length < 2) continue
    const distinctive = titleTokens(list[0].title).length >= DISTINCTIVE_MIN
    const sorted = [...list].sort((a, b) => ts(b.posted_at) - ts(a.posted_at))
    const survivors: T[] = []
    for (const r of sorted) {
      const home = survivors.find((s) => {
        if (Math.abs(ts(s.posted_at) - ts(r.posted_at)) > WINDOW_MS) return false
        // Same company is always the same job; different companies only when
        // the title is specific enough to be the same mandate.
        return distinctive || (norm(s.company) !== '' && norm(s.company) === norm(r.company))
      })
      if (home) {
        drop.add(r.id)
        folded.set(home.id, (folded.get(home.id) ?? 0) + 1)
      } else {
        survivors.push(r)
      }
    }
  }

  return rows
    .filter((r) => !drop.has(r.id))
    .map((r) => (folded.has(r.id) ? { ...r, repost_count: folded.get(r.id) } : r))
}
