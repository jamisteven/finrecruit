import type { WorkType } from '@/types'

// What the location and work-type rules need from a role. Both the page and /api/jobs use this file,
// so the counts the server sends for the region and city lists follow the very same rules as the feed filter.
export type LocJob = { location?: string | null; tags?: string[] | null; title?: string | null; work_type?: WorkType | null }

// Country/region groups so "Switzerland" catches Zurich, Geneva, Basel, …
// Keywords ≤3 chars are matched as whole words to avoid e.g. "us" matching "Austin".
export const REGIONS: Record<string, string[]> = {
  'Switzerland': ['switzerland', 'zurich', 'zürich', 'geneva', 'genève', 'genf', 'basel', 'bern', 'berne', 'lausanne', 'zug', 'lugano', 'st. gallen', 'winterthur', 'schaffhausen', 'visp', 'bülach', 'neuchâtel', 'biel', 'mägenwil', 'opfikon', 'lucerne', 'luzern', 'dübendorf', 'urdorf', 'baar', 'thun', 'wetzikon', 'uster', 'valais', 'rotkreuz', 'crissier', 'montreux', 'davos', 'sursee', 'glattbrugg', 'dietikon', 'horgen', 'pratteln', 'écublens', 'étoy', 'orsières', 'la chaux-de-fonds', 'weinfelden', 'emmen', 'oensingen', 'altdorf', 'cazis', 'vaud', 'aargau', 'ticino', 'bütschwil', 'amriswil', 'wohlen', 'netstal', 'oberburg', 'zeiningen', 'dielsdorf', 'beringen', 'affoltern am albis', 'moosseedorf', 'hünenberg'],
  'United Kingdom': ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'london', 'manchester', 'edinburgh', 'birmingham', 'leeds', 'glasgow', 'bristol', 'cambridge', 'oxford', 'belfast', 'liverpool', 'crawley', 'oxfordshire', 'west midlands', 'milton keynes', 'kingston upon thames', 'wimbledon', 'brighton', 'leicester', 'oldham', 'rochdale', 'cobham', 'rothley', 'st austell', 'wallasey', 'spennymoor', 'telford', 'solihull', 'stockport', 'bolton', 'sheffield', 'nottingham', 'cardiff', 'swansea', 'aylesford', 'croydon', 'maidenhead', 'weybridge', 'slough', 'wootton bassett', 'cowbridge', 'southampton', 'coventry', 'derby', 'hertfordshire', 'cheshire', 'hampshire', 'kent', 'devon', 'potters bar', 'east horsley', 'hereford', 'marlow', 'ascot', 'deeside', 'south uk'],
  'United States': ['united states', 'usa', 'us', 'new york', 'nyc', 'san francisco', 'bay area', 'boston', 'chicago', 'los angeles', 'austin', 'seattle', 'miami', 'atlanta', 'dallas', 'houston', 'denver', 'washington', 'charlotte', 'philadelphia', 'columbus', 'st. louis', 'st louis', 'saint louis', 'minneapolis', 'san antonio', 'cincinnati', 'nashville', 'raleigh', 'san diego', 'phoenix', 'salt lake city', 'portland', 'kansas city', 'memphis', 'pittsburgh', 'baltimore', 'las vegas', 'richmond', 'detroit', 'jersey city', 'san jose', 'tampa', 'hartford', 'plano', 'milwaukee', 'sunnyvale', 'palo alto', 'mountain view', 'jacksonville', 'bellevue', 'arlington', 'cleveland', 'newark', 'mclean', 'orlando', 'oklahoma city', 'malvern', 'king of prussia', 'brooklyn', 'queens', 'santa clara', 'reston', 'wilmington', 'scottsdale', 'ann arbor', 'springfield', 'madison', 'albany', 'redmond', 'buffalo', 'oakland', 'tucson', 'bethesda', 'stamford', 'norwalk', 'irvine', 'pasadena', 'harrisburg', 'fresno', 'rochester', 'wichita', 'frisco', 'sacramento', 'irving', 'coppell', 'herndon', 'waltham', 'multiple us locations', 'multiple us cities', 'remote usa', 'northern virginia', 'south florida', 'southern california', 'northeast region', 'long island', 'fort worth', 'dallas-fort worth', 'raleigh-durham', 'boca raton', 'fort lauderdale', 'santa monica', 'santa barbara', 'princeton', 'hoboken', 'white plains', 'tulsa', 'omaha', 'colorado springs', 'el segundo', 'louisville', 'knoxville', 'honolulu', 'sioux falls', 'spokane', 'savannah', 'providence', 'worcester', 'natick', 'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia', 'washington dc', 'washington d.c.', 'dc', 'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'],
  'Germany': ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'frankfurt', 'hamburg', 'cologne', 'köln', 'düsseldorf', 'stuttgart', 'hannover', 'karlsruhe', 'heilbronn', 'ulm', 'münster', 'bonn', 'dresden', 'mannheim', 'mainz', 'wiesbaden', 'essen', 'bremen', 'nürnberg', 'nuremberg', 'leipzig', 'dortmund', 'aachen', 'erfurt', 'augsburg', 'potsdam', 'trier', 'kiel', 'ratingen', 'landshut', 'würzburg', 'tübingen', 'marburg', 'offenburg', 'forchheim', 'herten', 'mülheim an der ruhr', 'bielefeld', 'kaiserslautern', 'saarbrücken', 'friedrichshafen', 'east germany', 'northern germany', 'southern germany', 'north rhine-westphalia', 'hessen', 'niedersachsen', 'bavaria', 'bayern', 'baden-württemberg'],
  'France': ['france', 'paris', 'lyon', 'marseille', 'courbevoie', 'lille', 'antony', 'auch', 'bordeaux', 'toulouse'],
  'Netherlands': ['netherlands', 'amsterdam', 'rotterdam', 'the hague', 'utrecht', 'eindhoven', 'delft', 'schiphol', 'schiphol-rijk', 'groningen'],
  'UAE': ['uae', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah', 'ras al khaimah', 'ajman'],
  'Singapore': ['singapore'],
  'Hong Kong': ['hong kong'],
  'India': ['india', 'mumbai', 'bangalore', 'bengaluru', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'hyderabad', 'pune', 'chennai', 'ahmedabad', 'noida', 'lucknow', 'agra', 'meerut', 'nagpur', 'thane', 'trivandrum', 'kerala', 'tamil nadu', 'rajkot', 'surat', 'rohtak', 'kolkata'],
  'Australia': ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'north sydney', 'campbelltown', 'toowoomba', 'wodonga'],
  'Canada': ['canada', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa', 'mississauga', 'edmonton', 'winnipeg', 'markham', 'brockville', 'ontario', 'alberta', 'guelph', 'coquitlam', 'owen sound', 'north york', 'british columbia', 'quebec'],
  'Spain': ['spain', 'españa', 'espana', 'madrid', 'barcelona', 'seville', 'sevilla', 'malaga', 'málaga', 'bilbao', 'palma de mallorca', 'mallorca', 'alicante', 'zaragoza', 'ibiza', 'catalonia', 'catalunya', 'andalusia', 'canary islands'],
  'Ireland': ['ireland', 'dublin', 'tullamore', 'limerick', 'athlone', 'donegal', 'tipperary', 'waterford', 'meath', 'cork', 'galway'],
  'Saudi Arabia': ['saudi arabia', 'ksa', 'riyadh', 'jeddah', 'makkah', 'mecca', 'dammam', 'al qassim', 'khurais'],
  'Qatar': ['qatar', 'doha'],
  'Egypt': ['egypt', 'cairo', 'new cairo', 'giza', 'nasr city', 'mansoura', '10th of ramadan city'],
  'South Africa': ['south africa', 'johannesburg', 'cape town', 'pretoria', 'durban', 'sandton', 'centurion', 'gauteng', 'western cape', 'kwazulu-natal', 'postmasburg'],
  'Nigeria': ['nigeria', 'lagos', 'abuja', 'port harcourt', 'bauchi'],
  'Kenya': ['kenya', 'nairobi'],
  'Pakistan': ['pakistan', 'islamabad', 'rawalpindi', 'lahore', 'karachi', 'gujranwala', 'sialkot', 'sukkur', 'kotli'],
  'Malaysia': ['malaysia', 'kuala lumpur', 'penang', 'cyberjaya', 'sepang', 'petaling jaya'],
  'Philippines': ['philippines', 'manila', 'quezon city', 'makati', 'pasay', 'taguig', 'taguig city', 'bgc', 'cebu', 'parañaque', 'paranaque'],
  'Indonesia': ['indonesia', 'jakarta', 'bali', 'bsd city', 'banyuasin', 'aceh tengah'],
  'Israel': ['israel', 'tel aviv', 'netanya', 'holon', 'ramat gan', 'hadera', 'jerusalem', 'nazareth'],
  'Poland': ['poland', 'warsaw', 'krakow', 'kraków', 'wroclaw', 'gdansk', 'poznan'],
  'Austria': ['austria', 'österreich', 'wien', 'innsbruck', 'klagenfurt', 'vorarlberg', 'rankweil', 'salzburg', 'graz', 'linz'],
  'Italy': ['italy', 'italia', 'milan', 'milano', 'rome', 'roma', 'bolzano', 'turin', 'torino', 'bologna', 'pastorano'],
  'Belgium': ['belgium', 'brussels', 'antwerp', 'wavre', 'ghent'],
  'Portugal': ['portugal', 'lisbon', 'porto'],
  'Nordics': ['sweden', 'stockholm', 'halmstad', 'finland', 'helsinki', 'denmark', 'copenhagen', 'norway', 'oslo', 'trondheim'],
  'Mexico': ['mexico', 'mexico city', 'hermosillo', 'monterrey', 'guadalajara'],
  'Brazil': ['brazil', 'são paulo', 'sao paulo', 'parnamirim'],
  'Nepal': ['nepal', 'kathmandu', 'chitwan'],
}

