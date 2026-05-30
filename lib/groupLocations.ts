// Groups a flat list of location strings into Country -> [cities]
// Uses heuristics based on common patterns in the data

const COUNTRY_PATTERNS: { country: string; flag: string; patterns: RegExp[] }[] = [
  {
    country: 'United States',
    flag: '🇺🇸',
    patterns: [
      /new york|nyc|manhattan|brooklyn/i,
      /los angeles|san francisco|bay area|silicon valley/i,
      /chicago|boston|seattle|austin|denver|miami|dallas/i,
      /atlanta|houston|philadelphia|phoenix|san diego/i,
      /washington.?dc|dc|mclean|bethesda|virginia/i,
      /boston|cambridge|waltham|newton/i,
      /charlotte|nashville|minneapolis|portland/i,
      /remote$|united states|usa|\bUS\b/i,
      /, [A-Z]{2}$/,  // ends with state code like "Austin, TX"
    ],
  },
  {
    country: 'United Kingdom',
    flag: '🇬🇧',
    patterns: [
      /london|city of london/i,
      /manchester|birmingham|edinburgh|glasgow|bristol|leeds/i,
      /cambridge|oxford|reading|guildford|brighton/i,
      /uk|united kingdom|england|scotland|wales/i,
      /haywards heath|bromley|kent|surrey|sussex/i,
    ],
  },
  {
    country: 'Canada',
    flag: '🇨🇦',
    patterns: [
      /toronto|vancouver|montreal|calgary|ottawa|waterloo/i,
      /canada/i,
    ],
  },
  {
    country: 'Europe',
    flag: '🇪🇺',
    patterns: [
      /amsterdam|netherlands/i,
      /frankfurt|berlin|munich|hamburg|germany/i,
      /paris|france/i,
      /zurich|switzerland/i,
      /dublin|ireland/i,
      /stockholm|sweden/i,
      /copenhagen|denmark/i,
      /oslo|norway/i,
      /brussels|belgium/i,
      /madrid|barcelona|spain/i,
      /milan|rome|italy/i,
      /lisbon|portugal/i,
      /warsaw|poland/i,
      /vienna|austria/i,
      /luxembourg/i,
    ],
  },
  {
    country: 'Asia Pacific',
    flag: '🌏',
    patterns: [
      /singapore/i,
      /hong kong/i,
      /tokyo|japan/i,
      /sydney|melbourne|brisbane|australia/i,
      /mumbai|delhi|bangalore|hyderabad|india|noida|pune/i,
      /shanghai|beijing|china/i,
      /seoul|korea/i,
      /taipei|taiwan/i,
    ],
  },
  {
    country: 'Middle East & Africa',
    flag: '🌍',
    patterns: [
      /dubai|abu dhabi|uae/i,
      /riyadh|saudi/i,
      /tel aviv|israel/i,
      /johannesburg|south africa/i,
      /cairo|egypt/i,
      /beirut|lebanon/i,
    ],
  },
  {
    country: 'Latin America',
    flag: '🌎',
    patterns: [
      /são paulo|brazil|brasil/i,
      /mexico|ciudad de mexico/i,
      /bogota|colombia/i,
      /buenos aires|argentina/i,
      /santiago|chile/i,
      /lima|peru/i,
    ],
  },
]

export type GroupedLocations = {
  country: string
  flag: string
  cities: string[]
}[]

export function groupLocations(locations: string[]): GroupedLocations {
  const groups: Record<string, { flag: string; cities: string[] }> = {}
  const unmatched: string[] = []

  for (const loc of locations) {
    if (!loc || loc === 'Unknown' || loc === 'On-site') continue

    let matched = false
    for (const { country, flag, patterns } of COUNTRY_PATTERNS) {
      if (patterns.some((p) => p.test(loc))) {
        if (!groups[country]) groups[country] = { flag, cities: [] }
        groups[country].cities.push(loc)
        matched = true
        break
      }
    }

    if (!matched) unmatched.push(loc)
  }

  // Add Remote separately
  const remoteLocations = locations.filter((l) => /^remote/i.test(l))
  if (remoteLocations.length > 0) {
    groups['Remote'] = { flag: '🌐', cities: remoteLocations }
  }

  // Add unmatched as "Other"
  const filteredUnmatched = unmatched.filter((l) => !/^remote/i.test(l))
  if (filteredUnmatched.length > 0) {
    groups['Other'] = { flag: '📍', cities: filteredUnmatched }
  }

  // Sort: put major regions first
  const order = ['United States', 'United Kingdom', 'Canada', 'Europe', 'Asia Pacific', 'Remote', 'Middle East & Africa', 'Latin America', 'Other']

  return order
    .filter((c) => groups[c])
    .map((c) => ({ country: c, flag: groups[c].flag, cities: groups[c].cities.sort() }))
}
