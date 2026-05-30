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
    // High-signal universal phrases (from corpus analysis)
    'now hiring finance',
    'hiring senior finance',
    'interested candidates finance',
    'reach out directly finance',
    // Sector-specific high-frequency terms
    'investment banking analyst hiring',
    'hedge fund hiring',
    'private equity hiring',
    'fixed income hiring',
    'financial services hiring',
    'asset management hiring',
    'CFO finance director hiring',
    'equity research hiring',
    'quant researcher hiring',
    'fintech hiring',
    'private credit hiring',
  ],
  tech: [
    // High-signal universal phrases
    'now hiring engineer',
    'hiring senior engineer',
    'interested candidates tech',
    'reach out directly engineering',
    // Sector-specific
    'software engineer hiring',
    'full stack engineer hiring',
    'backend engineer hiring',
    'AI ML engineer hiring',
    'data engineer hiring',
    'data scientist hiring',
    'product manager hiring',
    'engineering manager hiring',
    'CTO VP engineering hiring',
    'devops platform engineer hiring',
    'startup hiring engineer',
  ],
  legal: [
    // High-signal universal phrases
    'now hiring legal',
    'hiring senior lawyer',
    'interested candidates legal',
    'reach out directly legal',
    // Sector-specific
    'law firm hiring',
    'associate solicitor hiring',
    'in-house counsel hiring',
    'compliance hiring',
    'corporate lawyer hiring',
    'litigation associate hiring',
    'general counsel hiring',
    'employment lawyer hiring',
    'legal counsel hiring',
    'paralegal hiring',
    'M&A lawyer hiring',
  ],
  marketing: [
    // High-signal universal phrases
    'now hiring marketing',
    'hiring director marketing',
    'interested candidates marketing',
    'reach out directly marketing',
    // Sector-specific
    'digital marketing hiring',
    'growth marketing hiring',
    'performance marketing hiring',
    'head of marketing hiring',
    'product marketing hiring',
    'social media marketing hiring',
    'brand marketing hiring',
    'CMO VP marketing hiring',
    'creative director hiring',
    'demand generation hiring',
    'content marketing hiring',
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
