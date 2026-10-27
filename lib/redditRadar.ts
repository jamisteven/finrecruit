// Reddit radar: find Reddit threads where people are stuck in a job search, so the owner can reply by hand.
// Search = Google (via Serper) restricted to reddit.com threads; scoring = one Claude call per batch of threads.
// Nothing here posts to Reddit.

export type RadarPost = {
  id: string            // reddit post id
  url: string
  subreddit: string
  title: string
  snippet: string
  dateText: string | null   // what Google shows ("3 days ago", "Sep 4, 2025")
  ageDays: number | null
  position: number          // best Google position across the queries that found it (1 = top)
  queries: number           // how many of the queries surfaced it
}

export type Scored = { id: string; kind: string; score: number }

export const DEFAULT_QUERIES = [
  'inurl:comments intitle:"job market" "anyone else" OR "what is going on" OR "is it just me"',
  'inurl:comments "job market" "so bad" OR "brutal" OR "impossible"',
  'inurl:comments "applications" "no interviews" OR "can\'t get an interview" OR "no callbacks"',
  'inurl:comments intitle:"applications" "not hearing back" OR "ghosted"',
  'inurl:comments "sent" "applications" "zero" OR "nothing" "interviews"',
  'inurl:comments intitle:"where do you" OR "how do you" "find jobs" OR "job hunt"',
  'inurl:comments "what are you using" "job search" OR "find jobs"',
  'inurl:comments "best way to find" jobs "besides linkedin" OR "other than linkedin" OR "beyond linkedin"',
  'inurl:comments "unemployed" OR "laid off" "months" "no luck" "job search"',
  'inurl:comments intitle:"job search" "what am i doing wrong"',
  'inurl:comments "applying" "for months" "nothing" "advice"',
  'inurl:comments "linkedin" "ghost jobs" OR "fake jobs" "applying"',
]

const PERIODS: Record<string, string> = { d: 'qdr:d', w: 'qdr:w', m: 'qdr:m', y: 'qdr:y' }

const REDDIT_THREAD = /^https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)/i

/** "3 days ago" / "Sep 4, 2025" -> age in days, or null when Google gave nothing usable. */
export function ageFromGoogle(text: string | null | undefined): number | null {
  if (!text) return null
  const rel = text.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i)
  if (rel) {
    const n = Number(rel[1])
    const unit = rel[2].toLowerCase()
    const perUnit = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[unit] ?? 1
    return Math.round(n * perUnit * 10) / 10
  }
  const t = Date.parse(text)
  return Number.isFinite(t) ? Math.max(0, Math.round(((Date.now() - t) / 86_400_000) * 10) / 10) : null
}

type SerperOrganic = { title?: string; link?: string; snippet?: string; date?: string; position?: number }

async function serper(q: string, tbs: string | null, key: string): Promise<{ organic: SerperOrganic[]; error?: string }> {
  const call = async (withTbs: boolean) => fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'us', hl: 'en', ...(withTbs && tbs ? { tbs } : {}) }),
  })
  let res = await call(true)
  // the free Serper plan refuses some parameters; retry bare and let the age filter below do the work
  if (res.status === 400 && tbs) res = await call(false)
  if (!res.ok) return { organic: [], error: `Serper ${res.status}: ${(await res.text()).slice(0, 160)}` }
  const j = await res.json()
  return { organic: (j.organic ?? []) as SerperOrganic[] }
}

