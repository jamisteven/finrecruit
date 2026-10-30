import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendEmailDetailed } from '@/lib/email'
import { buildWinback, loadRecipients, targetsFor, type Audience } from '@/lib/winback'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Win-back email to free and lapsed members, personalised from their saved searches.
//
//   POST header x-ingest-secret
//   { campaign: "winback-1",            required; the dedupe key: a member gets each campaign once
//     audience: "free"|"lapsed"|"both", default "free"
//     dryRun: true,                     default true: counts + rendered samples, sends nothing
//     limit: 25,                        max 60 per call (one call stays under the function time limit)
//     minAgeDays: 2,                    skip accounts newer than this
//     preview: 3,                       dry run only: how many rendered samples to return
//     testTo: "you@x.com",              send ONE rendered email to this address (not logged), using the first eligible member's data
//     asEmail: "member@x.com" }         with testTo: render using this member's data instead
//
// Run it with dryRun first, send yourself a test, send a small batch, then repeat the same call until `remaining` is 0.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  if (!process.env.INGEST_SECRET || req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const campaign = typeof body.campaign === 'string' ? body.campaign : ''
  if (!/^[a-z0-9_-]{3,40}$/.test(campaign)) return NextResponse.json({ error: 'campaign must be 3-40 chars of a-z 0-9 _ -' }, { status: 400 })
  const audience: Audience = body.audience === 'lapsed' || body.audience === 'both' ? body.audience : 'free'
  const dryRun = body.dryRun !== false
  const limit = Math.min(60, Math.max(1, Number(body.limit) || 25))
  const minAgeDays = Math.max(0, Number(body.minAgeDays ?? 2))
  const previewN = Math.min(8, Math.max(0, Number(body.preview ?? 3)))
  const address = process.env.EMAIL_POSTAL_ADDRESS ?? ''

  const warnings: string[] = []
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) warnings.push('RESEND_API_KEY / EMAIL_FROM not set: nothing can be sent')
  if (!address) warnings.push('EMAIL_POSTAL_ADDRESS not set: commercial email must include a postal address, so real sends are refused until you add it')

  const db = createServerClient()
  try {
    const { eligible, counts } = await loadRecipients(db, audience, campaign, minAgeDays)
    const build = async (r: (typeof eligible)[number]) =>
      buildWinback({ kind: r.kind, userId: r.id, campaign, counts: await targetsFor(db, r.id), passEndedAt: r.pass_expires_at, address: address || '[postal address not set]' })

    // test send: one rendered email to your own inbox, nothing logged
    if (typeof body.testTo === 'string' && body.testTo.includes('@')) {
      const who = typeof body.asEmail === 'string' ? eligible.find((r) => r.email.toLowerCase() === body.asEmail.toLowerCase()) : eligible[0]
      if (!who) return NextResponse.json({ error: 'no eligible member to render from (try asEmail of someone eligible)' }, { status: 404 })
      const m = await build(who)
      const out = await sendEmailDetailed(body.testTo, `[TEST] ${m.subject}`, m.html, m.text, { headers: m.headers })
      return NextResponse.json({ test: true, renderedFor: who.email, kind: who.kind, ok: out.ok, error: out.error, warnings })
    }

    const batch = eligible.slice(0, limit)

    if (dryRun) {
      const samples = []
      for (const r of batch.slice(0, previewN)) {
        const m = await build(r)
        samples.push({ to: r.email, kind: r.kind, subject: m.subject, summary: m.summary, text: m.text })
      }
      // how many of the batch would get real numbers vs the generic version
      let withNumbers = 0
      for (const r of batch) { if ((await targetsFor(db, r.id)).some((c) => c.exact + c.agency > 0)) withNumbers++ }
      return NextResponse.json({ dryRun: true, campaign, audience, counts, eligible: eligible.length, thisBatch: batch.length, thisBatchWithMatchNumbers: withNumbers, warnings, samples })
    }

    if (!address) return NextResponse.json({ error: 'EMAIL_POSTAL_ADDRESS is not set; add it in Vercel before sending', warnings }, { status: 400 })
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return NextResponse.json({ error: 'RESEND_API_KEY / EMAIL_FROM not set', warnings }, { status: 400 })

    const startedAt = Date.now()
    let sent = 0, failed = 0, skipped = 0
    const errors: string[] = []
    for (const r of batch) {
      if (Date.now() - startedAt > 48_000) break   // leave room to answer; call again for the rest
      // claim first: the unique (user_id, campaign) row is what stops a double send, even with two calls at once
      const { error: claimErr } = await db.from('email_sends').insert({ user_id: r.id, email: r.email, campaign, status: 'sending' })
      if (claimErr) { skipped++; continue }
      const m = await build(r)
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
    return NextResponse.json({ campaign, sent, failed, skipped, errors, remaining: Math.max(0, eligible.length - sent - failed - skipped) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
