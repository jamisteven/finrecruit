// Normalise location strings into canonical city names

const ALIASES: Record<string, string> = {
  // New York
  'nyc': 'New York',
  'new york city': 'New York',
  'new york, ny': 'New York',
  'new york ny': 'New York',
  'new york (ny)': 'New York',
  'manhattan': 'New York',
  'midtown': 'New York',
  'midtown nyc': 'New York',
  'midtown manhattan': 'New York',
  'downtown nyc': 'New York',
  'new york metropolitan area': 'New York',
  'ny': 'New York',
  'new york / london': 'New York / London',
  'new york or london': 'New York / London',

  // London
  'city of london': 'London',
  'london, uk': 'London',
  'london uk': 'London',
  'london, england': 'London',
  'london area': 'London',
  'london area, united kingdom': 'London',
  'greater london': 'London',
  'central london': 'London',
  'west end': 'London',

  // San Francisco
  'sf': 'San Francisco',
  'san francisco, ca': 'San Francisco',
  'san francisco bay area': 'San Francisco',
  'bay area': 'San Francisco',
  'silicon valley': 'San Francisco',

  // Los Angeles
  'la': 'Los Angeles',
  'los angeles, ca': 'Los Angeles',

  // Chicago
  'chicago, il': 'Chicago',
  'chicago il': 'Chicago',

  // Boston
  'boston, ma': 'Boston',

  // Washington DC
  'washington dc': 'Washington DC',
  'washington, dc': 'Washington DC',
  'd.c.': 'Washington DC',
  'dc': 'Washington DC',

  // Toronto
  'toronto, on': 'Toronto',
  'toronto, canada': 'Toronto',
  'greater toronto': 'Toronto',

  // Frankfurt
  'frankfurt am main': 'Frankfurt',
  'frankfurt, germany': 'Frankfurt',

  // Zurich
  'zürich': 'Zurich',
  'zurich, switzerland': 'Zurich',
  'zürich, switzerland': 'Zurich',

  // Hong Kong
  'hong kong sar': 'Hong Kong',
  'hong kong, china': 'Hong Kong',

  // Singapore
  'singapore, singapore': 'Singapore',

  // Dubai
  'dubai, uae': 'Dubai',
  'dubai, united arab emirates': 'Dubai',

  // Remote
  'fully remote': 'Remote',
  'remote / hybrid': 'Remote',
  'work from home': 'Remote',
  'wfh': 'Remote',
  'remote-first': 'Remote',
  'on-site': 'On-site',
  'onsite': 'On-site',
}

export function normaliseLocation(raw: string | null): string | null {
  if (!raw) return null
  const lower = raw.trim().toLowerCase()
  if (ALIASES[lower]) return ALIASES[lower]
  // Title case the original if no alias found
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase())
}
