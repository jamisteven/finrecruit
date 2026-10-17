import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { splitRole } from '@/lib/splitRole'

export const runtime = 'nodejs'

// Role phrases drawn from titles we actually carry, with counts, so the
// onboarding picker can show "AML Analyst · 23 roles" rather than inviting
// someone to type a phrase that matches nothing.
//
// Suggestions are a convenience, never a gate: whatever a member types stays
// selectable. Our corpus is a snapshot, and "we don't have it today" says
// nothing about whether it's a reasonable thing to want.

type Phrase = { phrase: string; display: string; count: number }

let cache: { at: number; phrases: Phrase[]; byPhrase: Map<string, Phrase> } | null = null
const TTL_MS = 6 * 3600_000

const SENIORITY = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|chief|vp|director of|assistant|associate|intern)\b/gi

// Words a phrase can't start or end on — "of", "analyst and" are not roles
const EDGE_STOP = new Set(['and', 'or', 'of', 'the', 'for', 'in', 'at', 'to', 'with', 'a', 'an', '&', '-', 'remote', 'hybrid', 'onsite'])
// Single words that are a role family or pure noise rather than a search
const LONE_STOP = new Set(['manager', 'analyst', 'engineer', 'developer', 'specialist', 'consultant', 'officer',
  'associate', 'director', 'coordinator', 'executive', 'lead', 'head', 'role', 'position', 'job', 'jobs', 'hiring',
  'urgent', 'immediate', 'needed', 'required', 'new', 'team', 'london', 'york', 'usa', 'uk'])

function normalise(title: string): string {
  return title
    .replace(/\(.*?\)/g, ' ')
    // dashes, bullets, commas and colons separate parts of a title; a phrase
    // never crosses one ("business analyst – aml" is not "analyst aml")
    .replace(/[|•–—,:]|\s-\s/g, ' | ')
    .replace(SENIORITY, ' ')
    .replace(/[^A-Za-z0-9.+#/ &|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Every 1–3 word run inside each title we hold, counted by how many titles
// contain it, so "aml" is offered on its own (with how many roles mention it)
// as well as "aml analyst" and "kyc analyst" — none of which would survive
// as a whole title. Display casing follows the majority of recruiters, so an
// acronym stays an acronym.
async function loadPhrases(): Promise<{ phrases: Phrase[]; byPhrase: Map<string, Phrase> }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache

  const db = createServerClient()
  const { data } = await db
    .from('jobs')
    .select('title')
    .eq('is_verified_job', true)
    .neq('sector', 'other')
    .or('quality.is.null,quality.neq.low')
    .gte('posted_at', new Date(Date.now() - 60 * 86400_000).toISOString())
    .limit(12000)

  const counts = new Map<string, { n: number; forms: Map<string, number> }>()
  for (const r of data ?? []) {
    const clean = normalise(String(r.title ?? ''))
    if (clean.length < 2) continue
    const seenHere = new Set<string>()
    for (const segment of clean.split('|')) {
    // slashes separate alternatives ("AML/KYC Analyst"); keep "c#/.net"-style names whole
    const words = segment.split(/\s+|(?<=[a-z])\/(?=[a-z])/i).map((w) => w.replace(/^[./-]+|[./-]+$/g, '')).filter(Boolean)
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const run = words.slice(i, i + n)
        const lo = run.map((w) => w.toLowerCase())
        if (EDGE_STOP.has(lo[0]) || EDGE_STOP.has(lo[n - 1])) continue
        if (n === 1 && (lo[0].length < 2 || LONE_STOP.has(lo[0]) || /^\d+$/.test(lo[0]))) continue
        const key = lo.join(' ')
        if (key.length < 2 || key.length > 48 || seenHere.has(key)) continue
        seenHere.add(key)
        const cur = counts.get(key) ?? { n: 0, forms: new Map() }
        cur.n++
        const form = run.join(' ')
        cur.forms.set(form, (cur.forms.get(form) ?? 0) + 1)
        counts.set(key, cur)
      }
    }
    }
  }

  // A multi-word phrase that only ever occurs inside one longer phrase
  // ("murex market" vs "murex market risk", same count) is a truncation, not
  // a role; keep the longer one. Single words stay: they're short searches.
  const keys = [...counts.keys()]
  const truncated = new Set<string>()
  for (const k of keys) {
    if (!k.includes(' ')) continue
    const n = counts.get(k)!.n
    const longer = keys.some((o) => o !== k && o.length > k.length && counts.get(o)!.n === n &&
      (o.startsWith(k + ' ') || o.endsWith(' ' + k)))
    if (longer) truncated.add(k)
  }

  const phrases: Phrase[] = [...counts.entries()]
    .filter(([k, v]) => v.n >= 2 && !truncated.has(k))
    .map(([phrase, v]) => {
      const display = [...v.forms.entries()].sort((a, b) => b[1] - a[1])[0][0]
      return { phrase, display, count: v.n }
    })
    .sort((a, b) => b.count - a.count)

  const byPhrase = new Map(phrases.map((p) => [p.phrase, p]))
  cache = { at: Date.now(), phrases, byPhrase }
  return cache
}

export async function GET(req: NextRequest) {
  try {
    const qRaw = (new URL(req.url).searchParams.get('q') ?? '').trim()
    const q = qRaw.toLowerCase()
    if (q.length < 2) return NextResponse.json({ suggestions: [], parts: [] })

    const { phrases } = await loadPhrases()
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // match at word starts, so "am" offers AML rather than ambulatory,
    // mainframe and programme
    const atWordStart = new RegExp('(^|[^a-z0-9])' + esc)

    // The typed text itself first (if we carry it), then phrases that start
    // with it, then phrases that contain it — each by how many roles use it
    const hits = phrases
      .filter((p) => atWordStart.test(p.phrase))
      .sort((a, b) => {
        const rank = (p: Phrase) => (p.phrase === q ? 0 : p.phrase.startsWith(q) ? 1 : 2)
        const d = rank(a) - rank(b)
        if (d !== 0) return d
        if (b.count !== a.count) return b.count - a.count
        return a.phrase.length - b.phrase.length
      })
      .slice(0, 8)

    // If they've typed several roles in one box, offer each separately
    const parts = splitRole(qRaw)
    const multi = parts.length > 1 ? parts : []

    return NextResponse.json({ suggestions: hits, parts: multi })
  } catch {
    return NextResponse.json({ suggestions: [], parts: [] })
  }
}
