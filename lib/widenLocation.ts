// Widening a member's location when their city turns up almost nothing.
//
// Someone asking for ".net software engineer" in San Jose, Palo Alto and San
// Francisco gets nothing — the roles exist, they're in New York and Atlanta.
// Rather than leaving the tab empty we climb a ladder: city → state/metro →
// country → anywhere, and tell them which rung they're on.

const CITY_TO_REGION: Record<string, string> = {
  // California
  'san francisco': 'California', 'palo alto': 'California', 'san jose': 'California',
  'oakland': 'California', 'berkeley': 'California', 'mountain view': 'California',
  'sunnyvale': 'California', 'santa clara': 'California', 'san mateo': 'California',
  'los angeles': 'California', 'san diego': 'California', 'sacramento': 'California',
  'irvine': 'California', 'pasadena': 'California', 'santa monica': 'California',
  // Texas
  'austin': 'Texas', 'dallas': 'Texas', 'houston': 'Texas', 'san antonio': 'Texas',
  'fort worth': 'Texas', 'plano': 'Texas', 'irving': 'Texas',
  // New York
  'new york': 'New York', 'nyc': 'New York', 'brooklyn': 'New York',
  'manhattan': 'New York', 'buffalo': 'New York', 'albany': 'New York',
  // Massachusetts
  'boston': 'Massachusetts', 'cambridge': 'Massachusetts', 'somerville': 'Massachusetts',
  // Washington
  'seattle': 'Washington', 'bellevue': 'Washington', 'redmond': 'Washington',
  'tacoma': 'Washington', 'spokane': 'Washington',
  // Illinois
  'chicago': 'Illinois', 'evanston': 'Illinois', 'naperville': 'Illinois',
  // Colorado
  'denver': 'Colorado', 'boulder': 'Colorado', 'colorado springs': 'Colorado',
  // Georgia
  'atlanta': 'Georgia', 'savannah': 'Georgia',
  // Florida
  'miami': 'Florida', 'tampa': 'Florida', 'orlando': 'Florida',
  'jacksonville': 'Florida', 'fort lauderdale': 'Florida',
  // North Carolina
  'charlotte': 'North Carolina', 'raleigh': 'North Carolina',
  'durham': 'North Carolina', 'greensboro': 'North Carolina',
  // Other US
  'phoenix': 'Arizona', 'scottsdale': 'Arizona', 'tucson': 'Arizona',
  'philadelphia': 'Pennsylvania', 'pittsburgh': 'Pennsylvania',
  'detroit': 'Michigan', 'ann arbor': 'Michigan',
  'minneapolis': 'Minnesota', 'saint paul': 'Minnesota',
  'nashville': 'Tennessee', 'memphis': 'Tennessee', 'knoxville': 'Tennessee',
  'portland': 'Oregon', 'eugene': 'Oregon',
  'salt lake city': 'Utah', 'provo': 'Utah',
  'las vegas': 'Nevada', 'reno': 'Nevada',
  'columbus': 'Ohio', 'cleveland': 'Ohio', 'cincinnati': 'Ohio',
  'kansas city': 'Missouri', 'st louis': 'Missouri', 'saint louis': 'Missouri',
  'baltimore': 'Maryland', 'washington dc': 'Washington DC', 'washington': 'Washington DC',
  'richmond': 'Virginia', 'arlington': 'Virginia', 'alexandria': 'Virginia',
  'new jersey': 'New Jersey', 'newark': 'New Jersey', 'jersey city': 'New Jersey',
  'indianapolis': 'Indiana', 'milwaukee': 'Wisconsin', 'madison': 'Wisconsin',
  // More US cities and suburbs (states the table did not cover yet, and the towns a job post names)
  'tallahassee': 'Florida', 'st petersburg': 'Florida', 'fort myers': 'Florida', 'boca raton': 'Florida',
  'hoffman estates': 'Illinois', 'north chicago': 'Illinois', 'schaumburg': 'Illinois', 'oak brook': 'Illinois',
  'rosemont': 'Illinois', 'skokie': 'Illinois', 'lake forest': 'Illinois', 'deerfield': 'Illinois',
  'east canton': 'Ohio', 'akron': 'Ohio', 'dayton': 'Ohio', 'toledo': 'Ohio',
  'huntsville': 'Alabama', 'louisville': 'Kentucky', 'lexington': 'Kentucky',
  'oklahoma city': 'Oklahoma', 'tulsa': 'Oklahoma', 'omaha': 'Nebraska', 'lincoln': 'Nebraska',
  'boise': 'Idaho', 'albuquerque': 'New Mexico', 'santa fe': 'New Mexico', 'honolulu': 'Hawaii',
  'anchorage': 'Alaska', 'des moines': 'Iowa', 'little rock': 'Arkansas', 'new orleans': 'Louisiana',
  'baton rouge': 'Louisiana', 'charleston': 'South Carolina', 'greenville': 'South Carolina',
  'hartford': 'Connecticut', 'stamford': 'Connecticut', 'greenwich': 'Connecticut', 'new haven': 'Connecticut',
  'providence': 'Rhode Island', 'burlington': 'Vermont', 'wilmington': 'Delaware',
  'mclean': 'Virginia', 'reston': 'Virginia', 'herndon': 'Virginia', 'tysons': 'Virginia', 'chantilly': 'Virginia',
  'bethesda': 'Maryland', 'rockville': 'Maryland',
  'princeton': 'New Jersey', 'hoboken': 'New Jersey', 'morristown': 'New Jersey',
  'frisco': 'Texas', 'mckinney': 'Texas', 'the woodlands': 'Texas',
  'fresno': 'California', 'long beach': 'California', 'menlo park': 'California', 'redwood city': 'California',
  'cupertino': 'California', 'fremont': 'California',
  // UK
  'london': 'United Kingdom', 'manchester': 'United Kingdom',
  'birmingham': 'United Kingdom', 'edinburgh': 'United Kingdom',
  'glasgow': 'United Kingdom', 'bristol': 'United Kingdom', 'leeds': 'United Kingdom',
  // Switzerland
  'zurich': 'Switzerland', 'zürich': 'Switzerland', 'geneva': 'Switzerland',
  'basel': 'Switzerland', 'bern': 'Switzerland', 'zug': 'Switzerland',
  'lausanne': 'Switzerland', 'lugano': 'Switzerland',
  // Elsewhere
  'toronto': 'Canada', 'vancouver': 'Canada', 'montreal': 'Canada',
  'calgary': 'Canada', 'ottawa': 'Canada',
  'dubai': 'UAE', 'abu dhabi': 'UAE',
  'singapore': 'Singapore', 'hong kong': 'Hong Kong',
  'sydney': 'Australia', 'melbourne': 'Australia',
  'berlin': 'Germany', 'munich': 'Germany', 'frankfurt': 'Germany', 'hamburg': 'Germany',
  'amsterdam': 'Netherlands', 'paris': 'France', 'dublin': 'Ireland',
  'madrid': 'Spain', 'barcelona': 'Spain', 'milan': 'Italy', 'rome': 'Italy',
}