// A US state in the location ("Geneva, New York", "Lake Zurich, IL") means it is a US role,
// so it must not also count for a same-named place abroad.
export const US_STATE_PARTS = new Set(['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia', 'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'])

export const REGION_NAMES_LC = new Set(Object.keys(REGIONS).map((k) => k.toLowerCase()))

// Word-boundary keyword matching: "bern" must appear as a whole word, so it
// matches "Bern" and "bern, switzerland" but NOT "Abernathy"; "india" must not
// match "Indianapolis". Boundaries are any non-letter/non-digit (unicode-aware).
const kwRegexCache = new Map<string, RegExp>()
export const matchKw = (part: string, kw: string) => {
  let re = kwRegexCache.get(kw)
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, 'u')
    kwRegexCache.set(kw, re)
  }
  return re.test(part)
}

// Split compound locations into atomic parts: "New York / London" → two cities,
// "Remote (Texas)" → remote + texas. Splits on | , / and parentheses.
export const locParts = (location: string) =>
  location.replace(/[()]/g, ',').split(/[|,/]/).map((l) => l.trim().toLowerCase()).filter(Boolean)

// Tokens that are work arrangements, not places — never shown as city chips
export const CITY_STOP = new Set(['hybrid', 'on-site', 'onsite', 'on site', 'office', 'flexible', 'wfh'])

