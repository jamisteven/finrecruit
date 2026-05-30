export type GroupedLocations = {
  country: string
  cities: string[]
}[]

const US_PATTERNS = [
  /new york|nyc|manhattan|brooklyn|bronx|queens|staten island/i,
  /los angeles|san francisco|bay area|silicon valley|san jose|oakland/i,
  /chicago|boston|seattle|austin|denver|miami|dallas|houston/i,
  /atlanta|philadelphia|phoenix|san diego|portland|las vegas/i,
  /washington.?dc|\bdc\b|mclean|bethesda|arlington|virginia|reston/i,
  /charlotte|nashville|minneapolis|detroit|baltimore|cleveland/i,
  /fort lauderdale|west palm beach|tampa|orlando|jacksonville/i,
  /salt lake|memphis|kansas city|st louis|pittsburgh|cincinnati/i,
  /milwaukee|indianapolis|columbus|louisville|richmond|raleigh/i,
  /new jersey|newark|jersey city|hoboken|princeton/i,
  /connecticut|hartford|stamford|greenwich/i,
  /irvine|newport beach|santa monica|pasadena|long beach/i,
  /scottsdale|tempe|chandler|gilbert|mesa|tucson/i,
  /boulder|colorado springs|fort collins/i,
  /schaumburg|evanston|naperville|oak park/i,
  /woodside|palo alto|menlo park|redwood city|burlingame/i,
  /plano|irving|frisco|mckinney|garland/i,
  /remote$|united states|\busa\b|\bus\b/i,
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/,
  /, [A-Z]{2}$/,
]

const UK_PATTERNS = [
  /london|city of london|canary wharf/i,
  /manchester|birmingham|edinburgh|glasgow|bristol|leeds|liverpool/i,
  /cambridge|oxford|reading|guildford|brighton|southampton/i,
  /\buk\b|united kingdom|england|scotland|wales|northern ireland/i,
  /haywards heath|bromley|kent|surrey|sussex|essex|hertfordshire/i,
  /sheffield|nottingham|leicester|coventry|newcastle|cardiff/i,
  /hatfield|watford|luton|slough|windsor|woking|basingstoke/i,
]

const CANADA_PATTERNS = [
  /toronto|vancouver|montreal|calgary|ottawa|waterloo|edmonton/i,
  /canada|\bon\b|\bbc\b|\bab\b|\bqc\b/i,
  /mississauga|brampton|hamilton|kitchener|london, on/i,
]

const EMEA_PATTERNS = [
  // Western Europe
  /amsterdam|netherlands|rotterdam|the hague/i,
  /frankfurt|berlin|munich|hamburg|dusseldorf|cologne|germany/i,
  /paris|lyon|marseille|france/i,
  /zurich|geneva|switzerland|basel/i,
  /dublin|ireland/i,
  /stockholm|sweden|gothenburg/i,
  /copenhagen|denmark|aarhus/i,
  /oslo|norway/i,
  /brussels|belgium|antwerp/i,
  /madrid|barcelona|spain|valencia/i,
  /milan|rome|italy|turin|florence/i,
  /lisbon|porto|portugal/i,
  /warsaw|krakow|poland/i,
  /vienna|austria/i,
  /luxembourg/i,
  /helsinki|finland/i,
  /amsterdam|utrecht|eindhoven/i,
  /prague|czech/i,
  /budapest|hungary/i,
  /bucharest|romania/i,
  /athens|greece/i,
  // Middle East & Africa
  /dubai|abu dhabi|uae|united arab emirates/i,
  /riyadh|jeddah|saudi/i,
  /tel aviv|israel|jerusalem/i,
  /johannesburg|cape town|south africa/i,
  /cairo|egypt/i,
  /beirut|lebanon/i,
  /doha|qatar/i,
  /kuwait/i,
  /bahrain/i,
  /nairobi|kenya/i,
  /lagos|nigeria/i,
]

const APAC_PATTERNS = [
  /singapore/i,
  /hong kong/i,
  /tokyo|osaka|japan/i,
  /sydney|melbourne|brisbane|perth|adelaide|australia/i,
  /mumbai|delhi|bangalore|hyderabad|india|noida|pune|chennai|kolkata|gurgaon/i,
  /shanghai|beijing|shenzhen|guangzhou|china/i,
  /seoul|busan|korea/i,
  /taipei|taiwan/i,
  /ho chi minh|hanoi|vietnam/i,
  /bangkok|thailand/i,
  /kuala lumpur|malaysia/i,
  /jakarta|indonesia/i,
  /manila|philippines/i,
  /auckland|new zealand/i,
  /dhaka|bangladesh/i,
  /karachi|lahore|pakistan/i,
  /colombo|sri lanka/i,
]

const LATAM_PATTERNS = [
  /são paulo|sao paulo|brazil|brasil|rio de janeiro/i,
  /mexico|ciudad de mexico|guadalajara/i,
  /bogota|medellin|colombia/i,
  /buenos aires|argentina/i,
  /santiago|chile/i,
  /lima|peru/i,
  /caracas|venezuela/i,
]

function matchesPatterns(loc: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(loc))
}

function assignRegion(loc: string): string | null {
  if (!loc || loc === 'Unknown' || loc === 'On-site') return null
  if (/^remote/i.test(loc)) return 'Remote'
  if (matchesPatterns(loc, US_PATTERNS)) return 'US'
  if (matchesPatterns(loc, UK_PATTERNS)) return 'UK'
  if (matchesPatterns(loc, CANADA_PATTERNS)) return 'Canada'
  if (matchesPatterns(loc, EMEA_PATTERNS)) return 'EMEA'
  if (matchesPatterns(loc, APAC_PATTERNS)) return 'APAC'
  if (matchesPatterns(loc, LATAM_PATTERNS)) return 'Latin America'
  return 'Other'
}

export function groupLocations(locations: string[]): GroupedLocations {
  const groups: Record<string, string[]> = {}

  for (const loc of locations) {
    const region = assignRegion(loc)
    if (!region) continue
    if (!groups[region]) groups[region] = []
    groups[region].push(loc)
  }

  // Sort cities within each group
  for (const region of Object.keys(groups)) {
    groups[region].sort()
  }

  const order = ['US', 'UK', 'Canada', 'EMEA', 'APAC', 'Remote', 'Latin America', 'Other']

  return order
    .filter((r) => groups[r]?.length > 0)
    .map((r) => ({ country: r, cities: groups[r] }))
}
