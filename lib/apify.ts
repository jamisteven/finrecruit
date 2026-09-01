// Apify LinkedIn Post Search Scraper
// Actor: harvestapi/linkedin-post-search

export type ApifyPost = {
  id?: string
  linkedinUrl?: string
  url?: string
  postUrl?: string
  content?: string
  commentary?: string
  text?: string
  author?: {
    name?: string
    info?: string
    headline?: string
    linkedinUrl?: string
    url?: string
    profileUrl?: string
  }
  authorName?: string
  authorHeadline?: string
  authorProfileUrl?: string
  postedAt?: { date?: string; timestamp?: number } | string
  publishedAt?: string
  createdAt?: string
  repost?: ApifyPost
  job?: {
    title?: string
    location?: string
    linkedinUrl?: string
    subtitle?: string
  }
}

export type Sector = 'finance' | 'tech' | 'legal' | 'marketing' | 'realestate'

export const SECTOR_QUERIES: Record<Sector, string[]> = {
  finance: [
    'hiring geneva',
    'hiring zurich finance',
    'wir suchen zürich finance',
    'stelle frei zürich banking',
    'finance recruiter now hiring',
    'investment banking analyst associate hiring',
    'hedge fund role recruiter',
    'private equity hiring opportunity',
    'asset management recruiter mandate',
    'quant researcher trader hiring',
    'finance recruiter hiring Toronto',
    'fixed income credit recruiter hiring',
    'wealth management recruiter hiring',
    'investment banking Toronto recruiter hiring',
    'financial services recruiter opportunity',
    'private credit direct lending hiring',
    'CFO finance director hiring recruiter',
    'equity research analyst hiring recruiter',
    'private equity Toronto recruiter hiring',
    'corporate finance FP&A hiring recruiter',
    'fintech finance role recruiter hiring',
    'risk management recruiter hiring',
    'portfolio manager recruiter hiring',
    'investment analyst recruiter opportunity',
    'M&A analyst associate recruiter hiring',
    'leveraged finance recruiter hiring',
    'venture capital recruiter hiring',
    'family office recruiter hiring',
    'capital markets recruiter hiring',
    'treasury recruiter hiring opportunity',
    'credit risk analyst recruiter hiring',
    'compliance officer finance recruiter hiring',
    'macro analyst recruiter hiring',
    'distressed debt recruiter hiring',
    'prime brokerage recruiter hiring',
    'derivatives trader recruiter hiring',
    'structured products recruiter hiring',
    'fund accounting recruiter hiring',
    'real estate finance recruiter hiring',
    'infrastructure finance recruiter hiring',
    'insurance actuary recruiter hiring',
    'pension fund recruiter hiring',
    'bank capital markets recruiter hiring',
    'securities lawyer finance recruiter hiring',
    'financial controller CFO recruiter hiring',
  ],
  tech: [
    'hiring switzerland',
    'hiring zurich',
    'hiring geneva',
    'wir suchen zürich',
    'stelle frei schweiz',
    'software engineer recruiter now hiring',
    'software engineer recruiter hiring Zurich',
    'AI ML engineer recruiter opportunity',
    'backend engineer recruiter hiring',
    'tech recruiter hiring Zurich Switzerland',
    'engineering manager recruiter hiring',
    'engineering manager hiring Zurich',
    'frontend engineer recruiter hiring',
    'product manager recruiter hiring',
    'startup engineer Zurich recruiter hiring',
    'data engineer recruiter hiring',
    'AI ML engineer Zurich hiring',
    'data scientist recruiter hiring',
    'CTO VP engineering recruiter hiring',
    'Software Engineer Zürich wir suchen',
    'machine learning engineer recruiter hiring',
    'software engineer recruiter hiring Toronto',
    'devops platform engineer recruiter hiring',
    'tech recruiter hiring Toronto',
    'startup engineer Toronto recruiter hiring',
    'site reliability engineer recruiter hiring',
    'Softwareentwickler Stelle Zürich',
    'cloud architect recruiter hiring',
    'cybersecurity engineer recruiter hiring',
    'IT Recruiter Stelle Zürich Bern Basel',
    'AI engineer LLM recruiter hiring',
    'Entwickler gesucht Zürich Schweiz',
    'principal staff engineer recruiter hiring',
    'VP engineering recruiter hiring',
    'Cloud Engineer Zürich gesucht',
    'head of engineering recruiter hiring',
    'Machine Learning Engineer Zürich Stelle',
    'platform engineer kubernetes recruiter hiring',
    'staff engineer recruiter hiring',
    'Tech Lead Zürich Stelle frei',
    'solutions architect recruiter hiring',
    'DevOps Engineer Schweiz einstellen',
    'founding engineer startup recruiter hiring',
    'engineering director recruiter hiring',
    'Fullstack Entwickler Zürich gesucht',
    'backend Python Go Rust recruiter hiring',
    'frontend React Vue Angular recruiter hiring',
    'mobile iOS Swift Android Kotlin recruiter hiring',
    'mobile engineer recruiter hiring',
    'security engineer recruiter hiring',
    'full stack engineer recruiter now hiring',
    'startup engineer recruiter hiring',
    'tech lead recruiter hiring opportunity',
    'blockchain engineer recruiter hiring',
    'iOS Android engineer recruiter hiring',
    'embedded systems engineer recruiter hiring',
    'data platform engineer recruiter hiring',
    'growth engineer recruiter hiring',
    'infrastructure engineer recruiter hiring',
    'technical program manager recruiter hiring',
    'semiconductor engineer recruiter hiring',
    'fintech engineer recruiter hiring',
    'developer advocate recruiter hiring',
    'head of product recruiter hiring',
    'VP product recruiter hiring',
    'data analytics engineer recruiter hiring',
    'AI research scientist recruiter hiring',
    'prompt engineer LLM recruiter hiring',
    'cloud engineer AWS GCP Azure recruiter hiring',
    'QA automation engineer recruiter hiring',
    'Softwareingenieur Zürich einstellen',
    'CTO Head of Engineering Zürich',
    'Informatiker Zürich Stellenangebot',
    'network engineer recruiter hiring',
    'hardware engineer recruiter hiring',
  ],
  legal: [
    'legal recruiter now hiring lawyer',
    'associate solicitor recruiter hiring',
    'in-house counsel recruiter opportunity',
    'compliance recruiter hiring role',
    'corporate lawyer recruiter hiring',
    'litigation associate recruiter hiring',
    'legal counsel recruiter mandate',
    'employment lawyer recruiter hiring',
    'general counsel recruiter hiring',
    'legal recruiter hiring Toronto',
    'commercial solicitor recruiter hiring',
    'paralegal recruiter hiring',
    'private equity lawyer recruiter hiring',
    'funds lawyer recruiter hiring',
    'lawyer Toronto recruiter hiring',
    'banking finance lawyer recruiter hiring',
    'restructuring lawyer recruiter hiring',
    'data privacy lawyer recruiter hiring',
    'capital markets lawyer recruiter hiring',
    'in-house counsel Toronto recruiter hiring',
    'antitrust competition lawyer recruiter hiring',
    'insurance lawyer recruiter hiring',
    'healthcare lawyer recruiter hiring',
    'technology lawyer recruiter hiring',
    'international arbitration recruiter hiring',
    'senior associate partner law firm recruiter',
    'legal director recruiter hiring',
    'barrister chambers recruiter hiring',
    'planning environment lawyer recruiter hiring',
    'construction lawyer recruiter hiring',
    'shipping maritime lawyer recruiter hiring',
    'sports entertainment lawyer recruiter hiring',
    'immigration lawyer recruiter hiring',
    'legal operations recruiter hiring',
  ],
  marketing: [
    'marketing recruiter now hiring',
    'performance marketing recruiter hiring',
    'growth marketing recruiter hiring',
    'CMO VP marketing recruiter hiring',
    'marketing recruiter hiring Toronto',
    'digital marketing recruiter hiring',
    'head of marketing recruiter hiring',
    'content marketing recruiter hiring',
    'brand marketing recruiter hiring',
    'growth marketing Toronto recruiter hiring',
    'product marketing recruiter hiring',
    'SEO SEM recruiter hiring',
    'social media marketing recruiter hiring',
    'demand generation recruiter hiring',
    'marketing director recruiter hiring',
    'email marketing recruiter hiring',
    'creative director recruiter hiring',
    'chief marketing officer recruiter hiring',
    'B2B marketing recruiter hiring',
    'B2C marketing recruiter hiring',
    'paid media recruiter hiring',
    'influencer marketing recruiter hiring',
    'affiliate marketing recruiter hiring',
    'marketing analytics recruiter hiring',
    'CRM marketing recruiter hiring',
    'ecommerce marketing recruiter hiring',
    'go to market recruiter hiring',
    'brand strategy recruiter hiring',
    'communications PR recruiter hiring',
    'marketing technology martech recruiter hiring',
    'field marketing recruiter hiring',
    'account based marketing ABM recruiter hiring',
    'VP marketing startup recruiter hiring',
    'consumer insights recruiter hiring',
    'integrated marketing recruiter hiring',
    'category manager marketing recruiter hiring',
    'media planning buying recruiter hiring',
    'creative strategy recruiter hiring',
    'retail marketing recruiter hiring',
    'partnership marketing recruiter hiring',
  ],
  realestate: [
    'property manager recruiter hiring',
    'leasing agent recruiter hiring',
    'real estate recruiter now hiring',
    'property management recruiter now hiring',
    'real estate recruiter hiring London',
    'leasing consultant recruiter hiring',
    'property leasing recruiter opportunity',
    'real estate recruiter hiring Toronto',
    'regional property manager recruiter hiring',
    'property management recruiter hiring New York',
    'leasing manager recruiter hiring',
    'leasing specialist recruiter hiring',
    'assistant property manager recruiter hiring',
    'residential property manager recruiter hiring',
    'commercial property manager recruiter hiring',
    'leasing administrator recruiter hiring',
    'leasing coordinator recruiter hiring',
    'property maintenance recruiter hiring',
    'facilities maintenance recruiter hiring',
    'building maintenance recruiter hiring',
    'work order coordinator recruiter hiring',
    'maintenance coordinator recruiter hiring',
    'facilities coordinator recruiter hiring',
    'real estate virtual assistant recruiter hiring',
    'leasing assistant recruiter hiring',
    'property leasing assistant recruiter hiring',
    'property recruiter hiring opportunity',
    'real estate operations recruiter hiring',
    'HOA manager recruiter hiring',
    'asset manager real estate recruiter hiring',
    'real estate analyst recruiter hiring',
    'property administrator recruiter hiring',
    'leasing admin recruiter opportunity',
    'maintenance technician property recruiter hiring',
    'real estate VA recruiter opportunity',
    'property management virtual assistant hiring',
  ],
}

