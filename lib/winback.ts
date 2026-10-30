// Win-back / "come see what your searches found" email to free and lapsed members.
// Personalised from each member's saved searches (user_targets), counted against the last 14 days of roles.
// Plain and short on purpose: no countdown timers, no invented scarcity, only numbers we can show.

import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countsForTargets, type TargetCount } from './targetStatus'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

const SITE = 'https://www.backchanneljobs.com'
const PRICE = { intro: 9, monthly: 15, quarter: 39 }   // keep in sync with app/offer/page.tsx and Stripe
const DAY = 86_400_000

export type Audience = 'free' | 'lapsed' | 'both'
export type Recipient = { id: string; email: string; created_at: string; pass_expires_at: string | null }
export type Kind = 'free' | 'lapsed'

// ---------- unsubscribe tokens ----------

const secret = () => process.env.EMAIL_UNSUB_SECRET || process.env.INGEST_SECRET || ''
export function unsubToken(userId: string): string {
  return createHmac('sha256', secret()).update(`unsub:${userId}`).digest('hex').slice(0, 40)
}
export function validUnsubToken(userId: string, token: string): boolean {
  if (!secret() || !token) return false
  const a = Buffer.from(unsubToken(userId)); const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}
export const unsubUrl = (userId: string) => `${SITE}/api/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken(userId)}`

// ---------- who gets it ----------

export async function loadRecipients(
  db: Db, audience: Audience, campaign: string, minAgeDays: number,
): Promise<{ eligible: (Recipient & { kind: Kind })[]; counts: Record<string, number> }> {
  const profiles: Recipient[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('profiles')
      .select('id, email, created_at, pass_expires_at')
      .is('email_unsubscribed_at', null)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`profiles: ${error.message} (did you run supabase/2026-10-30-email-campaigns.sql?)`)
    profiles.push(...((data ?? []) as Recipient[]))
    if ((data ?? []).length < 1000) break
  }
  const sent = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('email_sends').select('user_id').eq('campaign', campaign).range(from, from + 999)
    if (error) throw new Error(`email_sends: ${error.message} (did you run supabase/2026-10-30-email-campaigns.sql?)`)
    for (const r of data ?? []) sent.add(r.user_id as string)
    if ((data ?? []).length < 1000) break
  }

  const now = Date.now()
  const counts = { profiles: profiles.length, no_email: 0, active_now: 0, too_new: 0, already_sent: 0, free: 0, lapsed: 0 }
  const eligible: (Recipient & { kind: Kind })[] = []
  for (const p of profiles) {
    if (!p.email || !p.email.includes('@')) { counts.no_email++; continue }
    const until = p.pass_expires_at ? new Date(p.pass_expires_at).getTime() : null
    if (until !== null && until > now) { counts.active_now++; continue }
    if (now - new Date(p.created_at).getTime() < minAgeDays * DAY) { counts.too_new++; continue }
    if (sent.has(p.id)) { counts.already_sent++; continue }
    const kind: Kind = until === null ? 'free' : 'lapsed'
    if (audience !== 'both' && audience !== kind) continue
    counts[kind]++
    eligible.push({ ...p, kind })
  }
  return { eligible, counts }
}

// ---------- what it says ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const place = (l: string | null) => (l ? cap(l) : 'anywhere')
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export type Built = { subject: string; html: string; text: string; headers: Record<string, string>; summary: { total: number; fresh: number; lines: number } }

export async function targetsFor(db: Db, userId: string): Promise<TargetCount[]> {
  const { data } = await db.from('user_targets').select('keyword, location').eq('user_id', userId).order('created_at')
  const targets = (data ?? []) as { keyword: string; location: string | null }[]
  if (!targets.length) return []
  return countsForTargets(db, targets)
}

