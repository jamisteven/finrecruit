// "aml,kyc", "aml/kyc" and "aml or kyc" are two searches, not one — a target
// has to match every word of its keyword in a title, so the combined form
// matches nothing. Shared by the role picker (to offer a split) and the
// suggest-roles API (to offer each part).

/** Separators almost always mean "or" — except where they're part of a name. */
const KEEP_WHOLE = new Set(['c#/.net', 'c#/vb.net', 'ci/cd', 'r&d', 'p&l', 'a/b', 'ui/ux', 'ux/ui', 'm&a', 'tcp/ip'])

export function splitRole(raw: string): string[] {
  const t = raw.trim()
  if (!t) return []
  if (KEEP_WHOLE.has(t.toLowerCase())) return [t]
  if (!/[/,&]|\bor\b/i.test(t)) return [t]
  return t
    .split(/\s*(?:[/,&]|\bor\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
}

/** True when the text reads as several roles in one box. */
export function isCompoundRole(raw: string): boolean {
  return splitRole(raw).length > 1
}
