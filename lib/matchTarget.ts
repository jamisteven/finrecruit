// Matching a member's saved target against a role.
//
// Exact-substring matching was too strict: someone who asked for
// ".net software engineer" saw none of the twenty ".NET Developer" roles we
// actually hold. This tokenises instead, treats role words as a family, and
// insists on the distinctive part of the keyword.

const ROLE_FAMILIES: string[][] = [
  ['engineer', 'developer', 'dev', 'programmer', 'swe'],
  ['manager', 'lead', 'head'],
  ['analyst', 'specialist'],
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

  const hay = tokens(`${title} ${summary ?? ''}`)
  const haySet = new Set(hay)
  const hayText = hay.join(' ')

  const roleWords = kt.filter((t) => familyOf(t))
  const distinctive = kt.filter((t) => !familyOf(t) && !FILLER.has(t))

  // every distinctive token has to show up somewhere
  const distinctiveOk = distinctive.every((t) =>
    haySet.has(t) || hayText.includes(t))

  if (!distinctiveOk) return false

  if (roleWords.length === 0) {
    // keyword was all distinctive ("fixed income") — the check above is enough,
    // but insist on at least one token so a single filler word can't match all
    return distinctive.length > 0
  }

  // the role word matches if any sibling in its family appears
  return roleWords.some((rw) => {
    const fam = familyOf(rw)!
    return fam.some((sib) => haySet.has(sib) || hayText.includes(sib))
  })
}

/** Location match: substring, so "london" catches "London, UK" and "Greater London". */
export function locationMatches(target: string | null, location: string | null): boolean {
  if (!target) return true
  if (!location) return false
  return location.toLowerCase().includes(target.toLowerCase())
}
