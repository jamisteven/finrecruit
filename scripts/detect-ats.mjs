#!/usr/bin/env node
// ATS Auto-Detector for Swiss Companies
// Run from ~/finrecruit: node scripts/detect-ats.mjs
//
// Usage:
//   node scripts/detect-ats.mjs                    # uses built-in Swiss company seed list
//   node scripts/detect-ats.mjs companies.txt       # reads URLs from a text file (one per line)

import { createClient } from '@supabase/supabase-js'
import https from 'https'
import http from 'http'

// ── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error('Run: export NEXT_PUBLIC_SUPABASE_URL=... && export SUPABASE_SERVICE_ROLE_KEY=...')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── ATS fingerprints ───────────────────────────────────────────────────────
const ATS_PATTERNS = [
  {
    name: 'greenhouse',
    patterns: [/boards\.greenhouse\.io\/([a-z0-9_-]+)/i, /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i],
    apiTemplate: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  },
  {
    name: 'ashby',
    patterns: [/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i, /ashbyhq\.com\/([a-z0-9_-]+)/i],
    apiTemplate: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  },
  {
    name: 'workable',
    patterns: [/apply\.workable\.com\/([a-z0-9_-]+)/i],
    apiTemplate: (slug) => `https://apply.workable.com/api/v1/widget/jobs/${slug}`,
  },
  {
    name: 'lever',
    patterns: [/jobs\.lever\.co\/([a-z0-9_-]+)/i],
    apiTemplate: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  },
  {
    name: 'personio',
    patterns: [/([a-z0-9_-]+)\.jobs\.personio\.(de|com)/i, /personio\.(de|com)\/job-listings/i, /api\.personio\.de/i],
    apiTemplate: (slug) => `https://api.personio.de/v1/recruiting/jobboard?company=${slug}`,
  },
  {
    name: 'recruitee',
    patterns: [/([a-z0-9_-]+)\.recruitee\.com/i],
    apiTemplate: (slug) => `https://${slug}.recruitee.com/api/offers/`,
  },
  {
    name: 'smartrecruiters',
    patterns: [/careers\.smartrecruiters\.com\/([a-z0-9_-]+)/i],
    apiTemplate: (slug) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
  },
  {
    name: 'jobvite',
    patterns: [/jobs\.jobvite\.com\/([a-z0-9_-]+)/i],
    apiTemplate: (slug) => `https://jobs.jobvite.com/api/v1/jobs?c=${slug}`,
  },
]