// Metro areas. Someone who asks for San Francisco wants the roles in Sunnyvale, Palo Alto and Fremont
// too; recruiters name the suburb their office is in. Every city in a group counts as every other
// city in it. Keep to places that really share a commute; anything ambiguous stays out.
const METRO_GROUPS: string[][] = [
  ['san francisco', 'sf', 'oakland', 'berkeley', 'san jose', 'palo alto', 'mountain view', 'sunnyvale', 'santa clara',
    'san mateo', 'redwood city', 'menlo park', 'cupertino', 'fremont', 'milpitas', 'los gatos', 'foster city',
    'south san francisco', 'hayward', 'walnut creek', 'pleasanton', 'emeryville', 'san rafael', 'los altos',
    'campbell', 'burlingame', 'bay area', 'silicon valley'],
  ['seattle', 'bellevue', 'redmond', 'kirkland', 'bothell', 'renton', 'everett', 'issaquah', 'sammamish',
    'mercer island', 'woodinville'],
  ['new york', 'nyc', 'brooklyn', 'manhattan', 'queens', 'bronx', 'staten island', 'long island city',
    'jersey city', 'hoboken', 'white plains'],
  ['boston', 'cambridge', 'somerville', 'waltham', 'quincy', 'watertown', 'woburn', 'framingham',
    'needham', 'brookline'],
  ['los angeles', 'santa monica', 'pasadena', 'long beach', 'glendale', 'burbank', 'culver city', 'el segundo',
    'torrance', 'beverly hills'],
  ['irvine', 'anaheim', 'costa mesa', 'newport beach', 'santa ana'],
  ['washington dc', 'dc', 'arlington', 'alexandria', 'reston', 'mclean', 'herndon', 'tysons', 'chantilly',
    'bethesda', 'rockville', 'fairfax', 'silver spring'],
  ['chicago', 'evanston', 'naperville', 'schaumburg', 'oak brook', 'rosemont', 'skokie', 'deerfield',
    'lake forest', 'hoffman estates'],
  ['dallas', 'plano', 'irving', 'frisco', 'mckinney', 'fort worth', 'richardson', 'addison'],
  ['houston', 'the woodlands', 'sugar land', 'katy'],
  ['austin', 'round rock', 'cedar park'],
  ['atlanta', 'alpharetta', 'marietta', 'sandy springs', 'smyrna'],
  ['denver', 'boulder', 'littleton'],
  ['phoenix', 'scottsdale', 'tempe', 'mesa', 'chandler', 'gilbert'],
  ['minneapolis', 'saint paul', 'st paul'],
]
const METRO_OF = new Map<string, number>()
METRO_GROUPS.forEach((g, i) => g.forEach((c) => { if (!METRO_OF.has(c)) METRO_OF.set(c, i) }))
const metroRegex: (RegExp | undefined)[] = []

