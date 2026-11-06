import { regionsOf, canonPlace, sameMetro } from './widenLocation'

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

// Acronyms and the phrases they stand for. Members type either one ("QA" or "quality assurance"; normaliseKeyword
// saves the phrase), and job titles use either ("QA Engineer", "Quality Assurance Engineer"), so a search matches a
// title with the phrase OR the acronym. Acronyms are matched as whole words and case-sensitively, so "IT" is the
// acronym and never the word "it", and "AM" never matches "am". A typed "it" always means the acronym.
const ACRONYMS: [string, string][] = [
  ['IT', 'information technology'], ['HR', 'human resources'], ['QA', 'quality assurance'],
  ['GRC', 'governance risk and compliance'], ['FP&A', 'financial planning and analysis'],
  ['SRE', 'site reliability engineer'], ['TPM', 'technical program manager'], ['PM', 'product manager'],
  ['ML', 'machine learning'], ['AE', 'account executive'], ['SDR', 'sales development representative'],
  ['BDR', 'business development representative'], ['CS', 'customer success'], ['CX', 'customer experience'],
  ['IB', 'investment banking'], ['PE', 'private equity'], ['VC', 'venture capital'], ['TA', 'talent acquisition'],
  ['BA', 'business analyst'], ['PO', 'product owner'], ['AM', 'account manager'], ['CF', 'corporate finance'],
  ['FI', 'fixed income'], ['FICC', 'fixed income currencies and commodities'], ['RGM', 'revenue growth management'],
  ['UX', 'user experience'], ['UI', 'user interface'], ['RevOps', 'revenue operations'],
]
const ACR_LEFT = [' ', '(', '/', '-']        // what may sit before a standalone acronym (or the start of the title)
const ACR_RIGHT = [' ', ')', '/', '-', ',']  // ... and after it (or the end of the title)
const reEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ACR_RE = new Map(ACRONYMS.map(([a]) => [a, new RegExp(`(^|[ (/-])${reEsc(a)}($|[ )/,-])`)]))
const hasAcronym = (title: string, acr: string) =>
  ACR_RE.get(acr)!.test(title) || (acr === 'IT' && /information technology/i.test(title))

// Database prefilter for hasAcronym (case-insensitive, so never stricter). Entries starting with RAW_FILTER are used
// as-is by titleFilter instead of being wrapped in %...%.
const RAW_FILTER = '\u0001'
const acronymGroup = (acr: string): string[] => {
  const a = acr.toLowerCase()
  const out: string[] = acr === 'IT' ? [`${RAW_FILTER}%information technology%`] : []
  for (const l of ['', ...ACR_LEFT]) for (const r of ['', ...ACR_RIGHT])
    out.push(`${RAW_FILTER}${l === '' ? '' : '%'}${l}${a}${r}${r === '' ? '' : '%'}`)
  return out
}

/** The PostgREST filter for one entry of a titleSearchGroups group. */
export function titleFilter(x: string): string {
  return x.startsWith(RAW_FILTER) ? `title.ilike."${x.slice(RAW_FILTER.length)}"` : `title.ilike."%${x}%"`
}

// A search typed as several roles ("aml/kyc/reference data risk", "ux, ui designer", "analyst or associate") means
// ANY of them, not all at once. Only split when every part is a real word ("ci/cd" and "ux/ui" stay whole).
const altCache = new Map<string, string[]>()
export function alternatives(keyword: string): string[] {
  const hit = altCache.get(keyword)
  if (hit) return hit
  const out = computeAlternatives(keyword)
  if (altCache.size > 500) altCache.clear()
  altCache.set(keyword, out)
  return out
}
function computeAlternatives(keyword: string): string[] {
  const words = (x: string) => x.replace(/[^a-z0-9]/gi, '').length
  const out: string[] = []
  for (const piece of keyword.split(/\s*[,|]\s*|\s+or\s+/i).map((x) => x.trim()).filter(Boolean)) {
    const sub = piece.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean)
    if (sub.length > 1 && sub.every((x) => words(x) >= 3)) out.push(...sub)
    else out.push(piece)
  }
  return out.length ? out : [keyword]
}

// Words that are filler next to a role ("senior", "software engineer") but still name the field when they stand alone
const SOLO_OK = new Set(['software', 'technical', 'tech'])

type Variant = { acr: string | null; rest: string[] }
/** The ways a keyword can be read: as typed, and with any phrase swapped for its acronym (a typed "it" is only ever the acronym). */
function variantsOf(kt: string[]): Variant[] {
  if (kt.includes('it')) return [{ acr: 'IT', rest: kt.filter((t) => t !== 'it') }]
  const out: Variant[] = [{ acr: null, rest: kt }]
  for (const [acr, phrase] of ACRONYMS) {
    const pt = tokens(phrase)
    // a typed acronym ("revops", "sre") also reads as the phrase it stands for ("revenue operations")
    const typed = kt.indexOf(acr.toLowerCase())
    if (acr.length >= 3 && typed >= 0) out.push({ acr: null, rest: [...kt.slice(0, typed), ...pt, ...kt.slice(typed + 1)] })
    for (let i = 0; i + pt.length <= kt.length; i++) {
      if (pt.every((w, j) => kt[i + j] === w)) { out.push({ acr, rest: [...kt.slice(0, i), ...kt.slice(i + pt.length)] }); break }
    }
  }
  return out
}
const hasSignal = (rest: string[]) => rest.some((t) => familyOf(t) || !FILLER.has(t) || SOLO_OK.has(t))

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
  programme: ['program'],
  program: ['programme'],
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
 * For narrowing a database read before keywordMatches runs on the rows. Returns groups that must ALL be found in
 * the title; inside a group, finding ANY of its substrings is enough. It is never stricter than keywordMatches
 * (same plural / alias / role-family rules), so it only ever drops roles keywordMatches would have rejected.
 * null = the keyword can't match anything.
 */