export const jobInRegion = (job: LocJob, region: string) => {
  const kws = REGIONS[region]
  if (!kws || !job.location) return false
  const parts = locParts(job.location)
  if (region !== 'United States' && parts.some((p) => US_STATE_PARTS.has(p))) return false
  return parts.some((p) => kws.some((k) => matchKw(p, k)))
}

export function inferWorkType(job: LocJob): WorkType | null {
  const text = `${job.location || ''} ${job.tags?.join(' ') || ''} ${job.title || ''}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'Hybrid'
  if (/\bremote\b/.test(text)) return 'Remote'
  if (/\bon.?site\b|in.?office\b|in.?person\b/.test(text)) return 'On-site'
  return null
}

export type LocationFacets = {
  total: number                                  // roles that pass the sector and work-type filters
  regions: { name: string; count: number }[]    // regions with at least one role, biggest first
  cities?: { name: string; count: number }[]    // cities (scoped to `region` when one is chosen), biggest first
}

/**
 * Region and city counts over a list of roles, with the sector and work-type filters applied but not the
 * location itself (so the numbers are what choosing that place would show). One pass per list.
 * A role located "New York / London" counts once under each city; region names and work-mode words never
 * appear as cities.
 */
export function locationFacets(
  jobs: (LocJob & { sector?: string | null })[],
  opts: { sector?: string | null; workTypes?: WorkType[]; region?: string | null; cities?: boolean },
): LocationFacets {
  const sector = opts.sector && opts.sector !== 'all' ? opts.sector : null
  const wts = opts.workTypes ?? []
  const base = jobs.filter((j) => {
    if (sector && j.sector !== sector) return false
    if (wts.length > 0) {
      const wt = j.work_type ?? inferWorkType(j)
      if (!wt || !wts.includes(wt)) return false
    }
    return true
  })
  const regions = Object.keys(REGIONS)
    .map((name) => ({ name, count: base.filter((j) => jobInRegion(j, name)).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
  const out: LocationFacets = { total: base.length, regions }
  if (opts.cities) {
    const scoped = opts.region && REGIONS[opts.region] ? base.filter((j) => jobInRegion(j, opts.region as string)) : base
    out.cities = cityTally(scoped)
  }
  return out
}

// Single pass: parse each role's location once and tally every part it contains.
export function cityTally(jobs: LocJob[]): { name: string; count: number }[] {
  const tally = new Map<string, { name: string; count: number }>()
  for (const j of jobs) {
    if (!j.location) continue
    const seen = new Set<string>()
    for (const raw of j.location.replace(/[()]/g, ',').split(/[|,/]/)) {
      const name = raw.trim()
      if (!name || name.length >= 40) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (REGION_NAMES_LC.has(key) || CITY_STOP.has(key)) continue
      const cur = tally.get(key)
      if (cur) cur.count++
      else tally.set(key, { name, count: 1 })
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
