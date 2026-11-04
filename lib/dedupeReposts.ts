// Collapsing reposts of the same mandate.
//
// Agencies and in-house recruiters put the same role up within hours of each
// other — eight "Murex Market Risk Lead / Remote" posts on one day, three
// companies named between them. Dedupe by post URL can't see that, and the
// company can't be part of the key because the end client and its agencies
// all name someone different. So the key is the title and location, within a
// short window, with a guard so that two genuinely different "Java Developer"
// openings are never merged just because they share a common title. The one
// exception: a generic title with NO company named on either post ("Cybersecurity
// Engineer / Remote" from a dozen staffing accounts). Nothing tells those apart,
// for us or for the member, so they fold into one card.
//
// Optionally (textFold) posts are first folded by what they SAY: the same first 400
// characters of text from different accounts is one post copied around, whatever
// title or company each copy was given. A role whose copies came from BLAST_POSTERS
// or more accounts, none of them linking to a listing, is a staffing blast (flagged
// when flagBlasts is on) and the page puts it at the bottom.

export type RepostRow = {
  id: string
  title: string | null
  company: string | null
  location: string | null
  posted_at: string | null
  author_name?: string | null
  text_key?: string | null
  apply_method?: string | null
}

export type DedupeOptions = { textFold?: boolean; flagBlasts?: boolean }

const WINDOW_MS = 7 * 86400_000
/** Different accounts posting the same text before it counts as a blast. */
export const BLAST_POSTERS = 5
// the fingerprint of an empty post: never a reason to merge anything
const EMPTY_TEXT_KEYS = new Set(['d41d8cd98f00', ''])

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

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const ts = (s: string | null) => {
  const t = s ? new Date(s).getTime() : NaN
  return isNaN(t) ? 0 : t
}

type Meta = { count: number; posters: Set<string>; anyLink: boolean; blast: boolean }

/**
 * Returns the rows with reposts removed. The newest post of each cluster
 * survives and carries `repost_count` (how many others were folded into it) and
 * `poster_count` (how many different people posted the role, itself included).
 * Input order is preserved for the survivors.
 */
export function dedupeReposts<T extends RepostRow>(
  rows: T[],
  opts: DedupeOptions = {},
): (T & { repost_count?: number; poster_count?: number; blast?: true })[] {
  const drop = new Set<string>()
  const posterOf = (r: T) => norm(r.author_name ?? null) || r.id
  const isLink = (r: T) => String(r.apply_method ?? '').trim().toLowerCase() === 'link'
  const meta = new Map<string, Meta>(rows.map((r) => [r.id, { count: 0, posters: new Set([posterOf(r)]), anyLink: isLink(r), blast: false }]))

  // `loser` becomes part of `home`'s card
  const fold = (loser: T, home: T) => {
    drop.add(loser.id)
    const m = meta.get(home.id)!, l = meta.get(loser.id)!
    m.count += 1 + l.count
    l.posters.forEach((p) => m.posters.add(p))
    m.anyLink = m.anyLink || l.anyLink
    m.blast = m.blast && l.blast        // a card is only a blast if everything folded into it was
  }

  // Stage 1: the same text from different accounts is one post copied around
  if (opts.textFold) {
    const byText = new Map<string, T[]>()
    for (const r of rows) {
      const k = r.text_key
      if (!k || EMPTY_TEXT_KEYS.has(k)) continue
      byText.set(k, [...(byText.get(k) ?? []), r])
    }
    for (const list of byText.values()) {
      if (list.length < 2) continue
      const sorted = [...list].sort((a, b) => ts(b.posted_at) - ts(a.posted_at))
      const homes: T[] = []
      for (const r of sorted) {
        const home = homes.find((h) => Math.abs(ts(h.posted_at) - ts(r.posted_at)) <= WINDOW_MS)
        if (home) fold(r, home)
        else homes.push(r)
      }
      for (const h of homes) {
        const m = meta.get(h.id)!
        m.blast = m.posters.size >= BLAST_POSTERS && !m.anyLink
      }
    }
  }

  // Stage 2: the same title and place
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    if (drop.has(r.id)) continue
    const toks = titleTokens(r.title)
    if (toks.length === 0) continue
    const key = `${toks.join(' ')}|${norm(r.location)}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

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
        if (distinctive) return true
        const sameCompany = norm(s.company) !== '' && norm(s.company) === norm(r.company)
        const neitherNamesACompany = norm(s.company) === '' && norm(r.company) === ''
        return sameCompany || neitherNamesACompany
      })
      if (home) fold(r, home)
      else survivors.push(r)
    }
  }

  return rows
    .filter((r) => !drop.has(r.id))
    .map((r) => {
      const m = meta.get(r.id)!
      const out: T & { repost_count?: number; poster_count?: number; blast?: true } = m.count
        ? { ...r, repost_count: m.count, poster_count: m.posters.size }
        : r
      return opts.flagBlasts && m.blast ? { ...out, blast: true as const } : out
    })
}