export function titleSearchGroups(keyword: string): string[][] | null {
  const parts = alternatives(keyword).map(groupsForOne).filter((g): g is string[][] => !!g)
  if (parts.length === 0) return null
  // any one alternative is enough: (A and B) or C = (A or C) and (B or C)
  return parts.reduce((acc, r) => acc.flatMap((g1) => r.map((g2) => [...new Set([...g1, ...g2])])))
}

function groupsForOne(keyword: string): string[][] | null {
  const all = tokens(keyword)
  if (all.length === 0) return null
  const variants = (t: string) => [t, t.endsWith('s') ? t.slice(0, -1) : `${t}s`, ...(TOKEN_ALIASES[t] ?? [])]
  const groupsOf = (kt: string[]): string[][] => {
    const roleWords = kt.filter((t) => familyOf(t))
    const distinctive = kt.filter((t) => !familyOf(t) && !FILLER.has(t))
    if (roleWords.length === 0 && distinctive.length === 0 && kt.length > 0 && kt.every((t) => SOLO_OK.has(t))) return kt.map(variants)
    const groups = distinctive.map(variants)
    if (roleWords.length) groups.push([...new Set(roleWords.flatMap((rw) => familyOf(rw)!).flatMap(variants))])
    return groups
  }
  // one list of groups (all must hold) per way of reading the keyword; any one reading is enough, so the lists are
  // combined as (A and B) or C = (A or C) and (B or C)
  const readings: string[][][] = []
  for (const v of variantsOf(all)) {
    const g = groupsOf(v.rest)
    if (v.acr) readings.push([...g, acronymGroup(v.acr)])
    else if (g.length) readings.push(g)
  }
  if (readings.length === 0) return null
  return readings.reduce((acc, r) => acc.flatMap((g1) => r.map((g2) => [...new Set([...g1, ...g2])])))
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
  return alternatives(keyword).some((alt) => matchOne(alt, title, summary))
}

// What a keyword turns into (its words and the ways it can be read) never changes, and a feed check asks about
// the same few keywords for thousands of titles, so it is worked out once per keyword.
const planCache = new Map<string, { kt: string[]; variants: Variant[] }>()
function planOf(keyword: string) {
  let plan = planCache.get(keyword)
  if (!plan) {
    const kt = tokens(keyword)
    plan = { kt, variants: kt.length === 0 ? [] : variantsOf(kt) }
    if (planCache.size > 500) planCache.clear()
    planCache.set(keyword, plan)
  }
  return plan
}

function matchOne(keyword: string, title: string, summary?: string | null): boolean {
  const { kt, variants } = planOf(keyword)
  if (kt.length === 0) return false
  return variants.some((v) => {
    if (!v.acr) return matchTokens(v.rest, title, summary)
    if (!hasAcronym(title, v.acr)) return false
    // the acronym is in the title; whatever else was typed ("support", "manager") still has to match
    return !hasSignal(v.rest) || matchTokens(v.rest, title, summary)
  })
}

const splitCache = new Map<string, { roleWords: string[]; distinctive: string[] }>()
function splitOf(kt: string[]) {
  const key = kt.join('\u0001')
  let sp = splitCache.get(key)
  if (!sp) {
    sp = { roleWords: kt.filter((t) => familyOf(t)), distinctive: kt.filter((t) => !familyOf(t) && !FILLER.has(t)) }
    if (splitCache.size > 1000) splitCache.clear()
    splitCache.set(key, sp)
  }
  return sp
}

function matchTokens(kt: string[], title: string, summary?: string | null): boolean {
  const { roleWords, distinctive } = splitOf(kt)

  const titleToks = tokens(title)
  const titleSet = new Set(titleToks)
  const titleText = titleToks.join(' ')

  // "software" or "tech" on its own: filler beside a role, but the whole search when it stands alone (title only)
  if (roleWords.length === 0 && distinctive.length === 0 && kt.length > 0 && kt.every((t) => SOLO_OK.has(t))) {
    return kt.every((t) => tokenPresent(t, titleSet, titleText))
  }

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
  if (regionsOf(location).some((h) => h === want || h.includes(want))) return true
  // same metro area (target San Francisco, job in Sunnyvale)
  return sameMetro(target, location)
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

  // "it" is the IT acronym, kept (in capitals) as the distinctive word of the query
  const distinctive = kt.filter((t) => !familyOf(t) && !FILLER.has(t))
  if (kt.includes('it')) distinctive.unshift('IT')
  const role = kt.find((t) => familyOf(t))

  // Nothing distinctive ("software engineer") — keep it as typed, or we'd be
  // searching for a bare role word.
  if (distinctive.length === 0) return keyword

  return [...distinctive, role].filter(Boolean).join(' ')
}
