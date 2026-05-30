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

  const postedAtField = src.postedAt
  const postedAt = postedAtField
    ? typeof postedAtField === 'object'
      ? (postedAtField as { date?: string }).date || null
      : postedAtField
    : null

  return {
    postUrl: raw.linkedinUrl || raw.url || raw.postUrl || '',
    text,
    authorName: src.author?.name || src.authorName || null,
    authorHeadline: src.author?.info || src.author?.headline || src.authorHeadline || null,
    authorLinkedinUrl: src.author?.linkedinUrl || src.author?.url || src.authorProfileUrl || null,
    postedAt,
  }
}