export async function runApifyScraperForSector(
  sector: Sector,
  queryOffset = 0,
  opts: { maxPosts?: number; recentOnly?: boolean } = {}
): Promise<ApifyPost[]> {
  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) throw new Error('APIFY_API_TOKEN not set')

  const maxPosts = Math.min(Math.max(opts.maxPosts ?? 10, 1), 25)
  // recentOnly (the cron default): sort by date, only posts from the last week —
  // avoids re-fetching LinkedIn's sticky "top match" posts on every run.
  // Deep/loading runs use relevance ranking with no date filter to mine the backlog.
  const recentOnly = opts.recentOnly ?? true

  const queries = SECTOR_QUERIES[sector]
  const batch = [...queries, ...queries].slice(queryOffset % queries.length, (queryOffset % queries.length) + 3)
  const allPosts: ApifyPost[] = []

  for (const query of batch) {
    try {
      console.log(`[apify] [${sector}] "${query}" (${recentOnly ? 'recent' : 'deep'}, max ${maxPosts})`)

      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [query],
            maxPosts,
            // 'month' (not 'week'): each query is only revisited every ~9-12 days
            // in the rotation, so a 7-day window would leave blind gaps between visits
            ...(recentOnly ? { sortBy: 'date', postedLimit: 'month' } : { sortBy: 'relevance' }),
            scrapeComments: false,
            scrapeReactions: false,
          }),
        }
      )

      if (!startRes.ok) {
        console.error(`[apify] Start failed: ${startRes.status}`)
        continue
      }

      const runData = await startRes.json()
      const runId = runData.data?.id
      const datasetId = runData.data?.defaultDatasetId
      if (!runId || !datasetId) continue

      console.log(`[apify] Run ${runId} started...`)

      let status = ''
      for (let i = 0; i < 38; i++) {
        await new Promise((r) => setTimeout(r, 8000))
        const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`)
        const statusData = await statusRes.json()
        status = statusData.data?.status
        console.log(`[apify] ${runId}: ${status}`)
        if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break
      }

      if (status !== 'SUCCEEDED') continue

      const resultsRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=${maxPosts}`
      )
      const items: ApifyPost[] = await resultsRes.json()
      console.log(`[apify] "${query}" → ${items.length} posts`)
      allPosts.push(...items.map(p => ({ ...p, _query: query })))

    } catch (err) {
      console.error(`[apify] Error on "${query}":`, err)
    }
  }

  return allPosts
}