// ── Seed list of Swiss companies to detect ────────────────────────────────
// Format: { name, website, sector, employee_range }
const SWISS_COMPANIES = [
  // Fintech / Finance
  { name: 'Neon', website: 'https://neon-free.ch', sector: 'finance', employee_range: '50-200' },
  { name: 'Taxdome CH', website: 'https://taxdome.com', sector: 'finance', employee_range: '50-200' },
  { name: 'Yapeal', website: 'https://yapeal.ch', sector: 'finance', employee_range: '10-50' },
  { name: 'Penta', website: 'https://getpenta.com', sector: 'finance', employee_range: '50-200' },
  { name: 'Numbrs', website: 'https://numbrs.com', sector: 'finance', employee_range: '50-200' },
  { name: 'Loanboox', website: 'https://loanboox.com', sector: 'finance', employee_range: '10-50' },
  { name: 'Advanon', website: 'https://advanon.com', sector: 'finance', employee_range: '10-50' },
  { name: 'Hypothekarbank Lenzburg', website: 'https://hbl.ch', sector: 'finance', employee_range: '200-500' },
  { name: 'Vontobel', website: 'https://vontobel.com', sector: 'finance', employee_range: '200-500' },
  { name: 'Leonteq', website: 'https://leonteq.com', sector: 'finance', employee_range: '200-500' },
  { name: 'Flowbank', website: 'https://flowbank.com', sector: 'finance', employee_range: '50-200' },
  { name: 'Sygnum', website: 'https://sygnum.com', sector: 'finance', employee_range: '50-200' },
  { name: 'SEBA Bank', website: 'https://seba.swiss', sector: 'finance', employee_range: '50-200' },
  { name: 'Tezos Foundation', website: 'https://tezos.foundation', sector: 'finance', employee_range: '10-50' },
  // Tech / SaaS
  { name: 'Beekeeper', website: 'https://beekeeper.io', sector: 'tech', employee_range: '200-500' },
  { name: 'Frontify', website: 'https://frontify.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Smallpdf', website: 'https://smallpdf.com', sector: 'tech', employee_range: '50-200' },
  { name: 'Cleo', website: 'https://web.meetcleo.com', sector: 'tech', employee_range: '50-200' },
  { name: 'Advertima', website: 'https://advertima.com', sector: 'tech', employee_range: '10-50' },
  { name: 'Scandit', website: 'https://scandit.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Nexthink', website: 'https://nexthink.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Bossard', website: 'https://bossard.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Verity', website: 'https://verity.net', sector: 'tech', employee_range: '50-200' },
  { name: 'Wingtra', website: 'https://wingtra.com', sector: 'tech', employee_range: '50-200' },
  { name: 'Climeworks', website: 'https://climeworks.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Planted', website: 'https://eatplanted.com', sector: 'tech', employee_range: '50-200' },
  { name: 'Doodle', website: 'https://doodle.com', sector: 'tech', employee_range: '50-200' },
  { name: 'Sophia Genetics', website: 'https://sophiagenetics.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Temenos', website: 'https://temenos.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Ergon Informatik', website: 'https://ergon.ch', sector: 'tech', employee_range: '200-500' },
  { name: 'Baloise', website: 'https://baloise.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Open Systems', website: 'https://open-systems.com', sector: 'tech', employee_range: '200-500' },
  { name: 'Byjuno', website: 'https://byjuno.ch', sector: 'tech', employee_range: '50-200' },
  { name: 'Mindpeak', website: 'https://mindpeak.ai', sector: 'tech', employee_range: '10-50' },
  { name: 'Axon Vibe', website: 'https://axonvibe.com', sector: 'tech', employee_range: '10-50' },
  { name: 'Starmind', website: 'https://starmind.com', sector: 'tech', employee_range: '50-200' },
  { name: 'Squake', website: 'https://squake.earth', sector: 'tech', employee_range: '10-50' },
  { name: 'Flatfox', website: 'https://flatfox.ch', sector: 'realestate', employee_range: '10-50' },
  { name: 'Casafair', website: 'https://casafair.ch', sector: 'realestate', employee_range: '10-50' },
  // Legal / Professional Services
  { name: 'Kellerhals Carrard', website: 'https://kellerhals-carrard.ch', sector: 'legal', employee_range: '200-500' },
  { name: 'Walder Wyss', website: 'https://walderwyss.com', sector: 'legal', employee_range: '200-500' },
  { name: 'Homburger', website: 'https://homburger.ch', sector: 'legal', employee_range: '200-500' },
  { name: 'Niederer Kraft Frey', website: 'https://nkf.ch', sector: 'legal', employee_range: '200-500' },
  { name: 'MME Legal', website: 'https://mme.ch', sector: 'legal', employee_range: '50-200' },
  // Marketing / Media
  { name: 'Dept Agency Zurich', website: 'https://deptagency.com', sector: 'marketing', employee_range: '200-500' },
  { name: 'Jung von Matt', website: 'https://jvm.com', sector: 'marketing', employee_range: '200-500' },
  { name: 'Farner', website: 'https://farner.ch', sector: 'marketing', employee_range: '50-200' },
  { name: 'Webrepublic', website: 'https://webrepublic.com', sector: 'marketing', employee_range: '50-200' },
]

