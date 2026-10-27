import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { scorePosts } from '@/lib/redditRadar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Admin only. Scores up to 15 threads per call; the page sends them in batches.
export async function POST(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const body = await req.json().catch(() => ({}))
    const posts = (Array.isArray(body.posts) ? body.posts : []).slice(0, 15).map((p: Record<string, unknown>) => ({
      id: String(p.id ?? '').toLowerCase(), subreddit: String(p.subreddit ?? ''), title: String(p.title ?? ''), snippet: String(p.snippet ?? ''),
    })).filter((p: { id: string }) => p.id)
    return NextResponse.json({ scores: await scorePosts(posts) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
