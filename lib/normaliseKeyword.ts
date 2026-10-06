// Canonical job-title phrases for search keywords. Keys are lowercase and
// matched exactly after trimming, same approach as normaliseLocation.
const KEYWORD_ALIASES: Record<string, string> = {
  // engineering
  'swe': 'software engineer',
  'sde': 'software engineer',
  'dev': 'software engineer',
  'developer': 'software engineer',
  'full stack': 'full stack engineer',
  'fullstack': 'full stack engineer',
  'frontend': 'frontend engineer',
  'front end': 'frontend engineer',
  'backend': 'backend engineer',
  'back end': 'backend engineer',
  'devops': 'devops engineer',
  'sre': 'site reliability engineer',
  'ml': 'machine learning engineer',
  'mle': 'machine learning engineer',
  'data eng': 'data engineer',

  // product and design
  'pm': 'product manager',
  'tpm': 'technical program manager',
  'po': 'product owner',
  'ux': 'ux designer',
  'ui': 'ui designer',

  // finance
  'ib': 'investment banking',
  'pe': 'private equity',
  'vc': 'venture capital',
  'fp&a': 'financial planning and analysis',
  'fpa': 'financial planning and analysis',
  'cf': 'corporate finance',
  'fi': 'fixed income',
  'ficc': 'fixed income currencies and commodities',
  'rgm': 'revenue growth management',

  // go to market
  'ae': 'account executive',
  'sdr': 'sales development representative',
  'bdr': 'business development representative',
  'cs': 'customer success',
  'cx': 'customer experience',
  'am': 'account manager',

  // risk, legal, ops
  'grc': 'governance risk and compliance',
  'ba': 'business analyst',
  'qa': 'quality assurance',
  'hr': 'human resources',
  'ta': 'talent acquisition',
}

// Words too vague to make a useful Apify query
const TOO_VAGUE = new Set([
  'job', 'jobs', 'work', 'role', 'roles', 'anything', 'any',
  'remote', 'hiring', 'career', 'careers', 'position', 'opportunity',
])

export function normaliseKeyword(raw: string | null): string | null {
  if (!raw) return null
  const lower = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!lower || lower.length < 2) return null
  if (TOO_VAGUE.has(lower)) return null
  return KEYWORD_ALIASES[lower] ?? lower
}
