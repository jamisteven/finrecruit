import { regionsOf, canonPlace } from './widenLocation'

// Matching a member's saved target against a role.
//
// Exact-substring matching was too strict: someone who asked for
// ".net software engineer" saw none of the twenty ".NET Developer" roles we
// actually hold. This tokenises instead, treats role words as a family, and
// insists on the distinctive part of the keyword.

const ROLE_FAMILIES: string[][] = [
  ['engineer', 'developer', 'dev', 'programmer', 'swe'],
  ['manager', 'lead', 'head'],
  ['analyst'],
  ['specialist'],
  ['designer', 'design'],
  ['architect'],
  ['consultant', 'advisor'],
  ['director'],
  ['administrator', 'admin', 'sysadmin'],
  ['scientist'],
  ['coordinator'],
  ['recruiter', 'recruitment'],
]

// Words that carry no signal on their own
const FILLER = new Set([
  'senior', 'junior', 'sr', 'jr', 'lead', 'staff', 'principal', 'mid', 'entry',
  'level', 'the', 'and', 'of', 'for', 'with', 'in', 'at', 'a', 'an',
  'software', 'technical', 'tech', 'it',
])

function tokens(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9.+#/ -]/g, ' ')
    .split(/[\s/-]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function familyOf(word: string): string[] | null {
  return ROLE_FAMILIES.find((f) => f.includes(word)) ?? null
}

// Compound and abbreviated forms people write instead of the full phrase.
// Keyed on the distinctive token; the values are alternatives to look for.
const TOKEN_ALIASES: Record<string, string[]> = {
  systems: ['system', 'sysadmin', 'sys'],
  system: ['systems', 'sysadmin', 'sys'],
  '.net': ['dotnet', 'net', 'c#'],
  kubernetes: ['k8s'],
  javascript: ['js'],
  typescript: ['ts'],
  postgresql: ['postgres'],
  marketing: ['growth'],
  accounts: ['account'],
  account: ['accounts'],
}

// Substring matching is what lets "quant" find "quantitative", but on short
// tokens it is a liability: "aml" sits inside "teamlead" and "streamline",
// "kyc" inside nothing useful. Below this length a token has to be a whole word.
const SUBSTRING_MIN = 5

function hasToken(t: string, haySet: Set<string>, hayText: string): boolean {
  if (haySet.has(t)) return true
  return t.length >= SUBSTRING_MIN && hayText.includes(t)
}

/** Loose token test: exact, singular/plural, or a known alias. */
function tokenPresent(t: string, haySet: Set<string>, hayText: string): boolean {
  if (hasToken(t, haySet, hayText)) return true
  const singular = t.endsWith('s') ? t.slice(0, -1) : `${t}s`
  if (hasToken(singular, haySet, hayText)) return true
  return (TOKEN_ALIASES[t] ?? []).some((a) => hasToken(a, haySet, hayText))
}

/**
 * Does `title` (plus optional `summary`) satisfy the member's `keyword`?
 *
 * The keyword is split into a distinctive part (anything not filler and not a
 * role word — ".net", "fixed income", "grc") and a role part ("engineer").
 * A role matches when every distinctive token appears, and the role word
 * matches any member of its family. With no distinctive tokens at all we fall
 * back to requiring the role word, which keeps broad keywords usable.
 */
export function keywordMatches(keyword: string, title: string, summary?: string | null): boolean {
  const kt = tokens(keyword)
  if (kt.length === 0) return false

  const roleWords = kt.filter((t) => familyOf(t))
  const distinctive = kt.filter((t) => !familyOf(t) && !FILLER.has(t))

  const titleToks = tokens(title)
  const titleSet = new Set(titleToks)
  const titleText = titleToks.join(' ')

  if (roleWords.length === 0) {
    // A topic keyword ("fixed income", "grc", "private equity") names a subject, not a job, so the
    // summary counts too; insist on at least one token so a single filler word can't match all.
    if (distinctive.length === 0) return false
    const hay = tokens(`${title} ${summary ?? ''}`)
    const haySet = new Set(hay)
    const hayText = hay.join(' ')
    return distinctive.every((t) => tokenPresent(t, haySet, hayText))
  }

  // A role keyword ("business analyst", ".net developer") is matched on the TITLE only. Matching the
  // summary turned "business analyst" into every specialist whose blurb mentioned the business, and
  // members cancel on noise faster than on gaps. The role word may be any sibling in its family
  // (developer for engineer); the distinctive words must all be there.
  const distinctiveOk = distinctive.every((t) => tokenPresent(t, titleSet, titleText))
  if (!distinctiveOk) return false
  return roleWords.some((rw) => familyOf(rw)!.some((sib) => tokenPresent(sib, titleSet, titleText)))
}

/**
 * Location match. Substring in either direction, so "london" catches "London, UK"
 * and "Greater London"; plus region membership, so a member who asked for "uae",
 * "switzerland" or "united states" sees the jobs located in Dubai, Zürich or
 * Chicago. A "remote" target also accepts a job whose work type is remote even
 * when its location names a city.
 */
export function locationMatches(target: string | null, location: string | null, workType?: string | null): boolean {
  if (!target) return true
  const t = target.trim().toLowerCase()
  if (t === 'remote' && (workType ?? '').toLowerCase() === 'remote') return true
  if (!location) return false
  const loc = location.toLowerCase()
  if (loc.includes(t)) return true
  // one direction only: the job's place, or any region it sits in, must be the
  // place the member named — never the other way round (a London target must
  // not match Manchester just because both are in the UK)
  const want = canonPlace(target)
  return regionsOf(location).some((h) => h === want || h.includes(want))
}


/**
 * The phrase to send Apify for a keyword.
 *
 * LinkedIn weights common words heavily, so "hiring .net software engineer
 * california" returns generic California software roles while "hiring .net
 * california" returns real .NET ones. We keep the distinctive tokens and the
 * role word, and drop the filler. Members never see this — their own wording
 * is what we store and show back to them.
 */
export function distilForQuery(keyword: string): string {
  const kt = tokens(keyword)
  if (kt.length === 0) return keyword

  const distinctive = kt.filter((t) => !familyOf(t) && !FILLER.has(t))
  const role = kt.find((t) => familyOf(t))

  // Nothing distinctive ("software engineer") — keep it as typed, or we'd be
  // searching for a bare role word.
  if (distinctive.length === 0) return keyword

  return [...distinctive, role].filter(Boolean).join(' ')
}
