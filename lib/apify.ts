// Apify LinkedIn Post Search Scraper
// Actor: harvestapi/linkedin-post-search
// Docs: https://apify.com/harvestapi/linkedin-post-search

export type ApifyPost = {
  // HarvestAPI linkedin-post-search fields
  id?: string
  url?: string
  postUrl?: string
  text?: string
  content?: string
  commentary?: string
  authorName?: string
  authorFullName?: string
  author?: { name?: string; headline?: string; url?: string; profileUrl?: string }
  authorHeadline?: string
  authorProfileUrl?: string
  postedAt?: string
  publishedAt?: string
  createdAt?: string
  timestamp?: string
  date?: string
}

// Search queries that target finance recruiters posting jobs
export const FINANCE_JOB_QUERIES = [
  'finance recruiter hiring',
  'investment banking hiring analyst associate',
  'hedge fund role recruiting',
  'private equity hiring associate',
  'asset management role opportunity',
  'quant researcher trader hiring',
  'financial services recruiter mandate',
  'now recruiting finance london',
  'now recruiting finance new york',
]

export async function runApifyScraper(queries: string[]): Promise<ApifyPost[]> {
  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) throw new Error('APIFY_API_TOKEN not set')

  const allPosts: ApifyPost[] = []

  for (const query of queries) {
    try {
      console.log(`[apify] Scraping query: "${query}"`)

      // Start the actor run
      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: query,
            count: 25,
            datePosted: 'past-week',
          }),
        }
      )

      if (!startRes.ok) {
        const errText = await startRes.text()
        console.error(`[apify] Start failed for "${query}": ${startRes.status} ${errText}`)
        continue
      }

      const runData = await startRes.json()
      const runId = runData.data?.id
      if (!runId) {
        console.error(`[apify] No runId returned for "${query}"`)
        continue
      }

      console.log(`[apify] Run started: ${runId}`)

      // Poll until finished (max 3 minutes, every 5s)
      let status = ''
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const statusRes = await fetch(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`
        )
        const statusData = await statusRes.json()
        status = statusData.data?.status
        console.log(`[apify] Run ${runId} status: ${status}`)
        if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED') break
      }

      if (status !== 'SUCCEEDED') {
        console.error(`[apify] Run ${runId} did not succeed: ${status}`)
        continue
      }

      // Fetch results from dataset
      const datasetId = runData.data?.defaultDatasetId
      if (!datasetId) continue

      const resultsRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=50`
      )
      const items: ApifyPost[] = await resultsRes.json()
      console.log(`[apify] Got ${items.length} posts for "${query}"`)
      allPosts.push(...items)
    } catch (err) {
      console.error(`[apify] Error scraping "${query}":`, err)
    }
  }

  return allPosts
}

// Normalise HarvestAPI post shape into our standard format
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
    text: raw.commentary || raw.text || raw.content || '',
    authorName: raw.author?.name || raw.authorFullName || raw.authorName || null,
    authorHeadline: raw.author?.headline || raw.authorHeadline || null,
    authorLinkedinUrl: raw.author?.url || raw.author?.profileUrl || raw.authorProfileUrl || null,
    postedAt: raw.date || raw.postedAt || raw.publishedAt || raw.createdAt || raw.timestamp || null,
  }
}
