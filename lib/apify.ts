// Apify LinkedIn Posts Scraper
// Actor: apify/linkedin-posts-scraper (or voyager-based actor)
// Docs: https://apify.com/apify/linkedin-posts-scraper

export type ApifyPost = {
  id?: string
  url?: string
  postUrl?: string
  text?: string
  content?: string
  authorName?: string
  authorHeadline?: string
  authorProfileUrl?: string
  postedAt?: string
  publishedAt?: string
  timestamp?: string
}

// Search queries that target finance recruiters posting jobs
export const FINANCE_JOB_QUERIES = [
  'finance hiring recruiter',
  'investment banking analyst associate hiring',
  'hedge fund role opportunity',
  'private equity analyst associate hiring',
  'asset management portfolio hiring',
  'quant trader researcher hiring',
  'financial services recruiting opportunity',
  'now hiring finance london new york',
  'looking for candidates finance mandate',
]

export async function runApifyScraper(queries: string[]): Promise<ApifyPost[]> {
  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) throw new Error('APIFY_API_TOKEN not set')

  const allPosts: ApifyPost[] = []

  for (const query of queries) {
    try {
      // Start the actor run
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/apify~linkedin-posts-scraper/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQueries: [query],
            maxResults: 25,
            // Only posts from last 7 days
            dateRange: 'PAST_WEEK',
          }),
        }
      )

      if (!startRes.ok) {
        console.error(`Apify start failed for query "${query}": ${startRes.status}`)
        continue
      }

      const runData = await startRes.json()
      const runId = runData.data?.id
      if (!runId) continue

      // Poll until finished (max 2 minutes)
      let finished = false
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const statusRes = await fetch(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`
        )
        const statusData = await statusRes.json()
        const status = statusData.data?.status
        if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED') {
          finished = true
          break
        }
      }

      if (!finished) continue

      // Fetch results from dataset
      const datasetId = runData.data?.defaultDatasetId
      if (!datasetId) continue

      const resultsRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=50`
      )
      const items: ApifyPost[] = await resultsRes.json()
      allPosts.push(...items)
    } catch (err) {
      console.error(`Error scraping query "${query}":`, err)
    }
  }

  return allPosts
}

// Normalise Apify post shape (field names vary by actor version)
export function normalisePost(raw: ApifyPost): {
  postUrl: string
  text: string
  authorName: string | null
  authorHeadline: string | null
  authorLinkedinUrl: string | null
  postedAt: string | null
} {
  return {
    postUrl: raw.url || raw.postUrl || '',
    text: raw.text || raw.content || '',
    authorName: raw.authorName || null,
    authorHeadline: raw.authorHeadline || null,
    authorLinkedinUrl: raw.authorProfileUrl || null,
    postedAt: raw.postedAt || raw.publishedAt || raw.timestamp || null,
  }
}
