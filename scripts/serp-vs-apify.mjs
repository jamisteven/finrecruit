// Quick test: how does a Google search for LinkedIn posts compare with what Apify gave us for the same search?
//
//   SERPER_API_KEY=xxx node scripts/serp-vs-apify.mjs "hiring embedded san francisco" [apify-urls.txt]
//
// - Runs a Google search (via Serper.dev, free tier) restricted to linkedin.com/posts and the last week and month.
// - LinkedIn post URLs carry their creation time inside the id (id >> 22 = milliseconds since 1970), so no page fetch is needed
//   to see how old each result is.
// - If you pass a file of Apify post URLs (one per line), it also reports how many Google results Apify already had and the other way round.
//
// Get Apify's URLs for the same search from Supabase:
//   select distinct post_url from classifier_log where query ilike 'hiring embedded san francisco' and created_at > now() - interval '14 days';
//   (export as CSV, one URL per line, no header)

import { readFileSync } from 'node:fs'

const [, , query, apifyFile] = process.argv
const key = process.env.SERPER_API_KEY
if (!query || !key) { console.error('usage: SERPER_API_KEY=... node scripts/serp-vs-apify.mjs "<apify query>" [apify-urls.txt]'); process.exit(1) }

const idOf = (url) => (url.match(/(?:activity|ugcPost|share)[-:](\d{15,20})/) || [])[1]
const tsOf = (url) => { const id = idOf(url); return id ? Number(BigInt(id) >> 22n) : null }
const postKey = (url) => idOf(url) || url.split('?')[0]

// Serper's free plan refuses some query patterns ("Query pattern not allowed for free accounts"). Try the plainest
// versions in turn and remember the first one that works, so the run says what the free plan will and won't do.
let working = null
async function serp(variants, tbs, pages = 3) {
  const attempts = working ? [working] : variants.flatMap((q) => [{ q, num: 100 }, { q, num: undefined }])
  for (const a of attempts) {
    const out = []
    let refused = false
    for (let page = 1; page <= pages; page++) {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: a.q, num: a.num, page, tbs, gl: 'us' }),
      })
      if (!res.ok) { const t = await res.text(); if (res.status === 400 && /pattern/i.test(t)) { refused = true; break } console.error('serper', res.status, t); return { rows: out, q: a.q } }
      const items = (await res.json()).organic ?? []
      out.push(...items)
      if (items.length < 10) break
    }
    if (!refused) { working = a; return { rows: out, q: a.q } }
    console.log(`  refused by the free plan: ${a.q}${a.num ? ' (num=' + a.num + ')' : ' (no num)'}`)
  }
  return { rows: [], q: null }
}

const terms = query.replace(/^hiring\s+/i, '')
const variants = [`site:linkedin.com/posts hiring ${terms}`, `linkedin.com/posts hiring ${terms}`, `linkedin post hiring ${terms}`]
const apify = apifyFile ? new Set(readFileSync(apifyFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).map(postKey)) : null

for (const [label, tbs] of [['past week', 'qdr:w'], ['past month', 'qdr:m']]) {
  const { rows, q } = await serp(variants, tbs)
  const posts = rows.filter((r) => /linkedin\.com\/posts\//.test(r.link))
  const ages = posts.map((r) => tsOf(r.link)).filter(Boolean).map((t) => (Date.now() - t) / 86400000)
  const hiringish = posts.filter((r) => /hiring|apply|opening|looking for|join/i.test(`${r.title} ${r.snippet}`)).length
  const avgSnip = posts.length ? Math.round(posts.reduce((s, r) => s + (r.snippet || '').length, 0) / posts.length) : 0
  console.log(`\n== ${label}: "${q}"`)
  console.log(`results ${rows.length}, linkedin posts ${posts.length}, hiring-looking ${hiringish}, avg snippet ${avgSnip} chars (a full post is ~800+)`)
  if (ages.length) console.log(`age in days: median ${ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)].toFixed(1)}, newest ${ages[0].toFixed(1)}, oldest ${ages[ages.length - 1].toFixed(1)}`)
  if (apify) {
    const mine = new Set(posts.map((r) => postKey(r.link)))
    const both = [...mine].filter((k) => apify.has(k)).length
    console.log(`overlap with Apify's ${apify.size}: ${both} of Google's ${mine.size} posts were already in Apify's set; ${apify.size - both} Apify posts Google did not return`)
  }
  for (const r of posts.slice(0, 5)) console.log(`  - ${r.title}\n    ${r.link}`)
}
