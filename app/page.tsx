'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { JobPost, FilterState, Sector, WorkType } from '@/types'
import { keywordMatches, locationMatches } from '@/lib/matchTarget'
import { nearness } from '@/lib/widenLocation'
import EmployerStrip, { type StripCompany } from '@/components/EmployerStrip'
import { captureAttribution } from '@/lib/attribution'

const DEFAULT_FILTERS: FilterState = {
  sector: 'all', seniority: 'All', locations: [], workTypes: [], search: '', sortBy: 'newest',
}

const SECTORS: { id: Sector; label: string }[] = [
  { id: 'all',       label: 'All sectors' },
  { id: 'finance',   label: 'Finance' },
  { id: 'tech',      label: 'Tech' },
  { id: 'legal',     label: 'Legal' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'realestate', label: 'Real Estate' },
  { id: 'sales',     label: 'Sales' },
  { id: 'hr',        label: 'HR & Talent' },
]

const WORK_TYPES: WorkType[] = ['Remote', 'Hybrid', 'On-site']

// Free visitors see a role only after it is this old; a pass sees it the moment it lands.
const FREE_DELAY_HOURS = 48

const SEARCH_EXAMPLES = [
  'product manager', 'software engineer', 'remote', 'Zurich', 'London', 'data analyst',
  'investment banking', 'marketing manager', 'account executive', 'legal counsel',
  'customer success', 'real estate', 'UX designer', 'Berlin', 'compliance',
]
const CTA_LABEL = "Unlock Today's Roles — $9 First Month"

const PIPELINE_LABELS: Record<string, string> = {
  hashtags: 'Fresh roles',
  recruiters: 'Recruiter posts',
}
const sectorLabel = (s: string) =>
  PIPELINE_LABELS[s] ??
  SECTORS.find((x) => x.id === s)?.label ??
  (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other')

// ── Drop schedule (UTC) — mirrors the crons in vercel.json ──
const DROP_SECTORS_FULL = ['finance', 'tech', 'legal', 'marketing', 'realestate', 'sales', 'hr']
type DropBatch = { days: number[]; utcHour: number; utcMin: number; sectors: string[] }
const DROP_BATCHES_FALLBACK: DropBatch[] = [
  { days: [1, 2, 3, 4, 5], utcHour: 13, utcMin: 0, sectors: DROP_SECTORS_FULL },
]
const SLOT_MS = 10 * 60_000
const TAIL_MS = 5 * 60_000

type Drop = { start: number; end: number; sectors: string[] }

function dropsAround(now: number, dropBatches: DropBatch[]): { prev: Drop | null; next: Drop | null; current: Drop | null } {
  const drops: Drop[] = []
  const base = new Date(now)
  for (let d = -8; d <= 8; d++) {
    const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + d))
    for (const b of dropBatches) {
      if (!b.days.includes(day.getUTCDay())) continue
      const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), b.utcHour, b.utcMin)
      drops.push({ start, end: start + (b.sectors.length - 1) * SLOT_MS + TAIL_MS, sectors: b.sectors })
    }
  }
  drops.sort((a, b) => a.start - b.start)
  return {
    current: drops.find((dr) => now >= dr.start && now < dr.end) ?? null,
    next: drops.find((dr) => dr.start > now) ?? null,
    prev: [...drops].reverse().find((dr) => dr.end <= now) ?? null,
  }
}

const REGIONS: Record<string, string[]> = {
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

const US_STATE_PARTS = new Set(['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia', 'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'])

const REGION_NAMES_LC = new Set(Object.keys(REGIONS).map((k) => k.toLowerCase()))

const kwRegexCache = new Map<string, RegExp>()
const matchKw = (part: string, kw: string) => {
  let re = kwRegexCache.get(kw)
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, 'u')
    kwRegexCache.set(kw, re)
  }
  return re.test(part)
}

const locParts = (location: string) =>
  location.replace(/[()]/g, ',').split(/[|,/]/).map((l) => l.trim().toLowerCase()).filter(Boolean)

const CITY_STOP = new Set(['hybrid', 'on-site', 'onsite', 'on site', 'office', 'flexible', 'wfh'])

const jobInRegion = (job: JobPost, region: string) => {
  const kws = REGIONS[region]
  if (!kws || !job.location) return false
  const parts = locParts(job.location)
  if (region !== 'United States' && parts.some((p) => US_STATE_PARTS.has(p))) return false
  return parts.some((p) => kws.some((k) => matchKw(p, k)))
}

