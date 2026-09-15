#!/usr/bin/env node
// ATS Job Scraper — pulls jobs directly from company ATS APIs, completely free
// Run from ~/finrecruit: node scripts/scrape-ats-jobs.mjs

import { createClient } from '@supabase/supabase-js'
import https from 'https'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars. Run: source .env.local first')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── HTTP fetch JSON ────────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 10000)
    https.get(url, { headers: { 'User-Agent': 'BackchannelJobs/1.0', 'Accept': 'application/json' } }, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        clearTimeout(timeout)
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    }).on('error', () => { clearTimeout(timeout); resolve(null) })
  })
}

// ── Normalise jobs per ATS ─────────────────────────────────────────────────
function normaliseJobs(ats, data, company) {
  if (!data) return []

  try {
    switch (ats) {
      case 'greenhouse': {
        const jobs = data.jobs || []
        return jobs.map((j) => ({
          title: j.title,
          company: company.name,
          location: j.location?.name || null,
          url: j.absolute_url,
          posted_at: j.updated_at || null,
          department: j.departments?.[0]?.name || null,
          remote: j.location?.name?.toLowerCase().includes('remote') || false,
        }))
      }

      case 'ashby': {
        const jobs = data.jobs || []
        return jobs.map((j) => ({
          title: j.title,
          company: company.name,
          location: j.location || j.locationName || null,
          url: `https://jobs.ashbyhq.com/${company.ats_slug}/${j.id}`,
          posted_at: j.publishedAt || null,
          department: j.department || null,
          remote: j.isRemote || j.location?.toLowerCase().includes('remote') || false,
        }))
      }

      case 'workable': {
        const jobs = data.jobs || []
        return jobs.map((j) => ({
          title: j.title,
          company: company.name,
          location: j.location?.city ? `${j.location.city}, ${j.location.country}` : null,
          url: j.url,
          posted_at: j.published_on || null,
          department: j.department || null,
          remote: j.remote || false,
        }))
      }

      case 'lever': {
        const jobs = Array.isArray(data) ? data : []
        return jobs.map((j) => ({
          title: j.text,
          company: company.name,
          location: j.categories?.location || j.workplaceType || null,
          url: j.hostedUrl || j.applyUrl,
          posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
          department: j.categories?.department || null,
          remote: j.workplaceType?.toLowerCase().includes('remote') || false,
        }))
      }

      case 'personio': {
        const jobs = data.data || []
        return jobs.map((j) => ({
          title: j.attributes?.name?.value || j.name,
          company: company.name,
          location: j.attributes?.office?.value?.[0]?.attributes?.name?.value || null,
          url: j.attributes?.employment_type ? `https://${company.ats_slug}.jobs.personio.de/job/${j.id}` : null,
          posted_at: j.attributes?.created_at?.value || null,
          department: j.attributes?.department?.value?.[0]?.attributes?.name?.value || null,
          remote: false,
        }))
      }

      case 'recruitee': {
        const jobs = data.offers || []
        return jobs.map((j) => ({
          title: j.title,
          company: company.name,
          location: j.location || j.city || null,
          url: j.careers_url,
          posted_at: j.published_at || null,
          department: j.department || null,
          remote: j.remote || false,
        }))
      }

      case 'smartrecruiters': {
        const jobs = data.content || []
        return jobs.map((j) => ({
          title: j.name,
          company: company.name,
          location: j.location?.city ? `${j.location.city}, ${j.location.country}` : null,
          url: `https://careers.smartrecruiters.com/${company.ats_slug}/${j.id}`,
          posted_at: j.releasedDate || null,
          department: j.department?.label || null,
          remote: j.location?.remote || false,
        }))
      }

      default:
        return []
    }
  } catch (err) {
    console.error(`  Parse error for ${company.name}:`, err.message)
    return []
  }
}

// ── Insert jobs into Supabase ──────────────────────────────────────────────
async function insertJobs(jobs, company) {
  let inserted = 0
  let skipped = 0

  for (const job of jobs) {
    if (!job.title || !job.url) continue

    // Check duplicate by URL
    const { data: existing } = await db
      .from('jobs')
      .select('id')
      .eq('post_url', job.url)
      .single()

    if (existing) { skipped++; continue }

    const { error } = await db.from('jobs').insert({
      title: job.title,
      company: job.company,
      location: job.location,
      seniority: 'Unknown',
      salary: null,
      apply_method: 'Apply via company website',
      summary: `${job.title} at ${job.company}${job.location ? ` · ${job.location}` : ''}${job.department ? ` · ${job.department}` : ''}`,
      tags: [
        company.sector,
        job.remote ? 'remote' : null,
        job.department?.toLowerCase().replace(/\s+/g, '-') || null,
        'direct',
      ].filter(Boolean),
      sector: company.sector || 'tech',
      post_url: job.url,
      author_name: company.name,
      author_headline: `${company.ats?.toUpperCase()} · Direct listing`,
      author_linkedin_url: null,
      raw_text: JSON.stringify(job),
      posted_at: job.posted_at,
      extracted_at: new Date().toISOString(),
      is_verified_job: true,
      source: 'ats_direct',
    })

    if (!error) inserted++
  }

  return { inserted, skipped }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  // Get all active companies with a known ATS
  const { data: companies, error } = await db
    .from('companies')
    .select('*')
    .eq('active', true)
    .neq('ats', 'unknown')
    .not('ats_api_url', 'is', null)
    .order('last_scraped_at', { ascending: true, nullsFirst: true })

  if (error || !companies?.length) {
    console.log('No companies found. Run detect-ats.mjs first.')
    return
  }

  console.log(`\n📋 Scraping ${companies.length} company ATS APIs...\n`)

  let totalInserted = 0
  let totalSkipped = 0
  let totalJobs = 0

  for (const company of companies) {
    process.stdout.write(`  ${company.name.padEnd(35)} [${company.ats.padEnd(14)}] `)

    const data = await fetchJSON(company.ats_api_url)
    const jobs = normaliseJobs(company.ats, data, company)
    totalJobs += jobs.length

    if (jobs.length === 0) {
      console.log(`— 0 jobs`)
      await db.from('companies').update({
        last_scraped_at: new Date().toISOString(),
        last_jobs_found: 0,
      }).eq('id', company.id)
      continue
    }

    const { inserted, skipped } = await insertJobs(jobs, company)
    totalInserted += inserted
    totalSkipped += skipped

    console.log(`✓ ${jobs.length} jobs found, ${inserted} new, ${skipped} dupes`)

    await db.from('companies').update({
      last_scraped_at: new Date().toISOString(),
      last_jobs_found: jobs.length,
    }).eq('id', company.id)

    await new Promise((r) => setTimeout(r, 200))
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total jobs found:    ${totalJobs}
New jobs inserted:   ${totalInserted}
Duplicates skipped:  ${totalSkipped}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

main().catch(console.error)
