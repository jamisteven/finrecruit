// Direct employer or agency? The classifier answers it from the post; a few hard signals in the
// text override it, because staffing posts are formulaic and the model is sometimes too polite.
// Keep AGENCY_TEXT in step with the SQL in supabase/2026-10-21-employer-type.sql (the backfill).

export type EmployerType = 'direct' | 'agency'

export const AGENCY_TEXT = new RegExp([
  '\\bour client\\b', '\\bend[- ]client\\b', '\\bclient (location|site)\\b', '\\bfor (a|an|our) (client|customer)\\b', '\\bclient unnamed\\b', '\\bundisclosed client\\b',
  '\\bimplementation partner\\b', '\\bprime vendor\\b', '\\bbench sales\\b', '\\bon (our |the )?bench\\b',
  '\\bc2c\\b', '\\bcorp[- ]to[- ]corp\\b', '\\bw2\\b', '\\b1099\\b', '\\bh1b\\b', '\\bh-1b\\b', '\\bgc/usc\\b', '\\busc/gc\\b', '\\bopt/cpt\\b',
  '\\bcontract[- ]to[- ]hire\\b', '\\bc2h\\b', '\\b\\d+\\+?[- ]?(month|week)s? (contract|engagement|project|assignment)\\b', '\\bduration\\s*:',
  '\\bmust be local\\b', '\\blocals? only\\b', '\\bstaffing (firm|agency|partner|company)\\b', '\\bconsultancy services\\b',
].join('|'), 'i')

// A company name can give it away on its own: recruitment firms by name in any sector; the
// small-IT-consultancy naming pattern only in tech, and only when email is the way in.
export const AGENCY_COMPANY_ANY = /\b(staffing|resourcing|recruitment|recruiting|headhunt|talent (partners|solutions|group|acquisition)|search partners|executive search)\b/i
export const AGENCY_COMPANY_TECH = /\b(technologies|technology|solutions|consultancy|consulting|infotech|softech|systems inc|it services|tek|soft)\b/i

export function employerType(modelAnswer: unknown, text: string, authorHeadline?: string | null, company?: string | null, sector?: string | null, applyMethod?: string | null): EmployerType {
  if (AGENCY_TEXT.test(text)) return 'agency'
  const c = company ?? ''
  if (AGENCY_COMPANY_ANY.test(c)) return 'agency'
  if (sector === 'tech' && /email/i.test(applyMethod ?? '') && AGENCY_COMPANY_TECH.test(c)) return 'agency'
  const h = (authorHeadline ?? '').toLowerCase()
  // an independent recruiter's headline ("Technical Recruiter | Staffing") with no employer named
  if (/\b(staffing|recruit(er|ment|ing)|bench sales|headhunter)\b/.test(h) && !/\b(at|@)\b/.test(h)) return 'agency'
  return modelAnswer === 'agency' ? 'agency' : 'direct'
}