function inferWorkType(job: JobPost): WorkType | null {
  const text = `${job.location || ''} ${job.tags?.join(' ') || ''} ${job.title || ''}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'Hybrid'
  if (/\bremote\b/.test(text)) return 'Remote'
  if (/\bon.?site\b|in.?office\b|in.?person\b/.test(text)) return 'On-site'
  return null
}

type LockedJob = { title: string; sector: string; posted_at: string | null }

const toTime = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0)

const SEARCH_SYNONYMS: Record<string, string[]> = {
  swe: ['software engineer', 'software developer'],
  sde: ['software development engineer', 'software engineer'],
  sre: ['site reliability'],
  devops: ['devops', 'dev ops', 'platform engineer'],
  fe: ['front end', 'frontend', 'front-end'],
  be: ['back end', 'backend', 'back-end'],
  fullstack: ['full stack', 'fullstack', 'full-stack'],
  pm: ['product manager', 'project manager', 'program manager'],
  tpm: ['technical program manager', 'technical project manager'],
  pmm: ['product marketing'],
  ml: ['machine learning'],
  grc: ['grc', 'governance, risk', 'governance risk', 'risk and compliance', 'risk & compliance'],
  ds: ['data scientist', 'data science'],
  da: ['data analyst'],
  ba: ['business analyst'],
  qa: ['quality assurance', 'qa engineer', 'test engineer'],
  hr: ['human resources', 'hr manager', 'people operations'],
  vp: ['vice president', 'vp of'],
  svp: ['senior vice president'],
  md: ['managing director'],
  ae: ['account executive'],
  sdr: ['sales development'],
  bdr: ['business development'],
  csm: ['customer success'],
  cfo: ['chief financial', 'cfo'],
  coo: ['chief operating', 'coo'],
  cto: ['chief technology', 'cto'],
  ib: ['investment bank'],
  pe: ['private equity'],
  vc: ['venture capital'],
  re: ['real estate'],
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev2: number[] = []
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2.length = 0
    prev2.push(...prev)
    prev = cur
  }
  return prev[b.length]
}

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const isFresh = (iso?: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 86400000

function unlockLabel(postedAt?: string | null): string | null {
  if (!postedAt) return null
  const t = new Date(postedAt).getTime()
  if (isNaN(t)) return null
  const at = new Date(t + FREE_DELAY_HOURS * 3600_000)
  const now = new Date()
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const dayDiff = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000)
  const day = dayDiff <= 0 ? 'today' : dayDiff === 1 ? 'tomorrow' : at.toLocaleDateString(undefined, { weekday: 'long' })
  return `${day} ${time}`
}

const STAND_IN_NAMES = ['Alex Morgan', 'Sam Okafor', 'Jordan Lee', 'Priya Natarajan', 'Chris Delacroix', 'Morgan Whitfield', 'Taylor Brooks', 'Dana Kowalski']
const standInName = (id: string) => STAND_IN_NAMES[(id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % STAND_IN_NAMES.length]

const initials = (name: string) =>
  name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

function sinceShort(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const HOW_STEPS = [
  { t: 'We track hiring managers', d: 'AI finds unlisted recruiter posts seconds after publish.' },
  { t: 'We isolate true openings', d: 'Filtered for active roles, removing scraped career portal spam.' },
  { t: 'You apply first', d: 'Reach the recruiter before public job board floodgates open.' },
]

const BoltIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" /></svg>
)
const ArrowRight = ({ className }: { className?: string }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
const StarIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
)

const PROMISES = ['Zero scraped job board spam', 'Direct recruiter links included', 'No ATS portal black holes']
const HeroPromises = () => (
  <ul className="promises" aria-label="Why backchannel works">
    {PROMISES.map((p, i) => (
      <li key={p} style={{ ['--i' as string]: i }}>
        <span className="pm-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
        <span className="pm-text">{p}</span>
      </li>
    ))}
  </ul>
)

export default function HomePage() {
  const [dark, setDark] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [firstLoad, setFirstLoad] = useState(false)
  const [passExpires, setPassExpires] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const acctRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (acctRef.current && !acctRef.current.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])
  
  const [checkoutError, setCheckoutError] = useState(false)
  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)).catch(() => {}).finally(() => setAuthChecked(true))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setUserEmail(s?.user?.email ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])
  const signOut = async () => {
    try { await createClient().auth.signOut() } catch {}
    window.location.reload()
  }
  const [coreJobs, setAllJobs] = useState<JobPost[]>([])
  const [archiveJobs, setArchiveJobs] = useState<JobPost[]>([])
  const archiveRequested = useRef(false)
  const [archiveDone, setArchiveDone] = useState(false)
  const [archiveCounts, setArchiveCounts] = useState<Record<string, number> | null>(null)
  const rawJobs = useMemo(() => {
    if (!archiveJobs.length) return coreJobs
    const ids = new Set(coreJobs.map((j) => j.id))
    return [...coreJobs, ...archiveJobs.filter((j) => !ids.has(j.id))]
  }, [coreJobs, archiveJobs])
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)

  const searchIndex = useMemo(() => rawJobs.map((j) => ({
    hay: `${j.title ?? ''} ${j.company ?? ''} ${j.summary ?? ''}`.toLowerCase(),
    tags: new Set((Array.isArray(j.tags) ? j.tags : []).map((t: string) => String(t).toLowerCase())),
  })), [rawJobs])
  
  const vocab = useMemo(() => {
    const m = new Map<string, number>()
    for (const j of rawJobs) {
      const words = `${j.title ?? ''} ${j.company ?? ''} ${Array.isArray(j.tags) ? j.tags.join(' ') : ''}`.toLowerCase().split(/[^a-z0-9+#]+/)
      for (const w of words) if (w.length >= 4) m.set(w, (m.get(w) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [rawJobs])

  const searchTerms = useMemo(() => {
    const tokens = filters.search.toLowerCase().replace(/[,()%*\\"]/g, ' ').split(/\s+/).filter(Boolean)
    return tokens.map((tok) => {
      const known = SEARCH_SYNONYMS[tok]
      if (known) return { tok, phrases: known, fixed: null as string | null }
      if (tok.length >= 5 && rawJobs.length > 0 && !searchIndex.some((s) => s.hay.includes(tok))) {
        const max = tok.length >= 8 ? 2 : 1
        const close = vocab
          .map(([w, n]) => ({ w, n, d: editDistance(tok, w, max) }))
          .filter((x) => x.d <= max)
          .sort((x, y) => x.d - y.d || y.n - x.n)
          .slice(0, 3)
        if (close.length > 0) return { tok, phrases: close.map((x) => x.w), fixed: close[0].w }
      }
      return { tok, phrases: [tok], fixed: null as string | null }
    })
  }, [filters.search, rawJobs, searchIndex, vocab])
  const searchFixes = searchTerms.filter((t) => t.fixed)

  const allJobs = useMemo(() => {
    if (searchTerms.length === 0) return rawJobs
    return rawJobs.filter((_, i) => {
      const { hay, tags } = searchIndex[i]
      return searchTerms.every(({ tok, phrases }) => tags.has(tok) || phrases.some((ph) => hay.includes(ph)))
    })
  }, [rawJobs, searchIndex, searchTerms])
  
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(150)
  const [hasPass, setHasPass] = useState(false)
  const [withheld, setWithheld] = useState(0)
  const [addedToday, setAddedToday] = useState(0)
  const [previewCount, setPreviewCount] = useState(0)
  const [previewIds, setPreviewIds] = useState<string[]>([])
  const [lockedJobs, setLockedJobs] = useState<LockedJob[]>([])
  const [dropBatches, setDropBatches] = useState<DropBatch[]>(DROP_BATCHES_FALLBACK)
  
  useEffect(() => {
    fetch('/api/schedule')
      .then((r) => r.json())
      .then((d) => { if (d.drops?.length) setDropBatches(d.drops) })
      .catch(() => {})
  }, [])
  
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [locQuery, setLocQuery] = useState('')
  const [cityExpanded, setCityExpanded] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [nowTs, setNowTs] = useState<number | null>(null)
  const visitorId = useRef<string | null>(null)
  
  useEffect(() => {
    captureAttribution()
    try {
      let id = localStorage.getItem('bcj_vid')
      if (!id) { id = crypto.randomUUID(); localStorage.setItem('bcj_vid', id) }
      visitorId.current = id
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: id, referrer: document.referrer }),
      }).catch(() => {})
    } catch {}
  }, [])

  const searchRef = useRef<HTMLInputElement>(null)
  const prevSlotKey = useRef<string | null>(null)

  const fetchSeq = useRef(0)
  const fetchJobs = useCallback(async () => {
    const seq = ++fetchSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('sortBy', filters.sortBy)
      params.set('limit', '20000')

      const fast = new URLSearchParams(params)
      fast.set('limit', '400')
      const res = await fetch(`/api/jobs?${fast}`)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      if (seq !== fetchSeq.current) return

      setAllJobs(data.jobs ?? [])
      setHasPass(!!data.hasPass)
      setPassExpires(data.passExpiresAt ?? null)
      setFirstLoad(true)
      setWithheld(data.withheld ?? 0)
      setArchiveCounts(data.archiveCounts ?? null)
      setAddedToday(data.addedToday ?? 0)
      setPreviewCount(data.previewCount ?? 0)
      setPreviewIds(data.previewIds ?? [])
      setLockedJobs(data.lockedJobs ?? [])
      if (Array.isArray(data.topCompanies)) setTopCompanies(data.topCompanies)
      setLastUpdated(new Date())
      setLoading(false)

      fetch(`/api/jobs?${params}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((full) => { if (seq === fetchSeq.current && full?.jobs?.length) setAllJobs(full.jobs) })
        .catch(() => {})
    } catch {
      setLoading(false)
    } finally { setLoading(false) }
  }, [filters.sortBy])

  const [openDrop, setOpenDrop] = useState<'region' | 'city' | null>(null)
  const wantsArchive = filters.search.trim().length >= 2 || filters.locations.length > 0 || openDrop !== null
  useEffect(() => {
    if (!wantsArchive || archiveRequested.current) return
    archiveRequested.current = true
    fetch('/api/jobs?archive=1&limit=20000')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.jobs?.length) setArchiveJobs(d.jobs) })
      .catch(() => { archiveRequested.current = false })
      .finally(() => setArchiveDone(true))
  }, [wantsArchive])

  useEffect(() => {
    const t = setTimeout(fetchJobs, 250)
    return () => clearTimeout(t)
  }, [fetchJobs])

  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
        setVisibleCount((c) => c + 150)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => { setVisibleCount(150) }, [filters])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('bcj-saved')
      if (raw) setSaved(new Set(JSON.parse(raw)))
    } catch {}
  }, [])

  const persistSaved = (next: Set<string>) => {
    setSaved(next)
    try { localStorage.setItem('bcj-saved', JSON.stringify([...next])) } catch {}
  }

  const toggleSaved = (id: string) => {
    const next = new Set(saved)
    next.has(id) ? next.delete(id) : next.add(id)
    persistSaved(next)
  }

  const savedJobs = useMemo(() => rawJobs.filter((j) => saved.has(j.id)), [rawJobs, saved])

  const searchWrapRef = useRef<HTMLDivElement>(null)
  const [sugOpen, setSugOpen] = useState(false)
  const [sugIdx, setSugIdx] = useState(-1)
  useEffect(() => {
    if (!sugOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setSugOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown) }
  }, [sugOpen])

  const jumpToJob = (id: string) => {
    const visible = displayJobs.some((j) => j.id === id)
    if (!visible) setFilters(DEFAULT_FILTERS)
    setFiltersOpen(false)
    setHighlightId(id)
    setTimeout(() => {
      document.getElementById(`job-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, visible ? 0 : 150)
    setTimeout(() => setHighlightId(null), 1800)
  }

  useEffect(() => {
    const update = () => {
      const t = Date.now()
      const { next, current } = dropsAround(t, dropBatches)
      const fine = !!current || (next !== null && next.start - t < 11 * 60_000)
      setNowTs(fine ? t : Math.floor(t / 60_000) * 60_000)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (nowTs == null) return
    const { current } = dropsAround(nowTs, dropBatches)
    const key = current
      ? `ing:${Math.min(Math.floor((nowTs - current.start) / SLOT_MS), current.sectors.length - 1)}`
      : 'idle'
    const prev = prevSlotKey.current
    prevSlotKey.current = key
    if (prev !== null && prev !== key && prev.startsWith('ing:')) fetchJobs()
  }, [nowTs, fetchJobs])

  type ClockPart = { v: string | number; u?: string }
  const press = useMemo((): { cls: string; barW: number | null; label: string; detail: string; clock: ClockPart[] } | null => {
    if (nowTs == null) return null
    const { prev, next, current } = dropsAround(nowTs, dropBatches)

    if (current) {
      const idx = Math.min(Math.floor((nowTs - current.start) / SLOT_MS), current.sectors.length - 1)
      const togo = current.sectors.length - 1 - idx
      return {
        cls: ' ingesting', barW: null, label: 'Fresh roles landing live',
        detail: `${sectorLabel(current.sectors[idx])} in progress · ${togo > 0 ? `${togo} sectors remaining` : 'wrapping up'}`,
        clock: [{ v: 'live drop' }],
      }
    }
    if (!next) return null

    const remaining = next.start - nowTs
    const startsLocal = new Date(next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    if (remaining > 8 * 3_600_000) {
      const weekendGap = new Date(next.start).getUTCDay() === 1 && remaining > 20 * 3_600_000
      return {
        cls: ' far', barW: null, label: 'Next unlisted role drop',
        detail: weekendGap ? 'weekend drop schedule' : 'today\'s drops complete',
        clock: [{ v: new Date(next.start).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }],
      }
    }

    const spanStart = prev ? prev.end : next.start - 12 * 3_600_000
    const barW = Math.round(Math.min(1, Math.max(0.02, (nowTs - spanStart) / (next.start - spanStart))) * 100)
    const h = Math.floor(remaining / 3_600_000)
    const m = Math.floor((remaining % 3_600_000) / 60_000)
    const s = Math.floor((remaining % 60_000) / 1000)

    if (remaining < 10 * 60_000) {
      return {
        cls: ' imminent', barW, label: 'Next priority drop',
        detail: `${startsLocal} · starting with ${sectorLabel(next.sectors[0])}`,
        clock: [{ v: m, u: 'm' }, { v: s, u: 's' }],
      }
    }
    const names = next.sectors.map(sectorLabel)
    const lineup =
      names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} then ${names[1]}`
      : `${names[0]} first, then ${names.slice(1).join(', ')}`
    return {
      cls: '', barW, label: 'Next priority drop',
      detail: `${startsLocal} · ${lineup}`,
      clock: h > 0 ? [{ v: h, u: 'h' }, { v: m, u: 'm' }] : [{ v: m, u: 'm' }],
    }
  }, [nowTs, dropBatches])

  const [myTargets, setMyTargets] = useState<{ keyword: string; location: string | null }[]>([])
  const [myFeedOn, setMyFeedOn] = useState(false)
  const [topCompanies, setTopCompanies] = useState<StripCompany[]>([])
  const [myStatus, setMyStatus] = useState<{ checkedAt: string | null; pending: number; newTotal: number } | null>(null)
  
  useEffect(() => {
    fetch('/api/targets')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const targets = d?.targets ?? []
        setMyTargets(targets)
        if (targets.length > 0 && (new URLSearchParams(window.location.search).get('mine') === '1' || !sessionStorage.getItem('bcj_tab_touched'))) setMyFeedOn(true)
        if (targets.length > 0) {
          fetch('/api/targets/status', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((st) => { if (st) setMyStatus({ checkedAt: st.checkedAt ?? null, pending: st.pending ?? 0, newTotal: st.newTotal ?? 0 }) })
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [])

  const matchesTargets = useCallback((j: JobPost, strict: boolean) => {
    if (myTargets.length === 0) return false
    return myTargets.some((t) => {
      if (!keywordMatches(t.keyword, j.title ?? '', null)) return false
      return strict ? locationMatches(t.location, j.location ?? null, j.work_type ?? null) : true
    })
  }, [myTargets])

  const myExact = useMemo(() => allJobs.filter((j) => matchesTargets(j, true)), [allJobs, matchesTargets])
  const roughTier = useCallback((j: JobPost): 1 | 2 | 3 => {
    let best: 1 | 2 | 3 = 3
    for (const t of myTargets) {
      if (!keywordMatches(t.keyword, j.title ?? '', null)) continue
      const n = nearness(t.location, j.location ?? null)
      if (n < best) best = n
    }
    return best
  }, [myTargets])
  
  const myRough = useMemo(
    () => allJobs
      .filter((j) => !matchesTargets(j, true) && matchesTargets(j, false))
      .sort((a, b) => roughTier(a) - roughTier(b) || toTime(b.posted_at) - toTime(a.posted_at))
      .slice(0, 60),
    [allJobs, matchesTargets, roughTier])
  const myNearby = useMemo(() => myRough.filter((j) => roughTier(j) < 3).length, [myRough, roughTier])

  const displayJobs = useMemo(() => {
    if (myFeedOn) {
      const byDate = (a: JobPost, b: JobPost) => {
        const d = toTime(b.posted_at) - toTime(a.posted_at)
        return filters.sortBy === 'newest' ? d : -d
      }
      return [...[...myExact].sort(byDate), ...myRough]
    }
    const list = allJobs.filter((job) => {
      if (filters.sector !== 'all' && job.sector !== filters.sector) return false
      if (filters.locations.length > 0) {
        if (!job.location) return false
        const jobLocs = locParts(job.location)
        const selRegions = filters.locations.filter((l) => REGIONS[l])
        const selCities = filters.locations.filter((l) => !REGIONS[l])
        const matchCity = (sel: string) => jobLocs.includes(sel.toLowerCase())
        const narrowed = selRegions.filter((r) =>
          !selCities.some((city) => (REGIONS[r] ?? []).some((k) => matchKw(city.toLowerCase(), k))))
        const anyLoc =
          narrowed.some((r) => jobInRegion(job, r)) ||
          selCities.some(matchCity)
        if ((selRegions.length > 0 || selCities.length > 0) && !anyLoc) return false
      }
      if (filters.workTypes.length > 0) {
        const wt = job.work_type ?? inferWorkType(job)
        if (!wt || !filters.workTypes.includes(wt)) return false
      }
      return true
    })
    return [...list].sort((a, b) => {
      const d = toTime(b.posted_at) - toTime(a.posted_at)
      return filters.sortBy === 'newest' ? d : -d
    })
  }, [allJobs, filters.sector, filters.locations, filters.workTypes, filters.sortBy, myFeedOn, myExact, myRough])

  const relaxed = useMemo(() => {
    if (displayJobs.length >= 5) return null
    const passesSector = (j: JobPost) => filters.sector === 'all' || j.sector === filters.sector
    const passesWork = (j: JobPost) => {
      if (filters.workTypes.length === 0) return true
      const wt = j.work_type ?? inferWorkType(j)
      return !!wt && filters.workTypes.includes(wt)
    }
    const passesLoc = (j: JobPost) => {
      if (filters.locations.length === 0) return true
      if (!j.location) return false
      const jobLocs = locParts(j.location)
      const selRegions = filters.locations.filter((l) => REGIONS[l])
      const selCities = filters.locations.filter((l) => !REGIONS[l])
      return selRegions.some((r) => jobInRegion(j, r)) || selCities.some((s) => jobLocs.includes(s.toLowerCase()))
    }
    return {
      noLocation: filters.locations.length > 0
        ? allJobs.filter((j) => passesSector(j) && passesWork(j)).length : 0,
      noSector: filters.sector !== 'all'
        ? allJobs.filter((j) => passesLoc(j) && passesWork(j)).length : 0,
      noWorkType: filters.workTypes.length > 0
        ? allJobs.filter((j) => passesSector(j) && passesLoc(j)).length : 0,
    }
  }, [displayJobs.length, allJobs, filters.sector, filters.locations, filters.workTypes])

  const resultCountRef = useRef(0)
  useEffect(() => { resultCountRef.current = displayJobs.length }, [displayJobs.length])
  useEffect(() => {
    const active = filters.search || filters.sector !== 'all'
      || filters.locations.length > 0 || filters.workTypes.length > 0
    if (!active) { try { localStorage.removeItem('bcj_last_search') } catch {} ; return }
    try {
      localStorage.setItem('bcj_last_search', JSON.stringify({
        q: filters.search, sector: filters.sector, locations: filters.locations, at: Date.now(),
      }))
    } catch {}
    if (!archiveDone) return
    const t = setTimeout(() => {
      fetch('/api/track-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: visitorId.current,
          term: filters.search,
          sector: filters.sector,
          locations: filters.locations,
          work_types: filters.workTypes,
          result_count: resultCountRef.current,
        }),
      }).catch(() => {})
    }, 1200)
    return () => clearTimeout(t)
  }, [filters.search, filters.sector, filters.locations, filters.workTypes, archiveDone])

  const olderPending = archiveCounts && !archiveDone ? archiveCounts : null
  const headlineCount = displayJobs.length + (
    olderPending && !myFeedOn && !filters.search.trim() && filters.locations.length === 0 && filters.workTypes.length === 0
      ? (filters.sector === 'all' ? Object.values(olderPending).reduce((a, b) => a + b, 0) : (olderPending[filters.sector] ?? 0))
      : 0)
  const sectorCounts = useMemo(() => {
    const plus = (id: string) => (olderPending?.[id] ?? 0)
    return {
      all: allJobs.length + Object.values(olderPending ?? {}).reduce((a, b) => a + b, 0),
      finance: allJobs.filter((j) => j.sector === 'finance').length + plus('finance'),
      tech: allJobs.filter((j) => j.sector === 'tech').length + plus('tech'),
      legal: allJobs.filter((j) => j.sector === 'legal').length + plus('legal'),
      marketing: allJobs.filter((j) => j.sector === 'marketing').length + plus('marketing'),
      realestate: allJobs.filter((j) => j.sector === 'realestate').length + plus('realestate'),
      sales: allJobs.filter((j) => j.sector === 'sales').length + plus('sales'),
      hr: allJobs.filter((j) => j.sector === 'hr').length + plus('hr'),
    }
  }, [allJobs, olderPending])

  const locBase = useMemo(() => allJobs.filter((job) => {
    if (filters.sector !== 'all' && job.sector !== filters.sector) return false
    if (filters.workTypes.length > 0) {
      const wt = job.work_type ?? inferWorkType(job)
      if (!wt || !filters.workTypes.includes(wt)) return false
    }
    return true
  }), [allJobs, filters.sector, filters.workTypes])

  const regionCounts = useMemo(() =>
    Object.keys(REGIONS)
      .map((name) => ({ name, count: locBase.filter((j) => jobInRegion(j, name)).length }))
      .filter((r) => r.count > 0 || filters.locations.includes(r.name))
      .sort((a, b) => b.count - a.count),
    [locBase, filters.locations])

  const cityBase = useMemo(() => {
    const selRegions = filters.locations.filter((l) => REGIONS[l])
    if (selRegions.length === 0) return locBase
    return locBase.filter((j) => selRegions.some((r) => jobInRegion(j, r)))
  }, [locBase, filters.locations])

  const cityStats = useMemo(() => {
    const tally = new Map<string, { name: string; count: number }>()
    for (const j of cityBase) {
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
  }, [cityBase])

  const CITY_LIMIT = 24
  const visibleCities = useMemo(() => {
    const q = locQuery.trim().toLowerCase()
    const matches = q ? cityStats.filter((l) => l.name.toLowerCase().includes(q)) : cityStats
    const selectedNames = filters.locations.filter((l) => !REGIONS[l])
    const selected = selectedNames.map((name) => cityStats.find((l) => l.name === name) ?? { name, count: 0 })
    const rest = matches.filter((l) => !selectedNames.includes(l.name))
    const limit = cityExpanded ? rest.length : CITY_LIMIT
    return { shown: [...selected, ...rest.slice(0, limit)], hidden: Math.max(0, rest.length - limit) }
  }, [cityStats, locQuery, filters.locations, cityExpanded])

  const SUG_MAX = 6
  const sugList = filters.search.trim().length >= 2 ? displayJobs.slice(0, SUG_MAX) : []
  const showSug = sugOpen && sugList.length > 0
  const pickSuggestion = (id: string) => {
    track('search_suggestion_click', { term: filters.search })
    setSugOpen(false)
    searchRef.current?.blur()
    jumpToJob(id)
  }

  const daysLeft = passExpires ? Math.max(0, Math.ceil((new Date(passExpires).getTime() - Date.now()) / 86400000)) : null

  const anyFilter = filters.sector !== 'all' || filters.locations.length > 0 || filters.workTypes.length > 0 || filters.search !== ''
  const activeFilterCount = (filters.sector !== 'all' ? 1 : 0) + filters.workTypes.length + filters.locations.length

  const toggleWorkType = (wt: WorkType) => {
    const next = filters.workTypes.includes(wt)
      ? filters.workTypes.filter((w) => w !== wt)
      : [...filters.workTypes, wt]
    track('filter_worktype', { work_types: next.join(',') || 'cleared' })
    setFilters({ ...filters, workTypes: next })
  }

  const selRegion = filters.locations.find((l) => REGIONS[l]) ?? null
  const selCity = filters.locations.find((l) => !REGIONS[l]) ?? null
  const pickLocation = (kind: 'region' | 'city', value: string | null) => {
    const region = kind === 'region' ? value : selRegion
    const city = kind === 'city' ? value : selCity
    const next = [region, city].filter(Boolean) as string[]
    track('filter_location', { locations: next.join(',') || 'cleared' })
    setFilters({ ...filters, locations: next })
    setOpenDrop(null)
    setLocQuery('')
  }

  const track = (name: string, params: Record<string, unknown> = {}) => {
    try {
      const w = window as unknown as { gtag?: (...a: unknown[]) => void }
      w.gtag?.('event', name, params)
    } catch {}
  }

  const [portalBusy, setPortalBusy] = useState(false)
  const openPortal = async () => {
    if (portalBusy) return
    setPortalBusy(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) { window.location.href = data.url; return }
    } catch {}
    setPortalBusy(false)
    setCheckoutError(true)
    setTimeout(() => setCheckoutError(false), 6000)
  }

  const trackAuthorClick = (job: JobPost) => {
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          job_id: job.id,
          visitor_id: visitorId.current,
          sector: job.sector,
          location: job.location,
          kind: 'author',
        }),
      }).catch(() => {})
    } catch {}
  }

  const trackJobClick = (job: JobPost, index: number) => {
    const ageDays = job.posted_at
      ? Math.floor((Date.now() - new Date(job.posted_at).getTime()) / 86400000)
      : null
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          job_id: job.id,
          visitor_id: visitorId.current,
          sector: job.sector,
          location: job.location,
          seniority: job.seniority,
          quality: (job as unknown as { quality?: string }).quality ?? null,
          list_position: index + 1,
          age_days: ageDays,
        }),
      }).catch(() => {})
    } catch {}
    return track('job_click', {
      sector: job.sector,
      location: job.location ?? 'unknown',
      seniority: job.seniority ?? 'unknown',
      company: job.company ?? 'unknown',
      list_position: index + 1,
      age_days: ageDays,
    })
  }

  const filtersActive = !!filters.search || filters.sector !== 'all'
    || filters.locations.length > 0 || filters.workTypes.length > 0
  const splitFeed = !hasPass && !filtersActive && previewIds.length > 0
  const previewSet = useMemo(() => new Set(previewIds), [previewIds])
  const todayJobs = useMemo(
    () => (splitFeed ? displayJobs.filter((j) => previewSet.has(j.id)) : []),
    [splitFeed, displayJobs, previewSet])
  const earlierJobs = useMemo(
    () => (splitFeed ? displayJobs.filter((j) => !previewSet.has(j.id)) : displayJobs),
    [splitFeed, displayJobs, previewSet])

  const resetAll = () => setFilters(DEFAULT_FILTERS)

  const [exIdx, setExIdx] = useState(0)
  useEffect(() => {
    if (filters.search) return
    const t = setInterval(() => setExIdx((i) => (i + 1) % SEARCH_EXAMPLES.length), 3200)
    return () => clearInterval(t)
  }, [filters.search])

  const [freshMatches, setFreshMatches] = useState(0)
  const freshQuery = useMemo(
    () => searchTerms.map((t) => t.fixed ?? t.tok).join(' ').trim(),
    [searchTerms],
  )
  useEffect(() => {
    if (hasPass || freshQuery.length < 2 || filters.locations.length > 0 || filters.workTypes.length > 0) { setFreshMatches(0); return }
    let alive = true
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ freshCount: '1', search: freshQuery })
        if (filters.sector !== 'all') p.set('sector', filters.sector)
        const r = await fetch(`/api/jobs?${p}`)
        const d = r.ok ? await r.json() : null
        if (alive) setFreshMatches(Number(d?.freshMatches) || 0)
      } catch { if (alive) setFreshMatches(0) }
    }, 450)
    return () => { alive = false; clearTimeout(t) }
  }, [hasPass, freshQuery, filters.sector, filters.locations.length, filters.workTypes.length])
  const showFreshUpsell = !hasPass && freshMatches > 0 && freshQuery.length >= 2
  const showSugBox = sugOpen && (sugList.length > 0 || showFreshUpsell)

  const lockedShown = !hasPass && !filters.search && filters.locations.length === 0 && filters.workTypes.length === 0
    ? lockedJobs.filter((l) => filters.sector === 'all' || l.sector === filters.sector)
    : []
    
  const renderLocked = (l: LockedJob, i: number) => (
    <article key={`locked-${i}`} className="card locked-title" style={{ ['--sec' as string]: `var(--sec-${l.sector}, var(--ink-3))` }}>
      <div className="card-top">
        <span className="sec-tag"><span className="dot" />{sectorLabel(l.sector)}</span>
        <span className="sample-flag priority">Priority Only</span>
        {l.posted_at && <span className="ago fresh">{timeAgo(l.posted_at)}</span>}
      </div>
      <h3 className="locked-h">{l.title}</h3>
      <div className="locked-blur" aria-hidden="true">
        <p className="meta"><b>Company confidential</b><span className="sep">·</span>Senior Role</p>
        <p className="summary">Direct recruiter contact details and original LinkedIn post are locked. Unlock to pitch the decision maker directly before public indexing.</p>
        <p className="salary"><span className="via">direct manager link</span></p>
      </div>
      <div className="card-foot lock-foot">
        <span className="lock-when">
          {l.posted_at && <>Posted {timeAgo(l.posted_at)}</>}
          {unlockLabel(l.posted_at) && <> · <b>Free feed in {unlockLabel(l.posted_at)}</b></>}
        </span>
        <a className="lock-now" href="/offer?src=locked_title" onClick={() => track('cta_click', { where: 'locked_title' })}>Unlock Recruiter Contact &rarr;</a>
      </div>
    </article>
  )

  // Optimised Offer Card: Single focal-point CTA prioritizing Premium conversion over free browsing
  const renderOffer = (cls: string) => (
    <div className={`offer ${cls}`}>
      <div className="offer-main-card">
        <div className="offer-badge">⚡ Special Intro Offer</div>
        <div className="offer-pricing">
          <span className="offer-price-big">$9</span>
          <div className="offer-price-details">
            <span className="offer-strike">$15 / month</span>
            <span className="offer-sub">first month · cancel anytime in 2 clicks</span>
          </div>
        </div>
        <a className="btn-primary lg offer-cta-btn" href="/offer?src=hero_plan" onClick={() => track('cta_click', { where: 'hero_plan' })}>
          <BoltIcon />
          <span>Get Instant Priority Access — $9</span>
        </a>
        <div className="offer-guarantee">🔒 Stripe 256-bit Secure Checkout · Instant Activation</div>
      </div>

      <div className="offer-free-option">
        <span>Just browsing?</span>
        <a
          href="#feed"
          className="offer-free-link"
          onClick={(e) => {
            e.preventDefault()
            track('cta_click', { where: 'hero_free' })
            document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          View standard free feed (roles older than {FREE_DELAY_HOURS}h) &darr;
        </a>
      </div>
    </div>
  )

  const renderArt = (cls: string) => (
      <div className={`art ${cls}`} role="img" aria-label="Example: a recruiter's LinkedIn post becomes a listing on backchannel.jobs">
        <div className="art-post">
          <div className="art-h"><span className="li">in</span><div><b>Senior Technical Recruiter</b><small>18m ago · Personal Post</small></div></div>
          <p>“I&apos;m partnering directly with a Series B SaaS team hiring a Senior PM. Skipping online portal filters—DM me your CV directly!”</p>
        </div>
        <div className="art-note">
          <svg viewBox="0 0 60 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M52 8C40 6 24 10 10 26M10 26l1-11M10 26l11-3" /></svg>
          <span>We index these unlisted posts instantly.</span>
        </div>
        <div className="art-role">
          <div className="art-top"><span className="new">⚡ Live · 18m ago</span><span className="art-eg">Real-time match</span></div>
          <h3>Senior Product Manager</h3>
          <div className="art-meta">Series B SaaS · San Francisco, CA (Hybrid)</div>
          <ul className="art-facts">
            <li>Posted by: Senior Technical Recruiter at Redwood Talent</li>
            <li>Direct LinkedIn profile & hiring thread included</li>
          </ul>
          <p className="art-quote">“Bypassing ATS portal filters to hire fast. Direct contact with hiring lead...”</p>
          <div className="art-tags"><span>Product</span><span>SaaS</span><span>Direct Pitch</span></div>
          <div className="art-actions"><a className="btn-ghost sm" href="#feed">Browse feed <ArrowRight /></a></div>
        </div>
      </div>
  )

  return (
    <div className={`ulj${dark ? ' dark' : ''}`}>

      {/* ── Masthead ─────────────────────────── */}
      <header className="masthead">
        <div className="masthead-in">
          <a className="wordmark" href="/"><span className="mark">B</span><span>backchannel<em>.jobs</em></span></a>

          <div className="search-wrap" ref={searchWrapRef}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input
              ref={searchRef}
              className="search"
              type="search"
              enterKeyHint="search"
              inputMode="search"
              placeholder={`Search unlisted roles, e.g. “${SEARCH_EXAMPLES[exIdx]}”`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && showSug) { e.preventDefault(); setSugIdx((i) => (i + 1) % sugList.length) }
                else if (e.key === 'ArrowUp' && showSug) { e.preventDefault(); setSugIdx((i) => (i <= 0 ? sugList.length - 1 : i - 1)) }
                else if (e.key === 'Escape') { setSugOpen(false) }
                else if (e.key === 'Enter') {
                  if (showSug && sugIdx >= 0) { e.preventDefault(); pickSuggestion(sugList[sugIdx].id) }
                  else {
                    setSugOpen(false)
                    e.currentTarget.blur()
                    document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                }
              }}
              value={filters.search}
              onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setSugOpen(true); setSugIdx(-1) }}
              onFocus={() => setSugOpen(true)}
              role="combobox"
              aria-expanded={showSug}
              aria-controls="search-sug"
            />
            {!archiveDone && filters.search.trim().length > 1
              ? <svg className="search-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-label="Loading older roles"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>
              : showFreshUpsell
                ? <a className="bar-up" href="/offer?src=search_bar" onClick={() => track('cta_click', { where: 'search_bar', q: freshQuery, n: freshMatches })}>+{freshMatches} priority matches<span>&nbsp;· Unlock</span></a>
                : <span className="slash">/</span>}
            {showSugBox && (
              <div className="sug" id="search-sug" role="listbox">
                {sugList.map((j, n) => (
                  <button
                    type="button" role="option" aria-selected={n === sugIdx} key={j.id}
                    className={`sug-row${n === sugIdx ? ' on' : ''}`}
                    style={{ ['--sec' as string]: `var(--sec-${j.sector}, var(--ink-3))` }}
                    onMouseEnter={() => setSugIdx(n)}
                    onClick={() => pickSuggestion(j.id)}
                  >
                    <span className="sd" />
                    <span className="st">
                      <b>{j.title}</b>
                      <span>{[j.company, j.location].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                ))}
                {displayJobs.length > SUG_MAX && (
                  <button type="button" className="sug-all" onClick={() => { setSugOpen(false); searchRef.current?.blur(); document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                    See all {displayJobs.length} matching roles
                  </button>
                )}
                {showFreshUpsell && (
                  <a className="sug-up" href="/offer?src=search_dropdown" onClick={() => track('cta_click', { where: 'search_dropdown', q: freshQuery, n: freshMatches })}>
                    <BoltIcon /><span><b>{freshMatches} newer roles match</b> this search in the priority window. Unlock them now.</span>
                  </a>
                )}
                {relaxed && relaxed.noLocation > displayJobs.length && (
                  <button type="button" className="sug-relax" onClick={() => { setFilters({ ...filters, locations: [] }); setSugOpen(false) }}>
                    <span><b>{relaxed.noLocation} match</b> this search in other locations.</span>
                  </button>
                )}
                {relaxed && relaxed.noSector > displayJobs.length && (
                  <button type="button" className="sug-relax" onClick={() => { setFilters({ ...filters, sector: 'all' }); setSugOpen(false) }}>
                    <span><b>{relaxed.noSector} match</b> this search in other sectors.</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mast-actions">
            <div className="acct-wrap" ref={acctRef}>
              <button className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Account menu" title="Account">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              {menuOpen && (
                <div className="acct-menu">
                  <button onClick={() => { setMenuOpen(false); fetchJobs() }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh feed'}</button>
                  {userEmail ? (
                    <>
                      <div className="acct-email">{userEmail}</div>
                      {hasPass && <div className="acct-badge">Premium Active</div>}
                      {hasPass && <button onClick={() => { setMenuOpen(false); openPortal() }} disabled={portalBusy}>Manage billing</button>}
                      <a href="/targets">My targets</a>
                      <a href="/offer?src=nav">Upgrade Pass</a>
                      <button onClick={signOut}>Sign out</button>
                    </>
                  ) : (
                    <>
                      <a href="/login">Sign in</a>
                      <a href="/offer?src=nav">Priority Pass ($9)</a>
                    </>
                  )}
                </div>
              )}
            </div>
            <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode" title="Toggle dark mode">
              {dark
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>}
            </button>

            {!hasPass && !userEmail && (
              <a className="btn-primary signup" href="/offer?src=header_signup" onClick={() => track('cta_click', { where: 'header_signup' })}>
                <BoltIcon /> Unlock $9
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────── */}
      {authChecked && !userEmail && (<>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-trust-tag">
            <span className="stars"><StarIcon/><StarIcon/><StarIcon/><StarIcon/><StarIcon/></span>
            <span>Used by candidates at Google, Goldman Sachs & McKinsey</span>
          </div>
          <h1>Skip the job board black hole. <em>Apply directly to hiring managers and internal teams.</em></h1>
          <p className="sub">Access an entire pool of unlisted roles shared by internal teams and hiring managers—openings that never even make it to traditional job boards. We track them in real time so you apply before anyone else.</p>
          <HeroPromises />
          {!hasPass && renderOffer('offer-d')}
        </div>

        {renderArt('art-d')}
      </section>

      <div className="art-m-wrap">{renderArt('art-m')}</div>

      <div className="howbar-wrap" id="how">
        <div className="howbar">
          <div className="hb-title">Why speed wins</div>
          <ol className="hb-steps">
            {HOW_STEPS.map((st, n) => (
              <li key={st.t}><i>{n + 1}</i><div><b>{st.t}</b><span>{st.d}</span></div></li>
            ))}
          </ol>
        </div>
      </div>

      {!hasPass && <div className="offer-wrap">{renderOffer('offer-m')}</div>}

      </>)}

      <EmployerStrip
        companies={topCompanies}
        onPick={(name) => {
          setFilters({ ...filters, search: name })
          track('employer_strip_click', { company: name })
          document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
      />

      {userEmail && firstLoad && (
        <div className="member-wrap">
          {hasPass ? (
            <div className="member-bar active">
              <span className="mb-dot" />
              <b>Priority Pass Active</b>
              {daysLeft !== null && <span className="mb-sub">{daysLeft <= 0 ? 'renewing today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} remaining`}</span>}
              {daysLeft !== null && daysLeft <= 3 && (
                <a className="mb-link" href="/offer?src=renew" onClick={() => track('cta_click', { where: 'renew' })}>Manage / Extend</a>
              )}
            </div>
          ) : (
            <div className="member-bar free">
              <div className="mb-copy"><b>Standard Free Feed</b><span className="mb-sub">Viewing roles delayed by {FREE_DELAY_HOURS}h. Upgrade for real-time drops.</span></div>
              <a className="btn-primary" href="/offer?src=member_bar" onClick={() => track('cta_click', { where: 'member_bar' })}><BoltIcon />{CTA_LABEL}</a>
            </div>
          )}
        </div>
      )}

      <div className="layout" id="feed">
        {/* ── Sidebar ─────────────────────────── */}
        <aside className={`filters${filtersOpen ? ' open' : ''}`}>
          <button className="filters-head" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" /></svg>
            Refine Feed
            {activeFilterCount > 0 && <span className="fbadge">{activeFilterCount}</span>}
            <svg className={`chev${filtersOpen ? ' up' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
          </button>

          {savedJobs.length > 0 && (
            <div className="fgroup">
              <div className="flabel">
                <span>Saved Jobs</span>
                <button onClick={() => persistSaved(new Set())}>Clear</button>
              </div>
              <div className="saved-list">
                {savedJobs.map((j) => (
                  <button key={j.id} className="saved-link" onClick={() => jumpToJob(j.id)} title={j.title}>
                    <span className="star">★</span><span className="t">{j.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="fgroup">
            <div className="flabel"><span>Sector</span></div>
            {SECTORS.map((s) => {
              const active = filters.sector === s.id
              const count = sectorCounts[s.id as keyof typeof sectorCounts] ?? 0
              return (
                <button
                  key={s.id}
                  className={`sector-row${active ? ' active' : ''}`}
                  style={{ ['--dot' as string]: s.id === 'all' ? 'var(--ink-3)' : `var(--sec-${s.id})` }}
                  onClick={() => { track('filter_sector', { sector: s.id }); setFilters({ ...filters, sector: s.id }) }}
                >
                  <span className="dot" />{s.label}<span className="cnt">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="fgroup">
            <div className="flabel">
              <span>Work Type</span>
              {filters.workTypes.length > 0 && <button onClick={() => setFilters({ ...filters, workTypes: [] })}>Clear</button>}
            </div>
            {WORK_TYPES.map((wt) => {
              const on = filters.workTypes.includes(wt)
              return (
                <button key={wt} className={`check-row${on ? ' on' : ''}`} onClick={() => toggleWorkType(wt)}>
                  <span className="box">{on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4"><path d="M20 6 9 17l-5-5" /></svg>}</span>
                  {wt}
                </button>
              )
            })}
          </div>

          <div className="fgroup">
            <div className="flabel">
              <span>Location</span>
              {filters.locations.length > 0 && <button onClick={() => { setFilters({ ...filters, locations: [] }); setOpenDrop(null) }}>Clear</button>}
            </div>

            <div className="drop">
              <button type="button" className={`drop-btn${openDrop === 'region' ? ' open' : ''}`} aria-expanded={openDrop === 'region'} onClick={() => setOpenDrop(openDrop === 'region' ? null : 'region')}>
                <span className="dl">Region</span><span className="dv">{selRegion ?? 'Any'}</span>
                <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {openDrop === 'region' && (
                <div className="drop-panel" role="radiogroup" aria-label="Region">
                  <button type="button" role="radio" aria-checked={!selRegion} className={`radio-row${!selRegion ? ' on' : ''}`} onClick={() => pickLocation('region', null)}>
                    <span className="rad" />Any region<span className="n">{locBase.length}</span>
                  </button>
                  {regionCounts.map((r) => (
                    <button type="button" role="radio" aria-checked={selRegion === r.name} key={r.name} className={`radio-row${selRegion === r.name ? ' on' : ''}`} onClick={() => pickLocation('region', r.name)}>
                      <span className="rad" />{r.name}<span className="n">{r.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="drop">
              <button type="button" className={`drop-btn${openDrop === 'city' ? ' open' : ''}`} aria-expanded={openDrop === 'city'} onClick={() => setOpenDrop(openDrop === 'city' ? null : 'city')}>
                <span className="dl">City</span><span className="dv">{selCity ?? 'Any'}</span>
                <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {openDrop === 'city' && (
                <div className="drop-panel" role="radiogroup" aria-label="City">
                  <input
                    className="loc-search"
                    type="text"
                    placeholder="Search cities…"
                    value={locQuery}
                    onChange={(e) => setLocQuery(e.target.value)}
                  />
                  <div className="drop-list">
                    <button type="button" role="radio" aria-checked={!selCity} className={`radio-row${!selCity ? ' on' : ''}`} onClick={() => pickLocation('city', null)}>
                      <span className="rad" />Any city
                    </button>
                    {visibleCities.shown.map((l) => (
                      <button type="button" role="radio" aria-checked={selCity === l.name} key={l.name} className={`radio-row${selCity === l.name ? ' on' : ''}`} onClick={() => pickLocation('city', l.name)}>
                        <span className="rad" />{l.name}<span className="n">{l.count}</span>
                      </button>
                    ))}
                    {visibleCities.hidden > 0 && (
                      <button type="button" className="more-note" onClick={() => setCityExpanded(true)}>Show all (+{visibleCities.hidden} more)</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {!hasPass && (
            <div className="pass pass-side">
              <h3>Stop missing early drops.</h3>
              <p className="pass-sub">80% of hiring manager DMs occur within the first 12 hours of a post.</p>
              <a className="btn-primary block" href="/offer?src=sidebar" onClick={() => track('cta_click', { where: 'sidebar' })}>Unlock Priority Pass ($9)</a>
              <span className="pass-fine">Renews at $15/mo. Cancel anytime in 2 clicks.</span>
            </div>
          )}

          <p className="side-note">Sourced directly from public recruiter & executive posts. Always verify terms before pitching.</p>
        </aside>

        {/* ── Feed ────────────────────────────── */}
        <main>
          <div className="feed-bar">
            <span className="count">
              <b>{headlineCount.toLocaleString()}</b> {headlineCount === 1 ? 'role' : 'roles'}
              {filters.sector !== 'all' && ` in ${sectorLabel(filters.sector)}`}
            </span>
            {!anyFilter && addedToday > 0 && (
              hasPass
                ? <span className="new-today"><span className="nd" />{addedToday} fresh today</span>
                : <a className="new-today" href="/offer?src=new_today" onClick={() => track('cta_click', { where: 'new_today' })}>
                    <span className="nd" />{addedToday} priority roles today
                  </a>
            )}
            {anyFilter && <button className="clear" onClick={resetAll}>Reset filters</button>}
            {myTargets.length > 0 && (
              <div className="feed-tabs" role="tablist">
                <button role="tab" aria-selected={!myFeedOn} className={myFeedOn ? '' : 'on'}
                  onClick={() => { setMyFeedOn(false); try { sessionStorage.setItem('bcj_tab_touched', '1') } catch {} track('feed_tab', { tab: 'all' }) }}>All roles</button>
                <button role="tab" aria-selected={myFeedOn} className={myFeedOn ? 'on' : ''}
                  onClick={() => { setMyFeedOn(true); try { sessionStorage.setItem('bcj_tab_touched', '1') } catch {} track('feed_tab', { tab: 'mine' }) }}>
                  My matches {myExact.length > 0 && <span>{myExact.length}</span>}
                </button>
              </div>
            )}
            <div className="sort-wrap">
              <select value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'newest' | 'oldest' })}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
          {searchFixes.length > 0 && (
            <div className="dym">Showing results for <b>{searchTerms.map((t) => t.fixed ?? t.tok).join(' ')}</b></div>
          )}

          {!press && <div className="press press-ph" aria-hidden="true" />}
          {press && (
            <div className={`press${press.cls}`}>
              {press.barW !== null && <div className="bar" style={{ width: `${press.barW}%` }} />}
              {press.cls === ' ingesting' && <div className="bar shimmer" />}
              <span className="pdot" />
              <span className="plabel">{press.label}</span>
              <span className="pdetail">{press.detail}</span>
              <span className="pclock">
                {press.clock.map((p, i) => <span key={i}>{p.v}{p.u && <span className="unit">{p.u}</span>}</span>)}
              </span>
            </div>
          )}

          {loading ? (
            <div className="cards">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton" />)}
            </div>
          ) : displayJobs.length === 0 ? (
            showFreshUpsell ? (
              <div className="empty">
                <h3>No older roles match, but {freshMatches} fresh {freshMatches === 1 ? 'opening does' : 'openings do'}.</h3>
                <p>Roles from the last {FREE_DELAY_HOURS} hours require a Priority Pass.</p>
                <a className="btn-primary lg" href="/offer?src=search_empty" onClick={() => track('cta_click', { where: 'search_empty', q: freshQuery, n: freshMatches })}><BoltIcon />Unlock All {freshMatches} Roles ($9)</a>
              </div>
            ) : (
            <div className="empty">
              <h3>No postings match these filters.</h3>
              {relaxed && (relaxed.noLocation > 0 || relaxed.noSector > 0 || relaxed.noWorkType > 0) ? (
                <>
                  <p>Widen your target selection to see more:</p>
                  <div className="relax">
                    {relaxed.noLocation > 0 && (
                      <button onClick={() => setFilters({ ...filters, locations: [] })}>{relaxed.noLocation} in other places</button>
                    )}
                    {relaxed.noSector > 0 && (
                      <button onClick={() => setFilters({ ...filters, sector: 'all' })}>{relaxed.noSector} in other sectors</button>
                    )}
                    {relaxed.noWorkType > 0 && (
                      <button onClick={() => setFilters({ ...filters, workTypes: [] })}>{relaxed.noWorkType} in other work types</button>
                    )}
                  </div>
                </>
              ) : (
                <p>Try resetting location or sector requirements.</p>
              )}
              <button className="reset-all" onClick={resetAll}>Reset all filters</button>
            </div>
            )
          ) : (
            <>
            {!hasPass && withheld > 0 && (
              <a className="feed-top" href="/offer?src=feed_top" onClick={() => track('cta_click', { where: 'feed_top', n: withheld })}>
                <span>⚡ <b>{withheld} unlisted {withheld === 1 ? 'role was' : 'roles were'}</b> posted in the last {FREE_DELAY_HOURS} hours and are hidden from this free feed.</span>
                <em>Unlock with Priority Pass &rarr;</em>
              </a>
            )}
            {splitFeed && todayJobs.length > 0 && (
              <div className="today-wrap">
                <div className="sec-head"><span>Sample preview of today&apos;s roles</span><i /></div>
                <div className="cards today-cards">
                  {todayJobs.map((job, i) => (
                    <article key={job.id} className="card" style={{ ['--sec' as string]: `var(--sec-${job.sector}, var(--ink-3))` }}>
                      <div className="card-top">
                        <span className="sec-tag"><span className="dot" />{sectorLabel(job.sector)}{job.location && <> · {job.location}</>}</span>
                        <span className="sample-flag">Free Sample</span>
                        {job.posted_at && <span className="ago fresh">{timeAgo(job.posted_at)}</span>}
                      </div>
                      <h3><a href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, i)}>{job.title}</a></h3>
                      <p className="meta">
                        <b>{job.company ?? 'Company not disclosed'}</b>
                        {job.seniority && job.seniority !== 'Unknown' && <><span className="sep">·</span>{job.seniority}</>}
                      </p>
                      {job.summary && <p className="summary">{job.summary}</p>}
                      {(job.salary || job.apply_method) && (
                        <p className="salary">
                          {job.salary}
                          {job.apply_method && <span className="via">via: {job.apply_method}</span>}
                        </p>
                      )}
                      <div className="card-foot">
                        <span className="avatar">
                        {job.author_avatar
                          ? <img src={job.author_avatar} alt="" loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          : null}
                        <i>{initials(job.author_name || '?')}</i>
                      </span>
                        <span className="author">
                          {job.author_linkedin_url && job.author_linkedin_url !== '#'
                            ? <a href={job.author_linkedin_url} target="_blank" rel="noopener noreferrer" onClick={() => trackAuthorClick(job)}><b>{job.author_name}</b></a>
                            : <b>{job.author_name}</b>}
                          {job.author_headline && <> · {job.author_headline}</>}
                        </span>
                        <div className="card-actions">
                          <button className={`ghost-btn${saved.has(job.id) ? ' saved' : ''}`} onClick={() => toggleSaved(job.id)}>
                            {saved.has(job.id) ? '★ Saved' : '☆ Save'}
                          </button>
                          <a className="apply-btn" href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, i)}>
                            View post
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17 17 7M7 7h10v10" /></svg>
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                  {lockedShown.map(renderLocked)}
                </div>
              </div>
            )}

            {!hasPass && (
              <div className="inline-cta">
                <div>
                  <h3>{withheld > 0 ? `${withheld} priority roles are hidden in your track.` : 'Stop seeing openings 2 days after everyone else.'}</h3>
                  <p>Get instant access to recruiter names and direct application links the second they are shared. Discounted to $9 for your first month.</p>
                </div>
                <a className="btn-primary lg" href="/offer?src=inline" onClick={() => track('cta_click', { where: 'inline' })}><BoltIcon />{CTA_LABEL}</a>
              </div>
            )}

            {splitFeed && <div className="sec-head"><span>Delayed Free Feed</span><i />{!hasPass && <em className="sec-note">Older than {FREE_DELAY_HOURS} hours</em>}</div>}
            <div className="cards">
              {!splitFeed && lockedShown.map(renderLocked)}
              {myFeedOn && myStatus && (
                <p className="match-status" aria-live="polite">
                  <span className="ms-dot" aria-hidden="true" />
                  {myStatus.checkedAt ? <>Checked {sinceShort(myStatus.checkedAt)}</> : 'First check running'}
                  {' · '}{myStatus.newTotal} new since yesterday
                  {myStatus.pending > 0 && <> · {myStatus.pending} {myStatus.pending === 1 ? 'search' : 'searches'} still running</>}
                </p>
              )}
              {myFeedOn && myExact.length > 0 && myRough.length > 0 && (
                <p className="match-note">
                  <b>{myExact.length} match your targets exactly.</b>
                  {' '}{myRough.length} more with matching titles{myNearby > 0 ? <> — {myNearby} nearby, then the rest</> : ' elsewhere'}.
                </p>
              )}
              {myFeedOn && myExact.length === 0 && myRough.length > 0 && (
                <p className="match-note">
                  No exact local matches right now — showing {myRough.length} roles with matching titles{myNearby > 0 ? <>, nearest first ({myNearby} in your region)</> : ' elsewhere'}.
                </p>
              )}
              {earlierJobs.slice(0, visibleCount).map((job, jobIndex) => {
                const wt = inferWorkType(job)
                return (
                  <article key={job.id} id={`job-${job.id}`} className={`card${highlightId === job.id ? ' flash' : ''}`} style={{ ['--sec' as string]: `var(--sec-${job.sector}, var(--ink-3))` }}>
                    <div className="card-top">
                      <span className="sec-tag"><span className="dot" />{sectorLabel(job.sector)}</span>
                      {job.is_verified_job && (
                        <span className="verified">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M20 6 9 17l-5-5" /></svg>
                          Verified Post
                        </span>
                      )}
                      {!!job.repost_count && (
                        <span className="reposts" title="Multiple recruiters posted this role; showing latest">
                          Posted {job.repost_count + 1}×
                        </span>
                      )}
                      {job.posted_at && <span className={`ago${isFresh(job.posted_at) ? ' fresh' : ''}`}>{timeAgo(job.posted_at)}</span>}
                    </div>

                    {job.gated
                      ? <h3 className="gated-h">{job.title}</h3>
                      : <h3><a href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, jobIndex)}>{job.title}</a></h3>}
                    <p className="meta">
                      <b>{job.company ?? 'Company not disclosed'}</b>
                      {job.location && <><span className="sep">·</span>{job.location}</>}
                      {wt && wt.toLowerCase() !== job.location?.trim().toLowerCase() && <><span className="sep">·</span>{wt}</>}
                      {job.seniority && job.seniority !== 'Unknown' && <><span className="sep">·</span>{job.seniority}</>}
                    </p>
                    {job.summary && <p className="summary">{job.summary}</p>}
                    {(job.salary || job.apply_method) && (
                      <p className="salary">
                        {job.salary}
                        {job.apply_method && <span className="via">via: {job.apply_method}</span>}
                      </p>
                    )}

                    {job.gated ? (
                      <div className="card-foot gated">
                        <span className="avatar silhouette" aria-hidden="true">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
                        </span>
                        <a className="author gated-author" href="/offer?src=recruiter_line" onClick={() => {
                          track('cta_click', { where: 'recruiter_line', age_days: job.posted_at ? Math.floor((Date.now() - new Date(job.posted_at).getTime()) / 86400000) : null })
                          try { sessionStorage.setItem('bcj_gate_job', JSON.stringify({ title: job.title, company: job.company, location: job.location, posted_at: job.posted_at, at: Date.now() })) } catch {}
                        }}>
                          Posted by <span className="blur-name" aria-hidden="true">{standInName(job.id)}</span>
                          {job.author_headline && <> · {job.author_headline}</>}
                          <span className="named">Unlock Name & Profile Link &rarr;</span>
                        </a>
                        <div className="card-actions">
                          <button className={`ghost-btn${saved.has(job.id) ? ' saved' : ''}`} onClick={() => toggleSaved(job.id)}>
                            {saved.has(job.id) ? '★ Saved' : '☆ Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                    <div className="card-foot">
                      <span className="avatar">
                        {job.author_avatar
                          ? <img src={job.author_avatar} alt="" loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          : null}
                        <i>{initials(job.author_name || '?')}</i>
                      </span>
                      <span className="author">
                        {job.author_linkedin_url && job.author_linkedin_url !== '#'
                          ? <a href={job.author_linkedin_url} target="_blank" rel="noopener noreferrer"><b>{job.author_name}</b></a>
                          : <b>{job.author_name}</b>}
                        {job.author_headline && <> · {job.author_headline}</>}
                      </span>
                      <div className="card-actions">
                        <button className={`ghost-btn${saved.has(job.id) ? ' saved' : ''}`} onClick={() => toggleSaved(job.id)}>
                          {saved.has(job.id) ? '★ Saved' : '☆ Save'}
                        </button>
                        <a className="apply-btn" href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={() => trackJobClick(job, jobIndex)}>
                          View post
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17 17 7M7 7h10v10" /></svg>
                        </a>
                      </div>
                    </div>
                    )}
                  </article>
                )
              })}
            </div>
            {showFreshUpsell && (
              <a className="fresh-more" href="/offer?src=search_end" onClick={() => track('cta_click', { where: 'search_end', q: freshQuery, n: freshMatches })}>
                <span>{displayJobs.length.toLocaleString()} {displayJobs.length === 1 ? 'role' : 'roles'} · <b>{freshMatches} newer priority roles</b> available with Priority Pass</span>
                <ArrowRight />
              </a>
            )}

            {relaxed && displayJobs.length > 0 &&
             (relaxed.noLocation > displayJobs.length || relaxed.noSector > displayJobs.length || relaxed.noWorkType > displayJobs.length) && (
              <div className="relax-inline">
                <span>More roles available if you widen your criteria:</span>
                <div className="relax">
                  {relaxed.noLocation > displayJobs.length && (
                    <button onClick={() => setFilters({ ...filters, locations: [] })}>{relaxed.noLocation} in other places</button>
                  )}
                  {relaxed.noSector > displayJobs.length && (
                    <button onClick={() => setFilters({ ...filters, sector: 'all' })}>{relaxed.noSector} in other sectors</button>
                  )}
                  {relaxed.noWorkType > displayJobs.length && (
                    <button onClick={() => setFilters({ ...filters, workTypes: [] })}>{relaxed.noWorkType} in other work types</button>
                  )}
                </div>
              </div>
            )}
            </>
          )}

          <footer className="colophon">
            <span>Sourced directly from LinkedIn recruiter postings · AI-classified · backchannel.jobs © {new Date().getFullYear()}</span>
            {lastUpdated && <span className="mono">Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </footer>
        </main>
      </div>

      <style>{`
        .ulj {
          --page:      #F5F2EB;
          --surface:   #FDFCFA;
          --surface-2: #F0ECE2;
          --ink:       #191713;
          --ink-2:     #5C574D;
          --ink-3:     #97907E;
          --hairline:  #E4DFD2;
          --hairline-2:#D8D2C2;
          --live:      #0A7A3D;
          --shadow:    0 1px 2px rgba(25,23,19,0.05), 0 6px 20px -8px rgba(25,23,19,0.09);
          --shadow-lift: 0 2px 4px rgba(25,23,19,0.06), 0 14px 34px -10px rgba(25,23,19,0.16);
          --sec-finance:   #008300;
          --sec-tech:      #2a78d6;
          --sec-legal:     #eda100;
          --sec-marketing: #e87ba4;
          --sec-realestate:#4a3aa7;
          --sec-sales:#a8571c;
          --sec-hr:#1f7a6b;
          --link:      #1B4F82;
          --accent:    #1B4F82;
          --accent-soft:#E4EAF6;
          --cta:       #1B4F82;
          --cta-hover: #143B5E;
          --cta-fg:    #FFFFFF;
          --line-strong:#B9B2A2;
          --live-soft: #E2F0E6;
        }
        .ulj.dark {
          --page:      #131210;
          --surface:   #1C1A17;
          --surface-2: #26231F;
          --ink:       #F2EFE7;
          --ink-2:     #A9A293;
          --ink-3:     #6E6857;
          --hairline:  #2C2924;
          --hairline-2:#3A362F;
          --live:      #2FA36A;
          --shadow:    0 1px 2px rgba(0,0,0,0.3);
          --shadow-lift: 0 10px 30px -8px rgba(0,0,0,0.5);
          --sec-finance:   #008300;
          --sec-tech:      #3987e5;
          --sec-legal:     #c98500;
          --sec-marketing: #d55181;
          --sec-realestate:#b3a7f2;
          --sec-sales:#e8a86a;
          --sec-hr:#6fc9b8;
          --link:      #7FB3E3;
          --accent:    #6F97EE;
          --accent-soft:#212B45;
          --cta:       #6B98FF;
          --cta-hover: #85AAFF;
          --cta-fg:    #0B1224;
          --line-strong:#5A5649;
          --live-soft: #1B2E22;
        }

        .ulj, .ulj * { box-sizing: border-box; margin: 0; }
        .ulj {
          min-height: 100vh;
          background: var(--page);
          color: var(--ink);
          font-family: var(--font-inter), system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          transition: background .25s, color .25s;
          -webkit-font-smoothing: antialiased;
        }
        .ulj .mono { font-family: var(--font-spline-mono), ui-monospace, monospace; }
        .ulj button { font-family: inherit; }

        .ulj .masthead {
          position: sticky; top: 0; z-index: 50;
          background: color-mix(in srgb, var(--page) 88%, transparent);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--hairline);
        }
        .ulj .masthead-in {
          max-width: 1200px; margin: 0 auto; padding: 0 28px;
          height: 60px; display: flex; align-items: center; gap: 20px;
        }
        .ulj .wordmark {
          font-family: var(--font-fraunces), Georgia, serif; font-size: 21px; font-weight: 600;
          letter-spacing: -0.02em; white-space: nowrap; text-decoration: none; color: var(--ink);
        }
        .ulj .wordmark em { font-style: italic; font-weight: 400; color: var(--ink-2); }
        .ulj .search-wrap { flex: 1; max-width: 460px; position: relative; margin: 0 auto; }
        .ulj .search-wrap > svg { position: absolute; left: 13px; top: 50%; translate: 0 -50%; color: var(--ink-3); pointer-events: none; }
        .ulj .slash {
          position: absolute; right: 10px; top: 50%; translate: 0 -50%;
          font-size: 11px; color: var(--ink-3); border: 1px solid var(--hairline-2);
          border-radius: 5px; padding: 1px 6px; background: var(--surface);
        }
        .ulj .search { -webkit-appearance: none; appearance: none; }
        .ulj .search::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
        .ulj .search {
          width: 100%; height: 38px; padding: 0 40px 0 36px;
          background: var(--surface); color: var(--ink);
          border: 1px solid var(--hairline-2); border-radius: 10px;
          font: 500 13.5px var(--font-inter), sans-serif; outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .ulj .search::placeholder { color: var(--ink-3); }
        .ulj .search:focus { border-color: var(--ink-2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 8%, transparent); }
        .ulj .mast-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
        
        .ulj .icon-btn {
          width: 36px; height: 36px; display: grid; place-items: center;
          background: var(--surface); border: 1px solid var(--hairline-2);
          border-radius: 10px; color: var(--ink-2); cursor: pointer; transition: .15s;
        }
        .ulj .icon-btn:hover { color: var(--ink); border-color: var(--ink-3); }

        .ulj .hero { max-width: 1200px; margin: 0 auto; padding: 36px 28px 28px; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 32px 48px; align-items: start; }
        .ulj .hero-copy { display: flex; flex-direction: column; gap: 16px; }
        
        .ulj .hero-trust-tag { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-2); background: var(--surface); border: 1px solid var(--hairline-2); padding: 4px 12px; border-radius: 99px; width: fit-content; }
        .ulj .stars { display: inline-flex; gap: 2px; color: #D97706; }

        .ulj .hero h1 {
          font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: clamp(36px, 4.8vw, 56px);
          line-height: 1.08; letter-spacing: -0.02em; margin: 0;
        }
        .ulj .hero h1 em { font-style: normal; color: var(--accent); }
        .ulj .hero .sub { font-size: 16.5px; line-height: 1.55; color: var(--ink-2); max-width: 54ch; margin: 0; }
        
        /* Optimized Hero Offer Card */
        .ulj .offer { margin-top: 8px; display: flex; flex-direction: column; gap: 12px; max-width: 580px; }
        .ulj .offer-main-card {
          background: var(--surface); border: 2px solid var(--accent); border-radius: 16px; padding: 20px 22px;
          display: flex; flex-direction: column; gap: 14px; box-shadow: 0 4px 20px rgba(27,79,130,0.1);
        }
        .ulj .offer-badge { align-self: flex-start; background: #FEF3C7; color: #92400E; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 99px; }
        .ulj .offer-pricing { display: flex; align-items: baseline; gap: 12px; }
        .ulj .offer-price-big { font-family: var(--font-fraunces), Georgia, serif; font-size: 42px; font-weight: 500; line-height: 1; color: var(--ink); }
        .ulj .offer-price-details { display: flex; flex-direction: column; }
        .ulj .offer-strike { font-size: 13px; color: var(--ink-3); text-decoration: line-through; }
        .ulj .offer-sub { font-size: 12.5px; color: var(--ink-2); font-weight: 500; }
        
        .ulj .offer-cta-btn { width: 100%; height: 46px; font-size: 15px; font-weight: 700; border-radius: 10px; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 8px rgba(27,79,130,0.2); }
        .ulj .offer-guarantee { font-size: 11.5px; color: var(--ink-3); text-align: center; }

        .ulj .offer-free-option { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-3); padding-left: 4px; }
        .ulj .offer-free-link { color: var(--ink-2); text-decoration: underline; text-underline-offset: 3px; font-weight: 500; }
        .ulj .offer-free-link:hover { color: var(--ink); }

        .ulj .offer-wrap { display: none; max-width: 1200px; margin: 0 auto; padding: 0 28px 28px; }
        @media (max-width: 900px) {
          .ulj .offer-d { display: none; }
          .ulj .offer-wrap { display: block; }
        }
        @media (max-width: 760px) { .ulj .offer-wrap { padding: 0 16px 24px; } }

        .ulj .promises { list-style: none; padding: 0; margin: 0; max-width: 580px; display: flex; flex-wrap: wrap; gap: 8px 18px; }
        .ulj .promises li { --t: calc(300ms + var(--i) * 300ms); display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 500; color: var(--ink-2); white-space: nowrap; }
        .ulj .pm-check {
          flex: none; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
          color: #fff; background: var(--live);
        }
        .ulj .pm-check svg { width: 11px; height: 11px; }

        .ulj .art { position: relative; width: 100%; max-width: 520px; margin-left: auto; }
        .ulj .art-m-wrap { display: none; }
        .ulj .art-post { position: relative; z-index: 2; width: 68%; background: var(--surface); border: 1px solid var(--hairline); border-radius: 14px; padding: 14px 16px; box-shadow: var(--shadow); }
        .ulj .art-h { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .ulj .art-h b { display: block; font-size: 13.5px; line-height: 1.2; }
        .ulj .art-h small { display: block; font-size: 11.5px; color: var(--ink-2); }
        .ulj .art .li { width: 28px; height: 28px; border-radius: 6px; background: #0A66C2; color: #fff; display: grid; place-items: center; font: 700 14px var(--font-inter), sans-serif; flex: none; }
        .ulj .art-post p { font-size: 13px; color: var(--ink-2); line-height: 1.4; }
        .ulj .art-note { position: absolute; z-index: 3; top: 2px; right: 0; width: 31%; display: flex; flex-direction: column; font: 600 20px/1.02 var(--font-caveat), 'Segoe Print', 'Bradley Hand', cursive; color: var(--ink); transform: rotate(-4deg); }
        .ulj .art-note svg { width: 48px; height: 32px; margin: 0 0 2px -28px; }
        .ulj .art-role { position: relative; z-index: 1; margin-top: -12px; background: var(--surface); border: 1px solid var(--hairline); border-radius: 16px; padding: 28px 20px 18px; box-shadow: var(--shadow-lift); }
        .ulj .art-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .ulj .art .new { font: 600 11.5px var(--font-inter), sans-serif; padding: 2px 8px; border-radius: 999px; background: var(--live-soft); color: var(--live); }
        .ulj .art-eg { font: 500 11px var(--font-spline-mono), monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
        .ulj .art-role h3 { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 24px; line-height: 1.15; letter-spacing: -.01em; margin-bottom: 4px; }
        .ulj .art-meta { font-size: 13.5px; color: var(--ink-2); }
        .ulj .art-facts { list-style: none; padding: 0; margin: 10px 0 10px; display: grid; gap: 2px; font-size: 13px; color: var(--ink-2); }
        .ulj .art-quote { font-size: 13px; color: var(--ink-2); }
        .ulj .art-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .ulj .art-tags span { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
        .ulj .art-actions { display: flex; gap: 8px; margin-top: 14px; }

        .ulj .btn-primary {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          height: 38px; padding: 0 16px; border-radius: 10px; white-space: nowrap;
          background: var(--cta); color: var(--cta-fg); border: 1px solid var(--cta);
          font: 600 13.5px var(--font-inter), sans-serif; text-decoration: none; cursor: pointer;
          box-shadow: 0 2px 8px color-mix(in srgb, var(--cta) 25%, transparent);
          transition: background .12s, border-color .12s;
        }
        .ulj .btn-primary:hover { background: var(--cta-hover); border-color: var(--cta-hover); }
        .ulj .btn-primary:disabled { opacity: .7; cursor: wait; }
        .ulj .checkout-error { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(18px + env(safe-area-inset-bottom, 0px)); z-index: 80; display: flex; align-items: center; gap: 14px; width: max-content; max-width: calc(100vw - 32px); padding: 12px 16px; border-radius: 12px; background: #8A1F1F; color: #fff; font-size: 13.5px; box-shadow: 0 12px 32px -10px rgba(0,0,0,.45); }
        .ulj .checkout-error button { background: none; border: none; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; opacity: .8; }
        .ulj .btn-primary.lg { height: 46px; padding: 0 22px; font-size: 15px; border-radius: 10px; }
        .ulj .btn-primary.block { width: 100%; }
        .ulj .btn-ghost {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          height: 38px; padding: 0 16px; border-radius: 10px; white-space: nowrap;
          background: transparent; color: var(--ink); border: 1.5px solid var(--line-strong);
          font: 500 13.5px var(--font-inter), sans-serif; text-decoration: none; cursor: pointer; transition: .12s;
        }
        .ulj .btn-ghost:hover { background: var(--surface-2); border-color: var(--ink); }
        .ulj .btn-ghost.sm { height: 32px; padding: 0 12px; font-size: 12.5px; border-radius: 8px; }

        .ulj .layout { max-width: 1200px; margin: 0 auto; padding: 8px 28px 60px; display: grid; grid-template-columns: 218px 1fr; gap: 40px; align-items: start; }
        .ulj .layout > * { min-width: 0; }

        .ulj .filters {
          position: sticky; top: 84px;
          display: flex; flex-direction: column; gap: 24px;
          max-height: calc(100vh - 100px);
          overflow-y: auto; overflow-x: hidden;
          margin: 0 -10px; padding: 8px 10px 24px;
          scrollbar-width: none;
        }
        .ulj .filters::-webkit-scrollbar { display: none; }
        .ulj .flabel {
          font-size: 10.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
          color: var(--ink-3); padding-bottom: 10px; margin-bottom: 4px; border-bottom: 1px solid var(--hairline);
          display: flex; justify-content: space-between; align-items: baseline;
        }
        .ulj .flabel button { font-size: 10px; letter-spacing: 0; text-transform: none; background: none; border: none; color: var(--ink-3); cursor: pointer; padding: 0; }
        .ulj .flabel button:hover { color: var(--ink); text-decoration: underline; }
        .ulj .sector-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; margin: 1px -10px; width: calc(100% + 20px);
          background: none; border: none; border-radius: 8px;
          font: 500 13.5px var(--font-inter), sans-serif; color: var(--ink-2);
          cursor: pointer; text-align: left; transition: .12s;
        }
        .ulj .sector-row:hover { background: var(--surface-2); color: var(--ink); }
        .ulj .sector-row.active { background: var(--accent-soft); box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--ink); font-weight: 600; }
        .ulj .sector-row .dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; background: var(--dot, var(--ink-3)); }
        .ulj .sector-row .cnt { margin-left: auto; font: 500 11.5px var(--font-spline-mono), monospace; color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .ulj .sector-row.active .cnt { color: var(--ink); }
        .ulj .check-row {
          display: flex; align-items: center; gap: 10px; padding: 7px 0;
          background: none; border: none; width: 100%; cursor: pointer; text-align: left;
          font: 500 13.5px var(--font-inter), sans-serif; color: var(--ink-2); transition: color .12s;
        }
        .ulj .check-row:hover { color: var(--ink); }
        .ulj .check-row .box {
          width: 16px; height: 16px; border-radius: 5px; flex-shrink: 0;
          border: 1.5px solid var(--hairline-2); background: var(--surface);
          display: grid; place-items: center; transition: .12s; color: var(--page);
        }
        .ulj .check-row.on { color: var(--ink); }
        .ulj .check-row.on .box { background: var(--accent); border-color: var(--accent); color: #fff; }

        .ulj .side-note { font-size: 11.5px; color: var(--ink-3); line-height: 1.5; padding-top: 4px; }
        .ulj .saved-list { display: flex; flex-direction: column; gap: 2px; }
        .ulj .saved-link {
          display: flex; align-items: baseline; gap: 8px; width: 100%;
          padding: 6px 0; background: none; border: none; cursor: pointer; text-align: left;
          font: 500 12.5px var(--font-inter), sans-serif; color: var(--ink-2); transition: color .12s;
        }
        .ulj .saved-link:hover { color: var(--ink); }
        .ulj .saved-link .star { color: var(--live); font-size: 11px; flex-shrink: 0; }
        .ulj .saved-link .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .ulj .feed-bar { display: flex; align-items: baseline; gap: 14px; padding: 8px 0 16px; min-height: 48px; box-sizing: border-box; }
        .ulj .feed-bar .count { font-family: var(--font-fraunces), Georgia, serif; font-size: 17px; font-weight: 500; }
        .ulj .feed-bar .count b { font-variant-numeric: tabular-nums; }
        .ulj a.new-today { text-decoration: none; cursor: pointer; }
        .ulj a.new-today:hover { filter: brightness(.95); }
        .ulj .new-today { align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: var(--live-soft); color: var(--live); font: 600 12px var(--font-inter), sans-serif; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .ulj .new-today .nd { width: 6px; height: 6px; border-radius: 50%; background: var(--live); animation: ulj-pulse 2.2s infinite; }
        .ulj .feed-bar .clear { font-size: 12px; color: var(--ink-2); background: none; border: none; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; padding: 0; }
        .ulj .feed-bar .clear:hover { color: var(--ink); }
        .ulj .sort-wrap { margin-left: auto; }
        .ulj select {
          height: 32px; padding: 0 10px; background: var(--surface); color: var(--ink-2);
          border: 1px solid var(--hairline-2); border-radius: 8px; font: 500 12.5px var(--font-inter), sans-serif;
          outline: none; cursor: pointer;
        }

        .ulj .press {
          position: relative; overflow: hidden;
          display: flex; align-items: center; gap: 10px;
          background: var(--surface); border: 1px solid var(--hairline);
          border-radius: 11px; padding: 11px 16px; margin-bottom: 14px;
          box-shadow: var(--shadow); font-size: 12.5px; color: var(--ink-2);
        }
        .ulj .press-ph { min-height: 45px; visibility: hidden; }
        .ulj .press .bar {
          position: absolute; left: 0; top: 0; bottom: 0;
          background: var(--surface-2); border-right: 1px solid var(--hairline-2);
        }
        .ulj .press .bar.shimmer {
          width: 100%; border-right: none;
          background: linear-gradient(100deg, var(--surface-2) 40%, var(--surface) 50%, var(--surface-2) 60%);
          background-size: 200% 100%; animation: ulj-shimmer 1.6s infinite;
        }
        .ulj .press > *:not(.bar) { position: relative; z-index: 1; }
        .ulj .press .pdot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); animation: ulj-pulse 2.2s infinite; flex-shrink: 0; }
        .ulj .press.far .pdot { animation: none; opacity: .5; }
        .ulj .press .plabel { font-weight: 600; color: var(--ink); white-space: nowrap; }
        .ulj .press .pdetail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .press .pclock { margin-left: auto; font: 600 13px var(--font-spline-mono), monospace; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .ulj .press .pclock .unit { font-weight: 400; color: var(--ink-3); font-size: 11px; margin: 0 5px 0 1px; }

        .ulj .cards { display: flex; flex-direction: column; gap: 14px; }
        .ulj .skeleton {
          height: 190px; border-radius: 14px; border: 1px solid var(--hairline);
          background: linear-gradient(100deg, var(--surface) 40%, var(--surface-2) 50%, var(--surface) 60%);
          background-size: 200% 100%; animation: ulj-shimmer 1.4s infinite;
        }
        @keyframes ulj-shimmer { to { background-position: -200% 0; } }
        .ulj .card {
          position: relative; background: var(--surface); border: 1px solid var(--hairline);
          border-radius: 14px; padding: 20px 24px 0 24px; box-shadow: var(--shadow);
          transition: box-shadow .18s, translate .18s, border-color .18s;
          overflow: hidden;
        }
        .ulj .card::before {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: var(--sec, var(--ink-3));
        }
        .ulj .card:hover { box-shadow: var(--shadow-lift); translate: 0 -2px; border-color: var(--hairline-2); }
        .ulj .card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .ulj .wordmark .mark { flex: none; width: 30px; height: 30px; border-radius: 7px;
          background: #185FA5; color: #FFFFFF; display: inline-flex; align-items: center;
          justify-content: center; font-family: var(--font-fraunces), Georgia, serif; font-size: 18px;
          font-weight: 500; line-height: 1; }

        .ulj .sec-tag { display: inline-flex; align-items: center; gap: 7px; font-size: 10.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-2); }
        .ulj .sec-tag .dot { width: 8px; height: 8px; border-radius: 3px; background: var(--sec); }
        .ulj .verified { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ink-3); }
        .ulj .verified svg { color: var(--live); }
        .ulj .ago { margin-left: auto; font: 500 11.5px var(--font-spline-mono), monospace; color: var(--ink-3); }
        .ulj .ago.fresh { color: var(--live); }
        .ulj .card h3 { font-family: var(--font-fraunces), Georgia, serif; font-size: 20px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.25; }
        .ulj .card h3 a { color: #1B4F82; text-decoration: none; }
        .ulj.dark .card h3 a { color: #7FB3E3; }
        .ulj .card h3 a:hover { text-decoration: underline; text-underline-offset: 3px; }
        .ulj .meta { margin-top: 5px; font-size: 13px; color: var(--ink-2); }
        .ulj .meta b { color: var(--ink); font-weight: 600; }
        .ulj .meta .sep { margin: 0 7px; color: var(--ink-3); }
        .ulj .summary { margin-top: 10px; font-size: 13.5px; color: var(--ink-2); max-width: 640px; }
        .ulj .salary { margin-top: 12px; font: 600 14px var(--font-spline-mono), monospace; color: var(--ink); }
        .ulj .salary .via { font: 500 11.5px var(--font-inter), sans-serif; color: var(--ink-3); margin-left: 10px; }
        .ulj .card-foot {
          margin: 16px -24px 0; padding: 12px 24px 14px 24px;
          border-top: 1px solid var(--hairline);
          display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;
        }
        .ulj .card-foot .author { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .avatar {
          position: relative; overflow: hidden;
          width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
          background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--hairline-2);
          display: grid; place-items: center; font: 600 13px var(--font-inter), sans-serif;
        }
        .ulj .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
        .ulj .avatar i { font-style: normal; }
        .ulj .author { font-size: 12px; color: var(--ink-2); line-height: 1.3; }
        .ulj .author b { color: var(--ink); font-weight: 600; }
        .ulj .author a { color: inherit; text-decoration: none; }
        .ulj .author a:hover { text-decoration: underline; }
        .ulj .card-actions { margin-left: auto; display: flex; gap: 8px; }
        .ulj .ghost-btn {
          height: 30px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px;
          background: none; border: 1px solid var(--hairline-2); border-radius: 8px;
          font: 600 12px var(--font-inter), sans-serif; color: var(--ink-2); cursor: pointer; transition: .12s;
        }
        .ulj .ghost-btn:hover { color: var(--ink); border-color: var(--ink-3); }
        .ulj .ghost-btn.saved { color: var(--live); border-color: var(--live); }
        .ulj .apply-btn {
          height: 30px; padding: 0 14px; display: inline-flex; align-items: center; gap: 6px;
          background: transparent; color: var(--ink); border: 1.5px solid var(--line-strong); border-radius: 8px;
          font: 600 12px var(--font-inter), sans-serif; cursor: pointer; text-decoration: none; transition: .12s;
        }
        .ulj .apply-btn:hover { background: var(--surface-2); border-color: var(--ink); }

        .ulj .empty {
          background: var(--surface); border: 1px dashed var(--hairline-2); border-radius: 16px;
          padding: 64px 24px; text-align: center;
        }
        .ulj .empty h3 { font-family: var(--font-fraunces), Georgia, serif; font-size: 22px; font-weight: 500; }
        .ulj .empty p { margin: 8px 0 20px; color: var(--ink-2); font-size: 13.5px; }

        .ulj .colophon {
          margin-top: 40px; padding-top: 22px;
          border-top: 1px solid var(--hairline);
          display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          font-size: 11.5px; color: var(--ink-3);
        }

        .ulj .filters-head { display: none; }
        .ulj .fbadge {
          min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px;
          background: var(--accent); color: #fff;
          font: 600 10.5px var(--font-spline-mono), monospace;
          display: inline-grid; place-items: center;
        }

        @media (max-width: 900px) {
          .ulj .layout { grid-template-columns: 1fr; gap: 16px; }
          .ulj .filters { position: static; padding: 0; margin: 0; gap: 0; max-height: none; overflow: visible; }
          .ulj .filters-head {
            display: flex; align-items: center; gap: 8px; width: 100%;
            padding: 11px 14px; background: var(--surface);
            border: 1px solid var(--hairline-2); border-radius: 10px;
            font: 600 13px var(--font-inter), sans-serif; color: var(--ink); cursor: pointer;
          }
          .ulj .filters-head .chev { margin-left: auto; transition: transform .15s; }
          .ulj .filters-head .chev.up { transform: rotate(180deg); }
          .ulj .filters .fgroup, .ulj .filters .side-note { display: none; }
          .ulj .filters.open .fgroup { display: block; margin-top: 18px; }
          .ulj .filters.open .side-note { display: block; margin-top: 14px; }
          .ulj .hero { grid-template-columns: 1fr; align-items: start; }
          .ulj .hero .art-d { display: none; }
          .ulj .art-m-wrap { display: block; max-width: 1200px; margin: 0 auto; padding: 0 28px 28px; }
          .ulj .art { margin: 0 auto 0 0; }
          .ulj .pass-side { display: none; }
        }

        @media (max-width: 760px) {
          .ulj .masthead-in { flex-wrap: wrap; height: auto; padding: 10px 16px; gap: 10px; }
          .ulj .search-wrap { order: 3; flex-basis: 100%; max-width: none; }
          .ulj .search { font-size: 16px; }
          .ulj .slash { display: none; }
          .ulj .hero { padding: 24px 16px 16px; gap: 20px; }
          .ulj .art-m-wrap { padding: 0 16px 24px; }
          .ulj .hero .sub { font-size: 15px; }
          .ulj .art-post { width: 100%; }
          .ulj .art-note { position: static; width: auto; transform: none; flex-direction: row; align-items: center; gap: 8px; margin: 8px 0 0 8px; font-size: 19px; }
          .ulj .art-note svg { margin: 0; flex: none; transform: rotate(-90deg) scaleX(-1); }
          .ulj .art-role { margin-top: 0; padding-top: 20px; }
          .ulj .layout { padding: 4px 16px 40px; }
        }

        .ulj .drop { margin-top: 8px; }
        .ulj .drop-btn { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 12px; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 9px; cursor: pointer; font: 500 13px var(--font-inter), sans-serif; color: var(--ink); text-align: left; }
        .ulj .drop-btn.open { border-color: var(--ink-2); }
        .ulj .drop-btn .dl { color: var(--ink-3); font-size: 12px; }
        .ulj .drop-btn .dv { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
        .ulj .drop-panel { margin-top: 6px; padding: 6px; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 10px; }
        .ulj .drop-panel .loc-search { margin: 2px 0 6px; }
        .ulj .drop-list { max-height: 240px; overflow-y: auto; }
        .ulj .drop-panel > .radio-row, .ulj .drop-list > .radio-row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; background: none; border: none; border-radius: 7px; cursor: pointer; font: 500 13px var(--font-inter), sans-serif; color: var(--ink-2); text-align: left; }
        .ulj .radio-row:hover { background: var(--page); color: var(--ink); }
        .ulj .radio-row.on { color: var(--ink); }
        .ulj .radio-row .rad { flex: none; width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--hairline-2); background: var(--surface); display: grid; place-items: center; }
        .ulj .radio-row.on .rad { border-color: var(--accent); }
        .ulj .radio-row.on .rad::after { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
        .ulj .radio-row .n { margin-left: auto; font: 500 10.5px var(--font-spline-mono), monospace; color: var(--ink-3); }

        .ulj .member-wrap { max-width: 1200px; margin: 0 auto; padding: 20px 28px 0; }
        .ulj .member-bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid var(--hairline-2); border-radius: 12px; background: var(--surface); font-size: 13.5px; }
        .ulj .member-bar.active { background: var(--live-soft); border-color: transparent; }
        .ulj .member-bar.active b { color: var(--live); }
        .ulj .mb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--live); animation: ulj-pulse 2.2s infinite; flex: none; }
        .ulj .mb-link { margin-left: auto; font: 600 13px var(--font-inter), sans-serif; color: var(--link); text-decoration: underline; text-underline-offset: 3px; }
        .ulj .member-bar.free { background: var(--accent-soft); border-color: transparent; }
        .ulj .member-bar.free .mb-copy { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; flex: 1; min-width: 0; }
        .ulj .member-bar.free .btn-primary { margin-left: auto; height: 34px; }

        .ulj .sug { position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 70; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 12px; padding: 6px; box-shadow: 0 16px 40px -12px rgba(0,0,0,.28); max-height: min(70vh, 460px); overflow-y: auto; }
        .ulj .sug-row { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 9px 10px; background: none; border: none; border-radius: 8px; cursor: pointer; text-align: left; font-family: var(--font-inter), sans-serif; }
        .ulj .sug-row.on, .ulj .sug-row:hover { background: var(--accent-soft); }
        .ulj .sug-row .sd { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--sec); }
        .ulj .sug-row .st { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .ulj .sug-row .st b { font-size: 14px; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .sug-row .st span { font-size: 12.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ulj .bar-up { position: absolute; right: 7px; top: 50%; translate: 0 -50%; height: 24px; display: inline-flex; align-items: center; padding: 0 9px; border-radius: 999px; background: var(--cta); color: #fff; font: 600 11.5px var(--font-inter), sans-serif; text-decoration: none; white-space: nowrap; }
        .ulj .sug-up { display: flex; align-items: center; gap: 8px; margin-top: 4px; padding: 10px; border-radius: 8px; background: var(--accent-soft); color: var(--ink-2); font-size: 13px; text-decoration: none; }
        .ulj .sug-up b { color: var(--ink); font-weight: 600; }

        .ulj .sample-flag { font: 500 11px var(--font-spline-mono), monospace; letter-spacing: .06em; text-transform: uppercase; background: var(--live-soft); color: var(--live); padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
        .ulj .sample-flag.priority { background: #FEF3C7; color: #92400E; }
        .ulj .sec-head .sec-note { font-style: normal; font-size: 11.5px; color: var(--ink-2); background: var(--accent-soft); padding: 3px 10px; border-radius: 999px; }

        .ulj .card.locked-title:hover { translate: 0 0; box-shadow: var(--shadow); border-color: var(--hairline); }
        .ulj .card h3.locked-h { color: var(--link); }
        .ulj .locked-blur { filter: blur(5px); user-select: none; pointer-events: none; }
        .ulj .lock-foot { background: linear-gradient(90deg, var(--accent-soft), transparent 85%); justify-content: space-between; }
        .ulj .lock-when { font-size: 12.5px; color: var(--ink-2); }
        .ulj .lock-when b { color: var(--ink); font-weight: 600; }
        .ulj .lock-now { font-size: 12.5px; font-weight: 600; color: var(--accent); text-decoration: none; white-space: nowrap; }

        .ulj .feed-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; padding: 11px 16px; border: 1px solid var(--hairline-2); border-radius: 12px; background: var(--accent-soft); color: var(--ink-2); font-size: 14px; text-decoration: none; transition: border-color .15s; }
        .ulj .feed-top b { color: var(--ink); font-weight: 600; }
        .ulj .feed-top em { font-style: normal; font-size: 13px; font-weight: 600; color: var(--accent); white-space: nowrap; }

        .ulj .card h3.gated-h { color: var(--ink); }
        .ulj .avatar.silhouette { color: var(--ink-3); }
        .ulj .author.gated-author { text-decoration: none; color: var(--ink-2); }
        .ulj .blur-name { display: inline-block; filter: blur(4px); color: var(--ink); font-weight: 600; user-select: none; }
        .ulj .author .named { margin-left: 8px; color: var(--accent); font-weight: 600; }

        .ulj .pass { background: #14213D; color: #F3F1EA; border-radius: 16px; padding: 20px; }
        .ulj.dark .pass { background: #0E1830; }
        .ulj .pass h3 { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 24px; line-height: 1.1; margin-bottom: 6px; }
        .ulj .pass .pass-sub { font-size: 13.5px; color: #A9B4CC; margin: 0 0 14px; }
        .ulj .pass .pass-fine { display: block; margin-top: 10px; font-size: 11.5px; color: #A9B4CC; text-align: center; }

        .ulj .inline-cta { display: grid; grid-template-columns: 1fr auto; gap: 16px 24px; align-items: center; background: #14213D; color: #F3F1EA; border-radius: 16px; padding: 22px 24px; margin: 4px 0 30px; }
        .ulj.dark .inline-cta { background: #0E1830; }
        .ulj .inline-cta h3 { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 24px; line-height: 1.15; margin-bottom: 4px; }
        .ulj .inline-cta p { font-size: 13.5px; color: #A9B4CC; }

        .ulj .howbar-wrap { max-width: 1200px; margin: 0 auto; padding: 0 28px; }
        .ulj .howbar { display: flex; border-block: 1px solid var(--hairline-2); margin-bottom: 32px; }
        .ulj .hb-title { flex: 0 0 190px; align-self: center; padding: 14px 20px 14px 0; font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 22px; line-height: 1.15; }
        .ulj .hb-steps { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; padding: 0; }
        .ulj .hb-steps li { display: grid; grid-template-columns: 26px 1fr; column-gap: 12px; align-items: start; padding: 16px 20px; border-left: 1px solid var(--hairline-2); }
        .ulj .hb-steps i { font: 500 12px var(--font-spline-mono), monospace; font-style: normal; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); }
        .ulj .hb-steps b { display: block; font: 600 13.5px/1.3 var(--font-inter), sans-serif; margin-top: 3px; }
        .ulj .hb-steps span { display: block; margin-top: 2px; font-size: 12.5px; line-height: 1.4; color: var(--ink-2); }
        
        @media (max-width: 900px) {
          .ulj .howbar { flex-direction: column; }
          .ulj .hb-title { flex: none; padding: 14px 0 4px; }
          .ulj .hb-steps li:first-child { border-left: none; padding-left: 0; }
        }
        @media (max-width: 720px) {
          .ulj .howbar-wrap { padding: 0 16px; }
          .ulj .hb-steps { grid-template-columns: 1fr; }
          .ulj .hb-steps li { border-left: none; border-top: 1px solid var(--hairline-2); padding: 12px 0; }
          .ulj .hb-steps li:first-child { border-top: none; }
        }
      `}</style>

      {checkoutError && (
        <div className="checkout-error" role="alert">
          Something went wrong initializing secure checkout. Please try again or check your blocker settings.
          <button onClick={() => setCheckoutError(false)} aria-label="Dismiss">×</button>
        </div>
      )}

    </div>
  )
}