/** Is the job's location in the same metro area as the place the member named? */
export function sameMetro(target: string, jobLocation: string | null): boolean {
  if (!jobLocation) return false
  const gi = METRO_OF.get(canonPlace(target))
  if (gi === undefined) return false
  const re = (metroRegex[gi] ??= new RegExp(
    `(?<![\\p{L}])(?:${METRO_GROUPS[gi].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`, 'iu'))
  return re.test(jobLocation.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
}

/** Every US state maps up to the country; everything else is already national. */
const US_REGIONS = new Set([
  'California', 'Texas', 'New York', 'Massachusetts', 'Washington', 'Illinois',
  'Colorado', 'Georgia', 'Florida', 'North Carolina', 'Arizona', 'Pennsylvania',
  'Michigan', 'Minnesota', 'Tennessee', 'Oregon', 'Utah', 'Nevada', 'Ohio',
  'Missouri', 'Maryland', 'Washington DC', 'Virginia', 'New Jersey', 'Indiana',
  'Wisconsin', 'Alabama', 'Kentucky', 'Oklahoma', 'Nebraska', 'Idaho', 'New Mexico', 'Hawaii', 'Alaska', 'Iowa',
  'Arkansas', 'Louisiana', 'South Carolina', 'Connecticut', 'Rhode Island', 'Vermont', 'Delaware', 'Kansas',
  'Mississippi', 'Montana', 'Wyoming', 'North Dakota', 'South Dakota', 'West Virginia', 'New Hampshire', 'Maine',
])

export type WidenStep = { label: string; location: string | null }

/**
 * The ladder for a target location, narrowest first. Each rung carries a label
 * for the UI so a member can see they're being shown something broader than
 * they asked for.
 */
export function wideningLadder(location: string | null): WidenStep[] {
  if (!location) return [{ label: 'anywhere', location: null }]

  const key = location.trim().toLowerCase()
  const steps: WidenStep[] = [{ label: location, location }]

  const region = CITY_TO_REGION[key]
  if (region && region.toLowerCase() !== key) {
    steps.push({ label: region, location: region })
    if (US_REGIONS.has(region)) steps.push({ label: 'the United States', location: 'United States' })
  }

  steps.push({ label: 'remote', location: 'Remote' })
  steps.push({ label: 'anywhere', location: null })
  return steps
}

/** The query string we'd send Apify for a given keyword and rung. */
export function widenedQuery(keyword: string, step: WidenStep): string {
  return step.location ? `hiring ${keyword} ${step.location}` : `hiring ${keyword}`
}

// Names people type for the same place. Keys and values lower-case.
const PLACE_ALIASES: Record<string, string> = {
  'uae': 'uae', 'united arab emirates': 'uae', 'emirates': 'uae',
  'uk': 'united kingdom', 'united kingdom': 'united kingdom', 'great britain': 'united kingdom', 'england': 'united kingdom',
  'usa': 'united states', 'us': 'united states', 'united states': 'united states', 'america': 'united states',
  'nyc': 'new york', 'sf': 'san francisco', 'dc': 'washington dc',
}

/** A place name as we compare it: trimmed, lower-case, aliases folded ("UK" → "united kingdom"). */
export const canonPlace = (s: string) => {
  // fold accents so "San José" is "san jose"
  const k = s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return PLACE_ALIASES[k] ?? k
}
const canon = canonPlace

/**
 * Every region a location belongs to, lower-case, narrowest first — the location
 * itself, its state/metro or country, and the US for a US state. "Dubai, UAE"
 * → ["dubai, uae", "dubai", "uae"]; "Chicago" → ["chicago", "illinois",
 * "united states"]. Used so a member who asked for a country sees the city jobs
 * inside it.
 */
export function regionsOf(location: string | null): string[] {
  if (!location) return []
  const out = new Set<string>()
  const whole = canon(location)
  out.add(whole)
  // "Dubai, UAE" / "Zürich, Switzerland": each comma part is a place in its own right
  const parts = location.split(/[,/|·]/).map(canon).filter(Boolean)
  // "Multiple US Cities", "Remote (U.S.)": the country is named in the text
  if (/\bU\.?S\.?A?\b|united states/.test(location)) out.add('united states')
  for (const part of parts) {
    out.add(part)
    const region = CITY_TO_REGION[part]
    if (region) {
      out.add(canon(region))
      if (US_REGIONS.has(region)) out.add('united states')
    }
    if (US_REGIONS.has(part.replace(/\b\w/g, (c) => c.toUpperCase()))) out.add('united states')
  }
  return [...out]
}

/**
 * How close a job is to a target the member named, for ordering fallback matches:
 *   1 = same state/region (target San Jose, job Sacramento)
 *   2 = same country      (target San Jose, job Austin)
 *   3 = elsewhere
 * Exact matches are handled before this is consulted.
 */
export function nearness(target: string | null, jobLocation: string | null): 1 | 2 | 3 {
  if (!target || !jobLocation) return 3
  const tr = regionsOf(target)
  if (tr.length < 2) return 3
  const jr = regionsOf(jobLocation)
  if (jr.includes(tr[1])) return 1
  const country = tr[tr.length - 1]
  if (country !== tr[1] && jr.includes(country)) return 2
  return 3
}
