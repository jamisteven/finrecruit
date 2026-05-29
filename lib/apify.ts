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

  // Run 3 queries per ingest call to stay within Vercel timeout
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
            searchQueries: [query],
            maxPosts: 20,
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

      console.log(`[apify] Run ${runId} started, polling...`)

      // Poll every 8s up to 5 minutes
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

export function normalisePost(raw: ApifyPost & { repost?: ApifyPost }): {
  postUrl: string
  text: string
  authorName: string | null
  authorHeadline: string | null
  authorLinkedinUrl: string | null
  postedAt: string | null
} {
  // For reposts, use the original post's content + author (that's where the job info is)
  const src = raw.repost || raw
  const text = src.commentary || src.text || src.content || ''
  // Fall back to outer post text if repost text is very short (just a comment like "Sharing this!")
  const finalText = text.length > 50 ? text : (raw.commentary || raw.text || raw.content || text)

  return {
    postUrl: raw.url || raw.postUrl || '',
    text: finalText,
    authorName: (src.author as { name?: string })?.name || src.authorFullName || src.authorName || null,
    authorHeadline: (src.author as { headline?: string })?.headline || src.authorHeadline || null,
    authorLinkedinUrl: (src.author as { url?: string; profileUrl?: string })?.url || (src.author as { profileUrl?: string })?.profileUrl || src.authorProfileUrl || null,
    postedAt: (src as ApifyPost).postedAt || raw.publishedAt || raw.createdAt || raw.timestamp || null,
  }
}