export function normalisePost(raw: ApifyPost): {
  postUrl: string
  text: string
  authorName: string | null
  authorHeadline: string | null
  authorLinkedinUrl: string | null
  postedAt: string | null
} {
  const src: ApifyPost = raw.repost || raw
  const rawText = src.content || src.commentary || src.text || ''
  const text = rawText.length > 50 ? rawText : (raw.content || raw.commentary || raw.text || rawText)

  const jobCard = src.job || raw.job
  const jobCardText = jobCard
    ? `\n\nJob card details: Title: ${jobCard.title || ''} | Location: ${jobCard.location || ''} | Company: ${jobCard.subtitle?.replace('Job by ', '') || ''} | Apply: ${jobCard.linkedinUrl || ''}`
    : ''
  const finalText = text + jobCardText

  const postedAtField = src.postedAt
  const postedAt = postedAtField
    ? typeof postedAtField === 'object'
      ? (postedAtField as { date?: string }).date || null
      : postedAtField
    : null

  return {
    postUrl: raw.linkedinUrl || raw.url || raw.postUrl || '',
    text: finalText,
    authorName: src.author?.name || src.authorName || null,
    authorHeadline: src.author?.info || src.author?.headline || src.authorHeadline || null,
    authorLinkedinUrl: src.author?.linkedinUrl || src.author?.url || src.authorProfileUrl || null,
    postedAt,
  }
}
