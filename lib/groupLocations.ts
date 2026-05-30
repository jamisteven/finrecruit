export type GroupedLocations = {
  country: string
  cities: string[]
}[]

// Order matters - more specific patterns first
const REGIONS: { name: string; patterns: RegExp[] }[] = [
  {
    name: 'US',
    patterns: [
      // Cities
      /new york|nyc|manhattan|brooklyn|bronx|queens/i,
      /\bny\b|new york city|new york, ny/i,
      /los angeles|san francisco|bay area|silicon valley|san jose|oakland/i,
      /chicago|boston|seattle|austin|denver|miami|dallas|houston/i,
      /atlanta|philadelphia|phoenix|san diego|portland|las vegas/i,
      /washington.?dc|\bdc\b|mclean|bethesda|arlington|virginia|herndon|reston/i,
      /charlotte|nashville|minneapolis|detroit|baltimore|cleveland/i,
      /fort lauderdale|west palm beach|tampa|orlando|jacksonville|palm beach/i,
      /salt lake|memphis|kansas city|st louis|pittsburgh|cincinnati|mason, oh/i,
      /milwaukee|indianapolis|columbus|louisville|richmond|raleigh/i,
      /new jersey|newark|jersey city|hoboken|princeton|morristown/i,
      /connecticut|hartford|stamford|greenwich/i,
      /irvine|newport beach|santa monica|pasadena|long beach|mill valley/i,
      /scottsdale|tempe|chandler|gilbert|mesa|tucson/i,
      /boulder|colorado springs|fort collins/i,
      /schaumburg|evanston|naperville|oak park/i,
      /woodside|palo alto|menlo park|redwood city|burlingame/i,
      /plano|irving|frisco|mckinney|garland/i,
      /lexington park|linthicum|marysville|middletown|maitland/i,
      /philadelphia|portland|pasadena|pleasant prairie|reston/i,
      /san francisco|sf|san jose|santa clara|sunnyvale|walnut creek/i,
      /seattle|st\.? louis|stamford|stanford|sunnyvale/i,
      /tampa|tinton falls|texas|west coast|west covina/i,
      /washington|waunakee|wilmington|us|usa/i,
      /midtown|lekki/i,
      /ocean city|mill valley|newport/i,
      /novi, michigan|\bmi\b|michigan/i,
      /indiana\b|iowa\b/i,
      /united states|\busa\b/i,
      /remote$|^remote/i,
      // State codes at end of string
      /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/,
      /\b(AL|AK|AZ|AR|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MN|MS|MO|MT|NE|NV|NH|NM|NC|ND|OH|OK|OR|RI|SC|SD|TN|UT|VT|WA|WV|WI|WY)\b/,
    ],
  },
  {
    name: 'UK',
    patterns: [
      /london|city of london|canary wharf/i,
      /london area/i,
      /manchester|birmingham|edinburgh|glasgow|bristol|leeds|liverpool/i,
      /cambridge|oxford|reading|guildford|brighton|southampton/i,
      /\buk\b|united kingdom|england|scotland|wales|northern ireland/i,
      /haywards heath|bromley|kent|surrey|sussex|essex|hertfordshire/i,
      /sheffield|nottingham|leicester|coventry|newcastle|cardiff/i,
      /hatfield|watford|luton|slough|windsor|woking|basingstoke/i,
      /ashton|epsom|forres|birkirkara|south west|tunbridge wells/i,
    ],
  },
  {
    name: 'Canada',
    patterns: [
      /toronto|vancouver|montreal|calgary|ottawa|waterloo|edmonton/i,
      /\btoronto\b/i,
      /mississauga|brampton|hamilton|kitchener|oakville|ontario/i,
      /\bcanada\b/i,
    ],
  },
  {
    name: 'EMEA',
    patterns: [
      // Western Europe
      /amsterdam|netherlands|rotterdam|eindhoven|veldhoven/i,
      /frankfurt|berlin|munich|hamburg|dusseldorf|cologne|\bgermany\b/i,
      /paris|lyon|marseille|\bfrance\b/i,
      /zurich|geneva|switzerland|basel/i,
      /dublin|\bireland\b/i,
      /stockholm|\bsweden\b|gothenburg/i,
      /copenhagen|\bdenmark\b/i,
      /oslo|\bnorway\b/i,
      /brussels|\bbelgium\b|antwerp/i,
      /madrid|barcelona|\bspain\b|valencia/i,
      /milan|rome|\bitaly\b|turin|florence/i,
      /lisbon|porto|\bportugal\b/i,
      /warsaw|krakow|\bpoland\b/i,
      /vienna|\baustria\b/i,
      /luxembourg/i,
      /helsinki|\bfinland\b/i,
      /prague|czech/i,
      /budapest|\bhungary\b/i,
      /bucharest|\bromania\b/i,
      /athens|\bgreece\b/i,
      /dach|benelux/i,
      // Middle East & Africa
      /dubai|abu dhabi|\buae\b|united arab emirates/i,
      /riyadh|jeddah|\bsaudi\b/i,
      /tel aviv|\bisrael\b|jerusalem/i,
      /johannesburg|cape town|south africa/i,
      /cairo|\begypt\b/i,
      /beirut|\blebanon\b/i,
      /doha|\bqatar\b/i,
      /kuwait|bahrain/i,
      /nairobi|\bkenya\b|uganda/i,
      /lagos|\bnigeria\b|maiduguri/i,
      /lekki/i,
    ],
  },
  {
    name: 'APAC',
    patterns: [
      /singapore/i,
      /hong kong/i,
      /tokyo|osaka|\bjapan\b/i,
      /sydney|melbourne|brisbane|perth|adelaide|\baustralia\b|maitland|dunedin/i,
      /mumbai|delhi|bangalore|bengaluru|hyderabad|noida|pune|chennai|kolkata|gurgaon|gurugram|ahmedabad|chandigarh|indore|jaipur|gachibowli|\bindia\b/i,
      /new delhi|delhi ncr/i,
      /shanghai|beijing|shenzhen|guangzhou|\bchina\b/i,
      /seoul|busan|\bkorea\b/i,
      /taipei|\btaiwan\b/i,
      /ho chi minh|hanoi|\bvietnam\b/i,
      /bangkok|\bthailand\b/i,
      /kuala lumpur|\bmalaysia\b/i,
      /jakarta|\bindonesia\b/i,
      /manila|\bphilippines\b/i,
      /auckland|new zealand|dunedin/i,
      /dhaka|\bbangladesh\b/i,
      /karachi|lahore|\bpakistan\b/i,
      /colombo|sri lanka/i,
    ],
  },
  {
    name: 'Latin America',
    patterns: [
      /são paulo|sao paulo|\bbrazil\b|rio de janeiro/i,
      /mexico|ciudad de mexico|guadalajara/i,
      /bogota|medellin|\bcolombia\b/i,
      /buenos aires|\bargentina\b/i,
      /santiago|\bchile\b/i,
      /lima|\bperu\b/i,
      /belize/i,
    ],
  },
]

// Locations to skip entirely
const SKIP = /^(unknown|on-site|onsite|in-office|multiple|hybrid|various)$/i

function assignRegion(loc: string): string | null {
  if (!loc || SKIP.test(loc.trim())) return null
  if (/^remote/i.test(loc)) return 'Remote'

  for (const { name, patterns } of REGIONS) {
    if (patterns.some((p) => p.test(loc))) return name
  }

  return 'Other'
}

export function groupLocations(locations: string[]): GroupedLocations {
  const groups: Record<string, string[]> = {}

  for (const loc of locations) {
    const region = assignRegion(loc)
    if (!region) continue
    if (!groups[region]) groups[region] = []
    if (!groups[region].includes(loc)) groups[region].push(loc)
  }

  for (const region of Object.keys(groups)) {
    groups[region].sort()
  }

  const order = ['US', 'UK', 'Canada', 'EMEA', 'APAC', 'Remote', 'Latin America', 'Other']

  return order
    .filter((r) => groups[r]?.length > 0)
    .map((r) => ({ country: r, cities: groups[r] }))
}
