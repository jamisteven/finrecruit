import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/adminAuth'
import { DEFAULT_REPLY_PROMPT, draftReply } from '@/lib/redditRadar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Admin only. Drafts one reply from pasted thread text. Nothing is posted to Reddit.
export async function POST(req: NextRequest) {
  const { ok } = await isAdminRequest()
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const b = await req.json().catch(() => ({}))
    const thread = String(b.thread ?? '').trim()
    if (thread.length < 20) return NextResponse.json({ error: 'Paste the thread text first' }, { status: 400 })
    const reply = await draftReply({
      prompt: String(b.prompt ?? '').trim() || DEFAULT_REPLY_PROMPT,
      subreddit: String(b.subreddit ?? ''), title: String(b.title ?? ''), thread, mention: b.mention !== false,
    })
    return NextResponse.json({ reply })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