/** Run every query (each prefixed with site:reddit.com), keep Reddit threads only, merge duplicates. */
export async function searchReddit(queries: string[], period: string): Promise<{ posts: RadarPost[]; errors: string[]; credits: number }> {
  const key = process.env.SERPER_API_KEY
  if (!key) throw new Error('SERPER_API_KEY is not set (add it in Vercel and .env.local)')
  const tbs = PERIODS[period] ?? null
  const clean = queries.map((q) => q.trim()).filter(Boolean).slice(0, 20)
  const results = await Promise.all(clean.map((q) => serper(/\bsite:/i.test(q) ? q : `site:reddit.com ${q}`, tbs, key)))

  const byId = new Map<string, RadarPost>()
  const errors: string[] = []
  results.forEach((r, i) => {
    if (r.error) errors.push(`"${clean[i].slice(0, 50)}": ${r.error}`)
    r.organic.forEach((o, idx) => {
      const m = (o.link ?? '').match(REDDIT_THREAD)
      if (!m) return
      const id = m[2].toLowerCase()
      const position = o.position ?? idx + 1
      const prev = byId.get(id)
      if (prev) { prev.queries++; prev.position = Math.min(prev.position, position); return }
      byId.set(id, {
        id, url: `https://www.reddit.com/r/${m[1]}/comments/${m[2]}/`, subreddit: m[1],
        title: (o.title ?? '').replace(/\s*:\s*r\/\w+\s*$/i, '').replace(/\s*-\s*Reddit\s*$/i, '').trim(),
        snippet: (o.snippet ?? '').trim(), dateText: o.date ?? null, ageDays: ageFromGoogle(o.date), position, queries: 1,
      })
    })
  })
  return { posts: [...byId.values()], errors, credits: clean.length }
}

const SCORE_PROMPT = `You help the founder of backchannel.jobs find Reddit threads worth replying to.

backchannel.jobs shows jobs that recruiters and hiring managers post on LinkedIn (often in finance, tech, marketing and other professional roles, mostly US/UK/EU) before they reach LinkedIn Jobs, so jobseekers can contact the poster directly. It is a paid product.

For each Reddit thread below (title plus a Google snippet only), judge whether the AUTHOR is someone a helpful reply about finding jobs would genuinely serve right now.

Score 0-100, where:
- 80-100: a person actively job hunting who is asking how or where to find jobs, or describes a long search with many applications and no interviews, in a professional role, in a market we cover.
- 50-79: clearly job hunting and frustrated, but not asking for a way to search, or the role or market is unclear.
- 20-49: general market commentary, venting, career advice about something else (resumes, interviews, salary) where a search tip is a stretch.
- 0-19: not a fit. Employers or recruiters posting, someone announcing an offer, memes, politics, student questions about majors, posts about India or other markets we do not cover, trades or gig work, or anything where a reply would look like an ad.

Kind, pick one: "asking-where-to-look", "stuck-applying", "market-vent", "career-advice", "not-a-fit".

Reply ONLY with a JSON array, no markdown, one object per thread in the same order: [{"id":"abc123","kind":"stuck-applying","score":72}]`

/** One Claude call for up to ~15 threads. A thread the model skips is returned with score 0. */
export async function scorePosts(posts: Pick<RadarPost, 'id' | 'subreddit' | 'title' | 'snippet'>[]): Promise<Scored[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  if (!posts.length) return []
  const list = posts.map((p) => `id: ${p.id}\nsubreddit: r/${p.subreddit}\ntitle: ${p.title.slice(0, 200)}\nsnippet: ${p.snippet.slice(0, 400)}`).join('\n---\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CLASSIFIER_MODEL || 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: `${SCORE_PROMPT}\n\nThreads:\n---\n${list}\n---` }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}`)
  const data = await res.json()
  const text: string = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '[]'
  let arr: unknown
  try { arr = JSON.parse(text.replace(/```json|```/g, '').trim()) } catch { arr = [] }
  const byId = new Map<string, Scored>()
  for (const o of Array.isArray(arr) ? arr : []) {
    const r = o as { id?: unknown; kind?: unknown; score?: unknown }
    if (typeof r.id !== 'string') continue
    byId.set(r.id.toLowerCase(), {
      id: r.id.toLowerCase(), kind: typeof r.kind === 'string' ? r.kind : 'not-a-fit',
      score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
    })
  }
  return posts.map((p) => byId.get(p.id) ?? { id: p.id, kind: 'not-a-fit', score: 0 })
}
