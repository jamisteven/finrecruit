import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const KEY = process.env.ANTHROPIC_API_KEY
const SECTORS = ['finance', 'tech', 'legal', 'marketing', 'realestate']

async function classify(text, headline) {
  const prompt = `Classify this job post into one sector, judged by the ROLE's function, not the employer's industry.
- A software engineer at a bank is "tech". An accountant at a tech startup is "finance".
- A nurse, hostess, store assistant, driver, teacher or factory worker is "other".
- Use "other" whenever the role does not clearly fit finance, tech, legal, marketing, or realestate.

Author headline: ${headline || 'Unknown'}

Post:
---
${(text || '').slice(0, 1800)}
---

Reply with ONLY one word: finance, tech, legal, marketing, realestate, or other`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 10, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) return null
  const d = await res.json()
  const out = (d.content?.[0]?.text || '').toLowerCase().trim()
  return [...SECTORS, 'other'].includes(out) ? out : null
}

let cursor = null, done = 0, changed = 0
for (;;) {
  let q = db.from('jobs')
    .select('id, sector, raw_text, author_headline, title, extracted_at')
    .gte('posted_at', new Date(Date.now() - 30 * 86400_000).toISOString())
    .order('extracted_at', { ascending: false })
    .limit(25)
  if (cursor) q = q.lt('extracted_at', cursor)

  const { data, error } = await q
  if (error) { console.error(error.message); break }
  if (!data?.length) break
  cursor = data[data.length - 1].extracted_at

  const results = await Promise.all(data.map(async (j) => ({ j, s: await classify(j.raw_text, j.author_headline) })))
  for (const { j, s } of results) {
    done++
    if (s && s !== j.sector) {
      await db.from('jobs').update({ sector: s }).eq('id', j.id)
      changed++
      console.log(`${j.sector} -> ${s}  ${String(j.title).slice(0, 60)}`)
    }
  }
  console.log(`--- ${done} done, ${changed} changed`)
}
console.log(`finished: ${done} classified, ${changed} changed`)
