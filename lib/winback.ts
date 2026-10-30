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
export function buyToken(userId: string): string {
  return createHmac('sha256', secret()).update(`buy:${userId}`).digest('hex').slice(0, 40)
}
export function validBuyToken(userId: string, token: string): boolean {
  if (!secret() || !token) return false
  const a = Buffer.from(buyToken(userId)); const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}
/** One click from the email to Stripe checkout for the 90-day pass (the route makes the session, then redirects). */
export const quarterUrl = (userId: string, campaign: string) =>
  `${SITE}/api/email-checkout?u=${encodeURIComponent(userId)}&t=${buyToken(userId)}&c=${encodeURIComponent(campaign)}`
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

  // with real matches the button promises "your matched roles", so it opens their matches feed (?mine=1); the roles they
  // tap there lead to /offer with the post itself. With nothing to show it goes straight to the offer page.
  const utm = `utm_source=email&utm_medium=winback&utm_campaign=${encodeURIComponent(campaign)}`
  const url = hasNumbers ? `${SITE}/?mine=1&${utm}` : `${SITE}/offer?src=email&${utm}`
  const unsub = unsubUrl(userId)
  const passUrl = quarterUrl(userId, campaign)
  const endedOn = opts.passEndedAt ? new Date(opts.passEndedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null

  const first = counts.length === 1 ? counts[0] : null
  const subject = kind === 'lapsed'
    ? (hasNumbers ? `Your pass ended. ${plural(total, 'role')} matched your searches since.` : 'Your Backchannel pass ended; here is what is new')
    : hasNumbers
      ? (first ? `${plural(total, cap(first.keyword) + ' role')} in ${place(first.location)} in the last 2 weeks` : `${plural(total, 'role')} matched your searches in the last 2 weeks`)
      : 'Recruiter posts, 48 hours before the free feed'

  const headline = kind === 'lapsed'
    ? (hasNumbers ? 'We kept looking. Here\'s what we found.' : 'Your pass ended. Here\'s what\'s new.')
    : (hasNumbers ? 'Here\'s what your searches found.' : 'Recruiter posts, before the free feed.')
  const intro = kind === 'lapsed'
    ? `Your saved searches continued running after your Backchannel pass${endedOn ? ` ended on ${endedOn}` : ' ended'}. Here's what matched your criteria.`
    : hasNumbers
      ? 'Your saved searches have been running since you signed up. Here\'s what matched your criteria.'
      : 'Backchannel finds roles that recruiters post on LinkedIn before they reach a job board, and checks your searches at least twice a day.'

  const calloutTitle = 'Don\'t let someone else get there first.'
  const calloutB = 'Premium gives you immediate access, recruiter names and direct links to their original posts, so you can reach out before other candidates.'
  const ctaLabel = hasNumbers ? `See your ${total} matched role${total === 1 ? '' : 's'} →` : 'See what Premium shows →'
  const priceLine = `First month $${PRICE.intro} · Then $${PRICE.monthly}/month · Cancel anytime`
  const altLine = `Prefer not to subscribe? Get 90 days of Premium for $${PRICE.quarter}, paid once. No renewal.`
  const questions = 'Questions? Just reply to this email. I read every one.'

  const text = [
    headline, '', intro,
    ...(hasNumbers ? ['', `YOUR LAST 14 DAYS: ${total} matching opportunit${total === 1 ? 'y' : 'ies'}`, `New in the last 48 hours: ${fresh}`, '', 'What your searches found:', ...lines.map((l) => `- ${l.label}: ${plural(l.n, 'role')}`)] : []),
    '', calloutTitle, calloutB, '',
    `${ctaLabel.replace(' →', '')}: ${url}`, priceLine, '',
    `${altLine} ${passUrl}`, '', questions, '', 'Jami', '',
    '--', `You are receiving this because you have a Backchannel account. Unsubscribe: ${unsub}`, address,
  ].join('\n')

  const serif = "Georgia,'Times New Roman',serif"
  const sans = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
  const card = hasNumbers ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFFFFF;border-radius:12px;margin:0 0 24px"><tr><td style="padding:16px 18px">
      <div style="font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:#7A7366;font-weight:600;margin:0 0 6px">Your last 14 days</div>
      <div style="font-size:17px;font-weight:600;color:#191713;margin:0 0 12px"><span style="font-family:${serif};font-size:30px;font-weight:500;margin-right:6px">${total}</span>matching opportunit${total === 1 ? 'y' : 'ies'}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #E4DED1"><tr>
        <td style="padding:12px 0 0;font-size:14.5px;color:#5C574D">New in the last 48 hours</td>
        <td align="right" style="padding:12px 0 0;font-family:${serif};font-size:22px;font-weight:500;color:#24468F">${fresh}</td>
      </tr></table>
    </td></tr></table>
    <h2 style="margin:0 0 6px;font-family:${serif};font-size:19px;font-weight:500;color:#191713">What your searches found</h2>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px">${lines.map((l) => `<tr><td style="padding:11px 0;border-bottom:1px solid #E4DED1;font-size:14.5px;color:#191713">${esc(l.label)}</td><td align="right" style="padding:11px 0;border-bottom:1px solid #E4DED1;font-size:14.5px;font-weight:600;color:#191713;white-space:nowrap">${plural(l.n, 'role')}</td></tr>`).join('')}</table>` : ''

  const html = `<!doctype html><html><body style="margin:0;background:#F5F2EB;font-family:${sans};color:#191713">
  <div style="max-width:560px;margin:0 auto;padding:30px 20px 34px">
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 22px"><tr>
      <td style="padding:0 10px 0 0;vertical-align:middle"><img src="${SITE}/apple-touch-icon.png" width="34" height="34" alt="" style="display:block;border-radius:8px;border:0"></td>
      <td style="vertical-align:middle;font-family:${serif};font-size:22px;font-weight:600;color:#191713">backchannel<span style="color:#5C574D;font-weight:400;font-style:italic">.jobs</span></td>
    </tr></table>
    <h1 style="margin:0 0 10px;font-family:${serif};font-weight:500;font-size:26px;line-height:1.2;color:#191713">${esc(headline)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#5C574D">${esc(intro)}</p>${card}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#E9EDF3;border-radius:12px;margin:0 0 18px"><tr><td style="padding:18px">
      <p style="margin:0 0 8px;font-family:${serif};font-size:18px;font-weight:500;color:#24324D">${esc(calloutTitle)}</p>
      <p style="margin:0;font-size:14.5px;line-height:1.55;color:#4A463D">${esc(calloutB)}</p>
    </td></tr></table>
    <a href="${url}" style="display:block;text-align:center;padding:15px 16px;border-radius:10px;background:#24468F;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:16px">${esc(ctaLabel)}</a>
    <p style="margin:12px 0 18px;text-align:center;font-size:13px;color:#7A7366">${esc(priceLine)}</p>
    <a href="${passUrl}" style="display:block;text-align:center;padding:14px 16px;border-radius:10px;border:1.5px solid #24468F;background:#FFFFFF;color:#24468F;text-decoration:none;font-weight:600;font-size:14.5px;line-height:1.4">${esc(altLine)}</a>
    <div style="border-top:1px solid #E4DED1;margin:26px 0 0;padding:20px 0 0">
      <p style="margin:0 0 4px;font-size:14.5px;line-height:1.5;color:#191713">${esc(questions)}</p>
      <p style="margin:0 0 26px;font-size:14.5px;font-weight:600;color:#191713">Jami</p>
    </div>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#8A8378">You are receiving this because you have a Backchannel account. <a href="${unsub}" style="color:#8A8378">Unsubscribe</a>.<br>${esc(address)}</p>
  </div></body></html>`

  return {
    subject, html, text,
    headers: { 'List-Unsubscribe': `<${unsub}>, <mailto:${process.env.EMAIL_REPLY_TO || 'unsubscribe@backchanneljobs.com'}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    summary: { total, fresh, lines: lines.length },
  }
}
