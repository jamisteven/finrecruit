// Which markets we serve. A post can be a perfectly real job and still be useless
// to every member because nobody here is in Lagos or on IST hours.

const OFF_MARKET_PLACES = [
  // South Asia — the old INDIA_LOCATIONS list, now in one place
  'bengaluru', 'bangalore', 'hyderabad', 'mumbai', 'pune', 'chennai', 'noida', 'gurugram',
  'gurgaon', 'delhi', 'kolkata', 'ahmedabad', 'jaipur', 'chandigarh', 'indore', 'surat',
  'nashik', 'visakhapatnam', 'mohali', 'vadodara', 'gujarat', 'india',
  'karachi', 'lahore', 'islamabad', 'pakistan', 'dhaka', 'bangladesh', 'colombo', 'sri lanka',
  'kathmandu', 'nepal',
  // Africa
  'lagos', 'abuja', 'nigeria', 'nairobi', 'kenya', 'accra', 'ghana', 'cairo', 'egypt',
  // South-east Asia
  'manila', 'philippines', 'jakarta', 'indonesia', 'hanoi', 'ho chi minh', 'vietnam',
  'kuala lumpur', 'malaysia',
]

// ISO-3166 alpha-2 codes the classifier may return in `country`.
const OFF_MARKET_COUNTRIES = new Set([
  'IN', 'PK', 'BD', 'LK', 'NP', 'NG', 'KE', 'GH', 'EG', 'PH', 'ID', 'VN', 'MY',
])

/**
 * Why a classified job is off-market for our members, or null if it isn't.
 * Checks the extracted location (city names) and the extracted country (so a
 * "Remote" role restricted to one of these countries is caught too).
 */
export function offMarketReason(c: { location: string | null; country?: string | null }): string | null {
  const loc = (c.location || '').toLowerCase()
  const place = OFF_MARKET_PLACES.find((p) => loc.includes(p))
  if (place) return `location: ${c.location}`
  const country = (c.country || '').toUpperCase().trim()
  if (country && OFF_MARKET_COUNTRIES.has(country)) {
    return `country: ${country}${loc ? ` (${c.location})` : ''}`
  }
  return null
}