// ── HTTP fetch helper ──────────────────────────────────────────────────────
function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ url, html: '', finalUrl: url }), 8000)

    const protocol = url.startsWith('https') ? https : http
    const req = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 BackchannelJobs ATS Detector' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        clearTimeout(timeout)
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href
        resolve(fetchUrl(redirectUrl, maxRedirects - 1))
        return
      }

      let html = ''
      res.on('data', (chunk) => { html += chunk; if (html.length > 500000) req.destroy() })
      res.on('end', () => { clearTimeout(timeout); resolve({ url, html, finalUrl: url }) })
    })

    req.on('error', () => { clearTimeout(timeout); resolve({ url, html: '', finalUrl: url }) })
  })
}

// ── Detect ATS from HTML ───────────────────────────────────────────────────
function detectATS(html, baseUrl) {
  for (const ats of ATS_PATTERNS) {
    for (const pattern of ats.patterns) {
      const match = html.match(pattern)
      if (match) {
        const slug = match[1] || ''
        return {
          ats: ats.name,
          ats_slug: slug,
          ats_api_url: ats.apiTemplate(slug),
        }
      }
    }
  }
  return { ats: 'unknown', ats_slug: null, ats_api_url: null }
}

// ── Careers page candidates to check ──────────────────────────────────────
function careersUrls(website) {
  const base = website.replace(/\/$/, '')
  return [
    `${base}/careers`,
    `${base}/jobs`,
    `${base}/en/careers`,
    `${base}/about/careers`,
    `${base}/work-with-us`,
    `${base}/join-us`,
    `${base}/karriere`,
    `${base}/stellen`,
  ]
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  let companies = SWISS_COMPANIES

  // Allow passing a text file of URLs
  const file = process.argv[2]
  if (file) {
    const { readFileSync } = await import('fs')
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    companies = lines.map((l) => {
      const [name, website, sector] = l.split(',').map((s) => s.trim())
      return { name: name || website, website, sector: sector || 'tech', employee_range: '10-500' }
    })
  }

  console.log(`\n🔍 Detecting ATS for ${companies.length} Swiss companies...\n`)

  let detected = 0
  let unknown = 0
  let errors = 0

  for (const company of companies) {
    process.stdout.write(`  ${company.name.padEnd(35)}`)

    let result = { ats: 'unknown', ats_slug: null, ats_api_url: null }
    let careersUrl = null

    // Try each possible careers URL
    for (const url of careersUrls(company.website)) {
      const { html } = await fetchUrl(url)
      if (!html) continue

      result = detectATS(html, url)
      if (result.ats !== 'unknown') {
        careersUrl = url
        break
      }

      // Also check if the page itself redirected to an ATS
      if (html.includes('greenhouse') || html.includes('ashby') || html.includes('workable') ||
          html.includes('lever') || html.includes('personio') || html.includes('recruitee')) {
        result = detectATS(html, url)
        if (result.ats !== 'unknown') {
          careersUrl = url
          break
        }
      }
    }

    if (result.ats !== 'unknown') {
      console.log(`✓ ${result.ats.padEnd(15)} slug: ${result.ats_slug}`)
      detected++
    } else {
      console.log(`— unknown`)
      unknown++
    }

    // Upsert into Supabase
    const { error } = await db.from('companies').upsert({
      name: company.name,
      website: company.website,
      careers_url: careersUrl,
      ats: result.ats,
      ats_slug: result.ats_slug,
      ats_api_url: result.ats_api_url,
      country: 'CH',
      sector: company.sector,
      employee_range: company.employee_range,
      active: result.ats !== 'unknown',
    }, { onConflict: 'name' })

    if (error) {
      console.error(`    DB error: ${error.message}`)
      errors++
    }

    // Small delay to be polite
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Detected ATS:  ${detected}/${companies.length}
— Unknown:       ${unknown}/${companies.length}
✗ DB errors:     ${errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next step: run the ATS job scraper to pull live roles.
  node scripts/scrape-ats-jobs.mjs
`)
}

main().catch(console.error)
