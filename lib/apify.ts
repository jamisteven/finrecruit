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
  // Rotate queries based on hour of day so each run covers different queries
  const hour = new Date().getUTCHours()
  const offset = (hour * 3) % queries.length
  const batch = [...queries, ...queries].slice(offset, offset + 3)

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

      console.log(`[apify] Run ${runId} started, polling...`)

      let status = ''
      for (let i = 0; i < 38; i++) {
        await new Promise((r) => setTimeout(r, 8000))
        const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`)
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
  // For reposts, use the original post content (where the actual job info lives)
  const src: ApifyPost = raw.repost || raw
  const rawText = src.content || src.commentary || src.text || ''
  // If repost caption is too short, use it; otherwise fall back to outer post
  const text = rawText.length > 50 ? rawText : (raw.content || raw.commentary || raw.text || rawText)

  // postedAt from HarvestAPI is an object: { date: "...", timestamp: ... }
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
    // HarvestAPI puts headline in author.info
    authorHeadline: src.author?.info || src.author?.headline || src.authorHeadline || null,
    authorLinkedinUrl: src.author?.linkedinUrl || src.author?.url || src.authorProfileUrl || null,
    postedAt,
  }
}