export function buildWinback(opts: { kind: Kind; userId: string; campaign: string; counts: TargetCount[]; passEndedAt: string | null; address: string }): Built {
  const { kind, userId, campaign, counts, address } = opts
  const lines = counts.map((c) => ({ label: `${cap(c.keyword)} · ${place(c.location)}`, n: c.exact + c.agency, fresh: c.fresh }))
    .filter((l) => l.n > 0).sort((a, b) => b.n - a.n).slice(0, 4)
  const total = counts.reduce((s, c) => s + c.exact + c.agency, 0)
  const fresh = counts.reduce((s, c) => s + c.fresh, 0)
  const hasNumbers = lines.length > 0

  const url = `${SITE}/offer?src=email&utm_source=email&utm_medium=winback&utm_campaign=${encodeURIComponent(campaign)}`
  const unsub = unsubUrl(userId)
  const endedOn = opts.passEndedAt ? new Date(opts.passEndedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null

  const first = counts.length === 1 ? counts[0] : null
  const subject = kind === 'lapsed'
    ? (hasNumbers ? `Your pass ended. ${plural(total, 'role')} matched your searches since.` : 'Your Backchannel pass ended; here is what is new')
    : hasNumbers
      ? (first ? `${plural(total, cap(first.keyword) + ' role')} in ${place(first.location)} in the last 2 weeks` : `${plural(total, 'role')} matched your searches in the last 2 weeks`)
      : 'Recruiter posts, 48 hours before the free feed'

  const intro = kind === 'lapsed'
    ? `Your Backchannel pass ended${endedOn ? ` on ${endedOn}` : ''}. Your saved searches kept running, so here is what they found.`
    : 'You signed up for Backchannel, so I wanted to show you what your searches have found.'

  const numbers = hasNumbers
    ? `In the last 14 days, your searches matched ${plural(total, 'role')}${fresh > 0 ? `, ${fresh} of them found in the last 2 days` : ''}:`
    : 'Backchannel finds roles that recruiters post on LinkedIn before they reach a job board, and checks your searches at least twice a day.'

  const gap = 'On the free plan, a new role appears after a 48-hour delay and the recruiter\'s name and link stay hidden. Premium shows each one the moment we find it, with the recruiter\'s name and a direct link to their post, so you can message them first.'
  const price = `First month is $${PRICE.intro}, then $${PRICE.monthly}/month; cancel in two clicks and you keep access until the period ends. If you would rather not subscribe, there is a 90-day pass for $${PRICE.quarter}, paid once, with no renewal.`
  const cta = kind === 'lapsed' ? 'Come back and see them' : 'See them now'
  const sign = 'Reply to this email if you have questions; I read every one.\n\nJami\nbackchanneljobs.com'

  const text = [
    intro, '', numbers,
    ...(hasNumbers ? ['', ...lines.map((l) => `- ${l.label}: ${plural(l.n, 'role')}`)] : []),
    '', gap, '', price, '', `${cta}: ${url}`, '', sign, '',
    '--', `You are receiving this because you have a Backchannel account. Unsubscribe: ${unsub}`, address,
  ].join('\n')

  const p = (t: string, extra = '') => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#191713;${extra}">${esc(t)}</p>`
  const html = `<!doctype html><html><body style="margin:0;background:#F5F2EB;font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#191713">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:20px;font-weight:600">backchannel<span style="color:#5C574D;font-weight:400;font-style:italic">.jobs</span></p>
    ${p(intro)}
    ${p(numbers)}
    ${hasNumbers ? `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 18px">${lines.map((l) => `<tr><td style="padding:10px 0;border-bottom:1px solid #E4DED1;font-size:14.5px">${esc(l.label)}</td><td style="padding:10px 0;border-bottom:1px solid #E4DED1;font-size:14.5px;text-align:right;font-weight:600">${plural(l.n, 'role')}</td></tr>`).join('')}</table>` : ''}
    ${p(gap)}
    ${p(price)}
    <p style="margin:22px 0 26px"><a href="${url}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#1B4F82;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${esc(cta)}</a></p>
    <p style="margin:0 0 4px;font-size:14.5px;line-height:1.5;color:#191713">Reply to this email if you have questions; I read every one.</p>
    <p style="margin:0 0 28px;font-size:14.5px;color:#191713">Jami</p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#8A8378">You are receiving this because you have a Backchannel account. <a href="${unsub}" style="color:#8A8378">Unsubscribe</a>.<br>${esc(address)}</p>
  </div></body></html>`

  return {
    subject, html, text,
    headers: { 'List-Unsubscribe': `<${unsub}>, <mailto:${process.env.EMAIL_REPLY_TO || 'unsubscribe@backchanneljobs.com'}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    summary: { total, fresh, lines: lines.length },
  }
}
