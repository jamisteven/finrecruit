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

/** Every US state maps up to the country; everything else is already national. */
const US_REGIONS = new Set([
  'California', 'Texas', 'New York', 'Massachusetts', 'Washington', 'Illinois',
  'Colorado', 'Georgia', 'Florida', 'North Carolina', 'Arizona', 'Pennsylvania',
  'Michigan', 'Minnesota', 'Tennessee', 'Oregon', 'Utah', 'Nevada', 'Ohio',
  'Missouri', 'Maryland', 'Washington DC', 'Virginia', 'New Jersey', 'Indiana',
  'Wisconsin',
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
