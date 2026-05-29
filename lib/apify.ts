// Apify LinkedIn Post Search Scraper
// Actor: harvestapi/linkedin-post-search

export type ApifyPost = {
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

// Queries rotated across cron runs to stay within Vercel's 5min timeout
// Each ingest run picks 3 queries, cycling through the full list over time
export const FINANCE_JOB_QUERIES = [
  'finance recruiter hiring london',
  'investment banking hiring analyst',
  'hedge fund recruiting role',
  'private equity hiring associate',
  'asset management role opportunity',
  'quant researcher hiring',
  'financial services recruiter mandate',
  'now recruiting finance new york',
  'fixed income credit hiring',
]

export async function runApifyScraper(queries: string[]): Promise<ApifyPost[]> {
  const apiToken = process.env.APIFY_API_TOKEN
  if (!apiToken) throw new Error('APIFY_API_TOKEN not set')

  const allPosts: ApifyPost[] = []

  // Only run 3 queries per call to stay within Vercel's 5min timeout
  const batch = queries.slice(0, 3)

  for (const query of batch) {
    try {
      console.log(`[apify] Starting run for: "${query}"`)

      const startRes = await fetch(
        `https://api.apify.com/v2/acts/harvestapi~linkedin-post-search/runs?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            count: 20,
            datePosted: 'past-week',
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

      console.log(`[apify] Run ${runId} started, polling...`)

      // Poll every 8s, up to 75 attempts (~10 min max per query)
      let status = ''
      for (let i = 0; i < 38; i++) {
        await new Promise((r) => setTimeout(r, 8000))
        const statusRes = await fetch(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`
        )
        const statusData = await statusRes.json()
        status = statusData.data?.status
        console.log(`[apify] ${runId}: ${status}`)
        if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break
      }

      if (status !== 'SUCCEEDED') {
        console.error(`[apify] Run ${runId} ended with: ${status}`)
        continue
      }

      const resultsRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=20`
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
  return {
    postUrl: raw.url || raw.postUrl || '',
    text: raw.commentary || raw.text || raw.content || '',
    authorName: raw.author?.name || raw.authorFullName || raw.authorName || null,
    authorHeadline: raw.author?.headline || raw.authorHeadline || null,
    authorLinkedinUrl: raw.author?.url || raw.author?.profileUrl || raw.authorProfileUrl || null,
    postedAt: raw.date || raw.postedAt || raw.publishedAt || raw.createdAt || raw.timestamp || null,
  }
}
