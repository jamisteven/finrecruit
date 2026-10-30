import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sendEmailDetailed } from '@/lib/email'
import { buildWinback, dataFor, loadRecipients, memberDataFor, tierOf, totalOf, type MemberData, type Audience, type Recipient, type Kind } from '@/lib/winback'

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
//     minMatches: 3,                    only email members whose searches matched at least this many roles in 14 days.
//                                       The rest are HELD BACK (not logged as sent, so a later campaign can still reach them).
//                                       0 = email everyone; members with too few matches then get the generic version with no numbers.
//     preview: 3,                       dry run only: how many rendered samples to return (max 8)
//     html: true,                       dry run only: include the HTML of each sample
//     testTo: "you@x.com",              send ONE rendered email to this address (not logged)
//     asEmail: "member@x.com",          dry run / testTo: use this member's data (testTo works for any member, eligible or not)
//     kind: "free"|"lapsed" }           with testTo: force which version to render
//
// Run it with dryRun first, send yourself a test, send a small batch, then repeat the same call until `remaining` is 0.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
type Member = Recipient & { kind: Kind }

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
  const minMatches = Math.max(0, Number(body.minMatches ?? 3))
  const previewN = Math.min(8, Math.max(0, Number(body.preview ?? 3)))
  const address = process.env.EMAIL_POSTAL_ADDRESS ?? ''

  const warnings: string[] = []
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) warnings.push('RESEND_API_KEY / EMAIL_FROM not set: nothing can be sent')
  if (!address) warnings.push('EMAIL_POSTAL_ADDRESS not set: commercial email must include a postal address, so real sends are refused until you add it')

  const db = createServerClient()
  try {
    const { eligible, counts } = await loadRecipients(db, audience, campaign, minAgeDays)
    const build = (r: Member, d: MemberData) =>
      buildWinback({ kind: r.kind, userId: r.id, campaign, counts: d.counts, source: d.source, win: d.win, passEndedAt: r.pass_expires_at, address: address || '[postal address not set]' })

    // test send: one rendered email to your own inbox, nothing logged
    if (typeof body.testTo === 'string' && body.testTo.includes('@')) {
      let who: Member | undefined = typeof body.asEmail === 'string' ? eligible.find((r) => r.email.toLowerCase() === body.asEmail.toLowerCase()) : eligible[0]
      if (!who && typeof body.asEmail === 'string') {
        // a test can render for ANY member, eligible or not (your own account has an active pass, so it is not eligible).
        const { data: p } = await db.from('profiles').select('id, email, created_at, pass_expires_at').ilike('email', body.asEmail).maybeSingle()
        if (p) who = { ...(p as Recipient), kind: body.kind === 'lapsed' ? 'lapsed' : body.kind === 'free' ? 'free' : (p.pass_expires_at ? 'lapsed' : 'free') }
      }
      if (!who) return NextResponse.json({ error: 'no member with that email, and no eligible member to render from' }, { status: 404 })
      const m = build(who, await dataFor(db, who.id))
      const out = await sendEmailDetailed(body.testTo, `[TEST ${new Date().toISOString().slice(11, 19)}] ${m.subject}`, m.html, m.text, { headers: m.headers })
      return NextResponse.json({ test: true, renderedFor: who.email, kind: who.kind, tier: m.summary.tier, ok: out.ok, error: out.error, warnings })
    }

    // what each eligible member has to show, and who is worth emailing at all
    const byUser = await memberDataFor(db, eligible.map((r) => r.id))
    const tiers = { strong: 0, medium: 0, thin: 0, none: 0 }
    const sources = { saved: 0, searched: 0 }
    const sendable: Member[] = []
    for (const r of eligible) {
      const d = byUser.get(r.id)!
      tiers[tierOf(d.counts)]++
      sources[d.source]++
      if (totalOf(d.counts) >= minMatches) sendable.push(r)
    }
    const heldBack = eligible.length - sendable.length

    if (dryRun) {
      const wanted = typeof body.asEmail === 'string'
        ? eligible.filter((r) => r.email.toLowerCase() === body.asEmail.toLowerCase())
        : sendable.slice(0, previewN)
      const samples = wanted.map((r) => {
        const m = build(r, byUser.get(r.id)!)
        return { to: r.email, kind: r.kind, tier: m.summary.tier, subject: m.subject, summary: m.summary, text: m.text, ...(body.html ? { html: m.html } : {}) }
      })
      return NextResponse.json({
        dryRun: true, campaign, audience, minMatches, counts, eligible: eligible.length, tiers, sources,
        wouldSend: sendable.length, heldBack, thisBatch: Math.min(limit, sendable.length), warnings, samples,
      })
    }

    if (!address) return NextResponse.json({ error: 'EMAIL_POSTAL_ADDRESS is not set; add it in Vercel before sending', warnings }, { status: 400 })
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return NextResponse.json({ error: 'RESEND_API_KEY / EMAIL_FROM not set', warnings }, { status: 400 })

    const startedAt = Date.now()
    let sent = 0, failed = 0, skipped = 0
    const errors: string[] = []
    for (const r of sendable.slice(0, limit)) {
      if (Date.now() - startedAt > 48_000) break   // leave room to answer; call again for the rest
      // claim first: the unique (user_id, campaign) row is what stops a double send, even with two calls at once
      const { error: claimErr } = await db.from('email_sends').insert({ user_id: r.id, email: r.email, campaign, status: 'sending' })
      if (claimErr) { skipped++; continue }
      const m = build(r, byUser.get(r.id)!)
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
    return NextResponse.json({ campaign, sent, failed, skipped, errors, remaining: Math.max(0, sendable.length - sent - failed - skipped), heldBack })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
