import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

// Role phrases drawn from titles we actually carry, with counts, so the
// onboarding picker can show "AML Analyst · 23 roles" rather than inviting
// someone to type a phrase that matches nothing.
//
// Suggestions are a convenience, never a gate: whatever a member types stays
// selectable. Our corpus is a snapshot, and "we don't have it today" says
// nothing about whether it's a reasonable thing to want.

type Phrase = { phrase: string; count: number }

let cache: { at: number; phrases: Phrase[] } | null = null
const TTL_MS = 6 * 3600_000

const SENIORITY = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|chief|vp|director of|assistant|associate|intern)\b/gi

function normalise(title: string): string {
  return title
    .replace(/\(.*?\)/g, ' ')
    .replace(/[|•–—]/g, ' ')
    .replace(SENIORITY, ' ')
    .replace(/[^A-Za-z0-9.+#/ &-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function loadPhrases(): Promise<Phrase[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.phrases

  const db = createServerClient()
  const { data } = await db
    .from('jobs')
    .select('title')
    .eq('is_verified_job', true)
    .neq('sector', 'other')
    .or('quality.is.null,quality.neq.low')
    .gte('posted_at', new Date(Date.now() - 60 * 86400_000).toISOString())
    .limit(12000)

  const counts = new Map<string, { display: string; n: number }>()
  for (const r of data ?? []) {
    const clean = normalise(String(r.title ?? ''))
    if (clean.length < 4 || clean.length > 48) continue
    if (clean.includes('/')) continue
    const key = clean.toLowerCase()
    const cur = counts.get(key)
    if (cur) cur.n++
    else counts.set(key, { display: clean, n: 1 })
  }

  const phrases = [...counts.entries()]
    .filter(([, v]) => v.n >= 2)
    .map(([key, v]) => ({ phrase: key, count: v.n, display: v.display }))
    .sort((a, b) => b.count - a.count)
    .map(({ phrase, count }) => ({ phrase, count }))

  cache = { at: Date.now(), phrases }
  return phrases
}

/** Separators almost always mean "or" — except where they're part of a name. */
const KEEP_WHOLE = new Set(['c#/.net', 'c#/vb.net', 'ci/cd', 'r&d', 'p&l', 'a/b'])

function splitCandidates(raw: string): string[] {
  const t = raw.trim()
  if (!t) return []
  if (KEEP_WHOLE.has(t.toLowerCase())) return [t]
  if (!/[/,&]|\bor\b/i.test(t)) return [t]
  return t
    .split(/\s*(?:[/,&]|\bor\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
}

export async function GET(req: NextRequest) {
  try {
    const qRaw = (new URL(req.url).searchParams.get('q') ?? '').trim()
    const q = qRaw.toLowerCase()
    if (q.length < 2) return NextResponse.json({ suggestions: [], parts: [] })

    const phrases = await loadPhrases()

    // Anything containing the typed text, nearest match first
    const hits = phrases
      // match at word starts, so "am" offers AML rather than ambulatory,
      // mainframe and programme
      .filter((p) => new RegExp('(^|[^a-z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(p.phrase))
      .sort((a, b) => {
        const aStarts = a.phrase.startsWith(q) ? 0 : 1
        const bStarts = b.phrase.startsWith(q) ? 0 : 1
        if (aStarts !== bStarts) return aStarts - bStarts
        return b.count - a.count
      })
      .slice(0, 8)

    // If they've typed several roles in one box, offer each separately
    const parts = splitCandidates(qRaw)
    const multi = parts.length > 1 ? parts : []

    return NextResponse.json({ suggestions: hits, parts: multi })
  } catch {
    return NextResponse.json({ suggestions: [], parts: [] })
  }
}
