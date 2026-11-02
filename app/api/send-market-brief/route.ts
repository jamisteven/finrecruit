import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendEmailDetailed } from '@/lib/email'
import { briefsFor, buildBrief, loadBriefRecipients, weekKey } from '@/lib/marketBrief'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// The weekly market brief to paying members.
//
//   GET  (the Vercel cron, Authorization: Bearer CRON_SECRET): sends this week's brief to everyone who has not had it.
//        Does nothing until MARKET_BRIEF_ENABLED=true is set in Vercel, so it can be deployed, previewed and tested first.
//        The cron runs twice on Monday; the second run only picks up members the first did not reach.
//
//   POST (header x-ingest-secret), for checking it by hand:
//     { dryRun: true,        default true: counts and rendered samples, nothing sent
//       limit: 25,           real sends per call
//       preview: 2,          dry run: how many rendered samples to return (max 6)
//       html: true,          dry run: include each sample's HTML
//       asEmail: "x@y.com",  dry run / testTo: render for this member (any member, paying or not)
//       testTo: "you@x.com"  send ONE rendered brief to this address (not logged, ignores the enabled switch) }
//
// A member gets one brief per ISO week: the (user, week) row in email_sends is claimed before sending.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function run(opts: { dryRun: boolean; limit: number; preview: number; html: boolean; asEmail?: string; testTo?: string }) {
  const db = createServerClient()
  const campaign = weekKey()
  const address = process.env.EMAIL_POSTAL_ADDRESS ?? ''
  const warnings: string[] = []
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) warnings.push('RESEND_API_KEY / EMAIL_FROM not set: nothing can be sent')
  if (!address) warnings.push('EMAIL_POSTAL_ADDRESS not set: add it in Vercel (the brief footer carries it)')

  // one rendered brief to your own inbox
  if (opts.testTo && opts.testTo.includes('@')) {
    if (!opts.asEmail) return { status: 400, body: { error: 'testTo needs asEmail (whose searches to render)' } }
    const { data: p } = await db.from('profiles').select('id, email').ilike('email', opts.asEmail).maybeSingle()
    if (!p) return { status: 404, body: { error: 'no member with that email' } }
    const b = (await briefsFor(db, [p.id as string])).get(p.id as string)
    if (!b) return { status: 200, body: { test: true, renderedFor: p.email, note: 'This member has no saved search with roles in the last two weeks, so a real run would skip them.' } }
    const m = buildBrief({ userId: p.id as string, brief: b, address: address || '[postal address not set]' })
    const out = await sendEmailDetailed(opts.testTo, `[TEST] ${m.subject}`, m.html, m.text, { headers: m.headers })
    return { status: 200, body: { test: true, renderedFor: p.email, ok: out.ok, error: out.error, summary: m.summary, warnings } }
  }

  const recipients = await loadBriefRecipients(db, campaign)
  const briefs = await briefsFor(db, recipients.map((r) => r.id))
  const sendable = recipients.filter((r) => (briefs.get(r.id)?.distinctThisWeek ?? 0) > 0)

  if (opts.dryRun) {
    const wanted = opts.asEmail
      ? recipients.filter((r) => r.email.toLowerCase() === opts.asEmail!.toLowerCase())
      : sendable.slice(0, opts.preview)
    const samples = wanted.flatMap((r) => {
      const b = briefs.get(r.id); if (!b) return []
      const m = buildBrief({ userId: r.id, brief: b, address: address || '[postal address not set]' })
      return [{ to: r.email, subject: m.subject, summary: m.summary, text: m.text, ...(opts.html ? { html: m.html } : {}) }]
    })
    return { status: 200, body: { dryRun: true, campaign, payingNotYetSent: recipients.length, wouldSend: sendable.length, skippedNothingToSay: recipients.length - sendable.length, warnings, samples } }
  }

  if (!address) return { status: 400, body: { error: 'EMAIL_POSTAL_ADDRESS is not set', warnings } }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { status: 400, body: { error: 'RESEND_API_KEY / EMAIL_FROM not set', warnings } }

  const startedAt = Date.now()
  let sent = 0, failed = 0, skipped = 0
  const errors: string[] = []
  for (const r of sendable.slice(0, opts.limit)) {
    if (Date.now() - startedAt > 270_000) break
    // claim first: the unique (user_id, campaign) row is what stops a double send, even with two runs at once
    const { error: claimErr } = await db.from('email_sends').insert({ user_id: r.id, email: r.email, campaign, status: 'sending' })
    if (claimErr) { skipped++; continue }
    const m = buildBrief({ userId: r.id, brief: briefs.get(r.id)!, address })
    const out = await sendEmailDetailed(r.email, m.subject, m.html, m.text, { headers: m.headers, tags: [{ name: 'campaign', value: campaign }] })
    if (out.ok) {
      sent++
      await db.from('email_sends').update({ status: 'sent', resend_id: out.id ?? null, sent_at: new Date().toISOString() }).eq('user_id', r.id).eq('campaign', campaign)
    } else {
      failed++
      if (errors.length < 5) errors.push(out.error ?? 'unknown')
      await db.from('email_sends').update({ status: 'failed', error: out.error ?? null }).eq('user_id', r.id).eq('campaign', campaign)
    }
    await sleep(650)   // Resend's default limit is 2 requests a second
  }
  return { status: 200, body: { campaign, sent, failed, skipped, errors, remaining: Math.max(0, sendable.length - sent - failed - skipped) } }
}

export async function GET(req: NextRequest) {
  const isCron = !!process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.MARKET_BRIEF_ENABLED !== 'true') return NextResponse.json({ enabled: false, note: 'Set MARKET_BRIEF_ENABLED=true in Vercel to start sending.' })
  try {
    const r = await run({ dryRun: false, limit: 500, preview: 0, html: false })
    return NextResponse.json(r.body, { status: r.status })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  if (!process.env.INGEST_SECRET || req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  try {
    const r = await run({
      dryRun: body.dryRun !== false,
      limit: Math.min(100, Math.max(1, Number(body.limit) || 25)),
      preview: Math.min(6, Math.max(0, Number(body.preview ?? 2))),
      html: !!body.html,
      asEmail: typeof body.asEmail === 'string' ? body.asEmail : undefined,
      testTo: typeof body.testTo === 'string' ? body.testTo : undefined,
    })
    return NextResponse.json(r.body, { status: r.status })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
}
