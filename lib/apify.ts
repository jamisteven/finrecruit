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
    subtitle?: string  // e.g. "Job by LHH"
  }
}

export type Sector = 'finance' | 'tech' | 'legal' | 'marketing'

export const SECTOR_QUERIES: Record<Sector, string[]> = {
  finance: [
    'finance recruiter now hiring',
    'investment banking analyst associate hiring',
    'hedge fund role recruiter',
    'private equity hiring opportunity',
    'asset management recruiter mandate',
    'quant researcher trader hiring',
    'fixed income credit recruiter hiring',
    'financial services recruiter opportunity',
    'private credit direct lending hiring',
    'wealth management recruiter hiring',
    'corporate finance FP&A hiring recruiter',
    'CFO finance director hiring recruiter',
    'fintech finance role recruiter hiring',
    'equity research analyst hiring recruiter',
    'risk management recruiter hiring',
    // 25 additional high-quality queries
    'portfolio manager recruiter hiring',
    'investment analyst recruiter opportunity',
    'M&A analyst associate recruiter hiring',
    'leveraged finance recruiter hiring',
    'structured products recruiter hiring',
    'treasury recruiter hiring opportunity',
    'credit risk analyst recruiter hiring',
    'fund accounting recruiter hiring',
    'compliance officer finance recruiter hiring',
    'prime brokerage recruiter hiring',
    'macro analyst recruiter hiring',
    'distressed debt recruiter hiring',
    'venture capital recruiter hiring',
    'family office recruiter hiring',
    'capital markets recruiter hiring',
    'derivatives trader recruiter hiring',
    'insurance actuary recruiter hiring',
    'real estate finance recruiter hiring',
    'infrastructure finance recruiter hiring',
    'sovereign wealth recruiter hiring',
    'pension fund recruiter hiring',
    'CLO CDO structured credit recruiter hiring',
    'bank capital markets recruiter hiring',
    'securities lawyer finance recruiter hiring',
    'financial controller CFO recruiter hiring',
    // Toronto specific
    'finance recruiter hiring Toronto',
    'investment banking Toronto recruiter hiring',
    'private equity Toronto recruiter hiring',
  ],
  tech: [
    'software engineer recruiter now hiring',
    'engineering manager recruiter hiring',
    'AI ML engineer recruiter opportunity',
    'backend engineer recruiter hiring',
    'frontend engineer recruiter hiring',
    'product manager recruiter hiring',
    'devops platform engineer recruiter hiring',
    'data engineer recruiter hiring',
    'data scientist recruiter hiring',
    'CTO VP engineering recruiter hiring',
    'mobile engineer recruiter hiring',
    'security engineer recruiter hiring',
    'full stack engineer recruiter now hiring',
    'startup engineer recruiter hiring',
    'tech lead recruiter hiring opportunity',
    // 25 additional high-quality queries
    'site reliability engineer recruiter hiring',
    'cloud architect recruiter hiring',
    'machine learning engineer recruiter hiring',
    'AI engineer LLM recruiter hiring',
    'blockchain engineer recruiter hiring',
    'iOS Android engineer recruiter hiring',
    'embedded systems engineer recruiter hiring',
    'principal staff engineer recruiter hiring',
    'VP engineering recruiter hiring',
    'head of engineering recruiter hiring',
    'platform engineer kubernetes recruiter hiring',
    'cybersecurity engineer recruiter hiring',
    'data platform engineer recruiter hiring',
    'growth engineer recruiter hiring',
    'infrastructure engineer recruiter hiring',
    'API engineer recruiter hiring',
    'solutions architect recruiter hiring',
    'technical program manager recruiter hiring',
    'quantum computing engineer recruiter hiring',
    'robotics engineer recruiter hiring',
    'compiler engineer recruiter hiring',
    'semiconductor engineer recruiter hiring',
    'fintech engineer recruiter hiring',
    'founding engineer startup recruiter hiring',
    'developer advocate recruiter hiring',
    // Toronto specific
    'software engineer recruiter hiring Toronto',
    'tech recruiter hiring Toronto',
    'startup engineer Toronto recruiter hiring',
  ],
  legal: [
    'legal recruiter now hiring lawyer',
    'associate solicitor recruiter hiring',
    'in-house counsel recruiter opportunity',
    'compliance recruiter hiring role',
    'corporate lawyer recruiter hiring',
    'litigation associate recruiter hiring',
    'legal counsel recruiter mandate',
    'paralegal recruiter hiring',
    'employment lawyer recruiter hiring',
    'commercial solicitor recruiter hiring',
    'general counsel recruiter hiring',
    'legal operations recruiter hiring',
    'IP lawyer recruiter hiring opportunity',
    'M&A lawyer recruiter hiring',
    'regulatory counsel recruiter hiring',
    // 25 additional high-quality queries
    'private equity lawyer recruiter hiring',
    'funds lawyer recruiter hiring',
    'banking finance lawyer recruiter hiring',
    'tax lawyer recruiter hiring',
    'real estate lawyer recruiter hiring',
    'disputes arbitration lawyer recruiter hiring',
    'restructuring lawyer recruiter hiring',
    'data privacy lawyer recruiter hiring',
    'antitrust competition lawyer recruiter hiring',
    'capital markets lawyer recruiter hiring',
    'insurance lawyer recruiter hiring',
    'healthcare lawyer recruiter hiring',
    'technology lawyer recruiter hiring',
    'international arbitration recruiter hiring',
    'senior associate partner law firm recruiter',
    'GC deputy GC recruiter hiring',
    'securities lawyer recruiter hiring',
    'fintech regulatory lawyer recruiter hiring',
    'legal director recruiter hiring',
    'barrister chambers recruiter hiring',
    'planning environment lawyer recruiter hiring',
    'construction lawyer recruiter hiring',
    'shipping maritime lawyer recruiter hiring',
    'sports entertainment lawyer recruiter hiring',
    'immigration lawyer recruiter hiring',
    // Toronto specific
    'legal recruiter hiring Toronto',
    'lawyer Toronto recruiter hiring',
    'in-house counsel Toronto recruiter hiring',
  ],
  marketing: [
    'marketing recruiter now hiring',
    'growth marketing recruiter hiring',
    'performance marketing recruiter hiring',
    'CMO VP marketing recruiter hiring',
    'content marketing recruiter hiring',
    'brand marketing recruiter hiring',
    'digital marketing recruiter hiring',
    'head of marketing recruiter hiring',
    'product marketing recruiter hiring',
    'SEO SEM recruiter hiring',
    'social media marketing recruiter hiring',
    'demand generation recruiter hiring',
    'marketing director recruiter hiring',
    'email marketing recruiter hiring',
    'creative director recruiter hiring',
    // 25 additional high-quality queries
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
    'UX content writer recruiter hiring',
    'creative strategy recruiter hiring',
    'podcast video content recruiter hiring',
    'retail marketing recruiter hiring',
    'partnership marketing recruiter hiring',
    // Toronto specific
    'marketing recruiter hiring Toronto',
    'growth marketing Toronto recruiter hiring',
    'head of marketing Toronto recruiter hiring',
  ],
}

export async function runApifyScraperForSector(sector: Sector, queryOffset = 0): Promise<ApifyPost[]> {
  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) throw new Error('APIFY_API_TOKEN not set')

  const queries = SECTOR_QUERIES[sector]
  const batch = [...queries, ...queries].slice(queryOffset % queries.length, (queryOffset % queries.length) + 3)
  const allPosts: ApifyPost[] = []

  for (const query of batch) {
    try {
      console.log(`[apify] [${sector}] "${query}"`)

      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [query],
            maxPosts: 10,
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
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=10`
      )
      const items: ApifyPost[] = await resultsRes.json()
      console.log(`[apify] "${query}" → ${items.length} posts`)
      allPosts.push(...items)

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

  // If post has an embedded LinkedIn job card, append its details to the text
  // so the classifier can extract title, location, company etc.
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
