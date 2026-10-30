// Win-back / "come see what your searches found" email to free and lapsed members.
// Personalised from each member's saved searches, or from what they searched on the site, counted against roles found since their last visit.
// Plain and short on purpose: no countdown timers, no invented scarcity, only numbers we can show.

import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countsSince, jobsWindow, type TargetCount } from './targetStatus'

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
const title = (l: string) => l.split(/\s+/).map(cap).join(' ')
const withPlace = (kw: string, l: string | null) => (l ? `${cap(kw)} · ${title(l)}` : cap(kw))
const plural = (n: number, w: string) => `${fmtCount(n)} ${w}${n === 1 ? '' : 's'}`

export type Built = { subject: string; html: string; text: string; headers: Record<string, string>; summary: { total: number; fresh: number; lines: number; tier: Tier } }

// How much we have to say. Numbers are only shown when they are worth showing:
//   strong (6+ new roles since their last visit): full email with the summary card
//   medium (3-5):                 the list of searches, no big-number card
//   thin   (1-2) / none (0):      nothing worth a headline; the campaign holds these members back by default
export const STRONG_AT = 6
export const MEDIUM_AT = 3
export type Tier = 'strong' | 'medium' | 'thin' | 'none'
export const totalOf = (counts: TargetCount[]) => counts.reduce((s, c) => s + c.exact + c.agency, 0)
export const tierFromTotal = (t: number): Tier => (t >= STRONG_AT ? 'strong' : t >= MEDIUM_AT ? 'medium' : t > 0 ? 'thin' : 'none')
export const tierOf = (counts: TargetCount[]): Tier => tierFromTotal(totalOf(counts))
// "1155 roles" is not a number anyone can act on: show big counts as 200+
export const fmtCount = (n: number) => (n >= 200 ? '200+' : String(n))

export type Source = 'saved' | 'searched'
/** The stretch the numbers cover: since their last visit (date set), or, if they were away longer than we look back, the last N days. */
export type Win = { date: string | null; days: number }
export type MemberData = { counts: TargetCount[]; total: number; fresh: number; source: Source; topTerm: string | null; win: Win; droppedBroad: string[] }
// A search that matches more than this share of ALL roles in the last 30 days ("manager", "analyst") says nothing about what
// the member wants, so it is left out of the email rather than counted.
const BROAD_SHARE = 0.08
const LOOKBACK_DAYS = 30
const FALLBACK_DAYS = 14   // when we cannot tell when they were last here

// Searches that say nothing about a role. Counting them would inflate the numbers ("business" matches half the board).
const VAGUE = new Set(['entry', 'entry level', 'junior', 'senior', 'remote', 'hybrid', 'business', 'science', 'content', 'jobs', 'job', 'work', 'intern', 'internship', 'internships', 'level', 'full time', 'part time'])

type SearchRow = { user_id: string; term: string; locations: unknown; n: number; last_at: string }
const lastLocation = (v: unknown): string | null => {
  const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  return arr.length ? arr[arr.length - 1].trim().toLowerCase() : null   // ["United States","Atlanta"] -> atlanta
}

/** Saved searches for members who have them (paid), otherwise what they searched on the site in the last 60 days. */
export async function memberDataFor(db: Db, ids: string[]): Promise<Map<string, MemberData>> {
  const out = new Map<string, MemberData>()
  const saved = new Map<string, { keyword: string; location: string | null }[]>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('user_targets').select('user_id, keyword, location').in('user_id', chunk).order('created_at').range(from, from + 999)
      for (const r of data ?? []) {
        const list = saved.get(r.user_id as string) ?? []
        list.push({ keyword: r.keyword as string, location: (r.location as string | null) ?? null })
        saved.set(r.user_id as string, list)
      }
      if ((data ?? []).length < 1000) break
    }
  }
  const searchIds = ids.filter((id) => !saved.has(id))
  const searched = new Map<string, { keyword: string; location: string | null }[]>()
  if (searchIds.length) {
    const rows: SearchRow[] = []
    for (let i = 0; i < searchIds.length; i += 100) {
      const { data, error } = await db.rpc('member_searches', { p_ids: searchIds.slice(i, i + 100), p_days: 60 })
      if (error) throw new Error(`member_searches: ${error.message} (did you run supabase/2026-10-30-member-searches.sql?)`)
      rows.push(...((data ?? []) as SearchRow[]))
    }
    rows.sort((a, b) => b.last_at.localeCompare(a.last_at))   // most recent first
    // The site logs a search shortly after each pause in typing, so "customer success" leaves "customer" behind.
    // A term that is the start of a longer term the same member also searched is a fragment: drop it.
    const termsOf = new Map<string, string[]>()
    for (const r of rows) { const l = termsOf.get(r.user_id) ?? []; l.push(r.term.trim()); termsOf.set(r.user_id, l) }
    const isFragment = (uid: string, term: string) => (termsOf.get(uid) ?? []).some((o) => o.length > term.length && o.startsWith(term))
    for (const r of rows) {
      const term = r.term.trim()
      if (term.length < 4 || VAGUE.has(term) || isFragment(r.user_id, term)) continue
      const list = searched.get(r.user_id) ?? []
      if (list.some((t) => t.keyword === term)) continue       // one line per role: its most recent version
      if (list.length >= 4) continue
      list.push({ keyword: term, location: lastLocation(r.locations) })
      searched.set(r.user_id, list)
    }
  }
  // when each member was last here, so the numbers can be "new since your last visit"
  const lastSeen = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.rpc('member_last_seen', { p_ids: ids.slice(i, i + 100) })
    if (error) throw new Error(`member_last_seen: ${error.message} (did you run supabase/2026-10-30-member-last-seen.sql?)`)
    for (const r of (data ?? []) as { user_id: string; last_seen: string }[]) lastSeen.set(r.user_id, r.last_seen)
  }
  const jobs = await jobsWindow(db, LOOKBACK_DAYS)
  const now = Date.now()
  for (const id of ids) {
    const mine = saved.get(id)
    const targets = mine ?? searched.get(id) ?? []
    const seen = lastSeen.get(id)
    const seenMs = seen ? new Date(seen).getTime() : NaN
    let win: Win, sinceIso: string
    if (seen && now - seenMs <= LOOKBACK_DAYS * DAY) {
      win = { date: seen, days: Math.max(1, Math.round((now - seenMs) / DAY)) }; sinceIso = seen
    } else {
      const days = seen ? LOOKBACK_DAYS : FALLBACK_DAYS
      win = { date: null, days }; sinceIso = new Date(now - days * DAY).toISOString()
    }
    // drop searches too broad to mean anything, judged over the whole 30-day window
    const droppedBroad: string[] = []
    let usable = targets
    if (targets.length && jobs.length) {
      const wide = countsSince(jobs, targets, new Date(now - LOOKBACK_DAYS * DAY).toISOString()).counts
      usable = targets.filter((t, i) => {
        const broad = (wide[i].exact + wide[i].agency) / jobs.length > BROAD_SHARE
        if (broad) droppedBroad.push(t.keyword)
        return !broad
      })
    }
    const r = usable.length ? countsSince(jobs, usable, sinceIso) : { counts: [] as TargetCount[], total: 0, fresh: 0 }
    out.set(id, { counts: r.counts, total: r.total, fresh: r.fresh, source: mine ? 'saved' : 'searched', topTerm: usable[0]?.keyword ?? null, win, droppedBroad })
  }
  return out
}

export async function dataFor(db: Db, userId: string): Promise<MemberData> {
  return (await memberDataFor(db, [userId])).get(userId)!
}

export function buildWinback(opts: { kind: Kind; userId: string; campaign: string; counts: TargetCount[]; passEndedAt: string | null; address: string; source?: Source; win?: Win; total?: number; fresh?: number }): Built {
  const { kind, userId, campaign, counts, address } = opts
  const win: Win = opts.win ?? { date: null, days: FALLBACK_DAYS }
  const lastVisit = win.date ? new Date(win.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
  // the stretch the numbers cover, in words
  const sinceText = lastVisit ? `since your last visit on ${lastVisit}` : `in the last ${win.days} days`
  const searched = opts.source === 'searched'   // free member: built from what they searched, not from saved searches
  let lines = counts.map((c) => ({ keyword: c.keyword, label: withPlace(c.keyword, c.location), n: c.exact + c.agency, fresh: c.fresh }))
    .filter((l) => l.n > 0).sort((a, b) => b.n - a.n)
  // a row that says "1 role" next to rows with real numbers just looks thin: show the ones with 2+ when there are any
  if (lines.some((l) => l.n >= 2)) lines = lines.filter((l) => l.n >= 2)
  lines = lines.slice(0, 4)
  const total = opts.total ?? totalOf(counts)
  const fresh = opts.fresh ?? counts.reduce((s, c) => s + c.fresh, 0)
  const tier = tierFromTotal(total)
  const hasNumbers = tier === 'strong' || tier === 'medium'
  const showCard = tier === 'strong'
  const showFresh = fresh >= 2   // "1 new in 48 hours" is not a selling point

  // with real matches the button promises "your matched roles", so it opens their matches feed (?mine=1); the roles they
  // tap there lead to /offer with the post itself. With nothing to show it goes straight to the offer page.
  const utm = `utm_source=email&utm_medium=winback&utm_campaign=${encodeURIComponent(campaign)}`
  const url = !hasNumbers ? `${SITE}/offer?src=email&${utm}`
    : searched ? `${SITE}/?q=${encodeURIComponent(lines[0].keyword)}&${utm}`   // the feed, already searched for their top role
    : `${SITE}/?mine=1&${utm}`
  const unsub = unsubUrl(userId)
  const passUrl = quarterUrl(userId, campaign)
  const endedOn = opts.passEndedAt ? new Date(opts.passEndedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null

  const first = counts.length === 1 ? counts[0] : null
  const subject = kind === 'lapsed'
    ? (hasNumbers ? `Your pass ended. ${plural(total, 'role')} matched your searches ${sinceText}.` : 'Your Backchannel pass ended; here is what is new')
    : hasNumbers
      ? (first ? `${plural(total, cap(first.keyword) + ' role')}${first.location ? ` in ${title(first.location)}` : ''} ${sinceText}` : `${plural(total, 'role')} matched your searches ${sinceText}`)
      : 'Recruiter posts, 48 hours before the free feed'

  const headline = kind === 'lapsed' && !(searched && hasNumbers)
    ? (hasNumbers ? 'We kept looking. Here\'s what we found.' : 'Your pass ended. Here\'s what\'s new.')
    : (hasNumbers ? (searched ? 'New leads based on your search.' : 'Here\'s what your searches found.') : 'Recruiter posts, before the free feed.')
  const intro = kind === 'lapsed' && !(searched && hasNumbers)
    ? `Your saved searches continued running after your Backchannel pass${endedOn ? ` ended on ${endedOn}` : ' ended'}. Here's what matched your criteria.`
    : hasNumbers
      ? (searched
        ? (lastVisit
          ? `Since you last visited Backchannel on ${lastVisit}, here are ${plural(total, 'new role')} that match what you\u2019re looking for.`
          : `Since you\u2019ve been exploring Backchannel, here are ${plural(total, 'new role')} posted in the last ${win.days} days that match what you\u2019re looking for.`)
        : 'Your saved searches have been running since you signed up. Here\'s what matched your criteria.')
      : 'Backchannel finds roles that recruiters post on LinkedIn before they reach a job board, and checks your searches at least twice a day.'

  const introFull = hasNumbers && !showCard && !searched ? `${intro} Your searches matched ${plural(total, 'role')} ${sinceText}${showFresh ? `, ${fresh} of them found in the last 2 days` : ''}.` : intro
  const cardLabel = lastVisit ? 'Since your last visit' : `Last ${win.days} days`
  const calloutTitle = 'Don\'t let someone else get there first.'
  const calloutB = 'Premium gives you immediate access, recruiter names and direct links to their original posts, so you can reach out before other candidates.'
  const ctaLabel = hasNumbers ? `See ${searched ? 'the' : 'your'} ${fmtCount(total)} ${searched ? '' : 'matched '}role${total === 1 ? '' : 's'} →` : 'See what Premium shows →'
  const priceLine = `First month $${PRICE.intro} · Then $${PRICE.monthly}/month · Cancel anytime`
  const altLine = `Prefer not to subscribe? Get 90 days of Premium for $${PRICE.quarter}, paid once. No renewal.`
  const questions = 'Questions? Just reply to this email. I read every one.'

  const text = [
    headline, '', introFull,
    ...(hasNumbers ? ['', ...(showCard ? [`${cardLabel.toUpperCase()}: ${fmtCount(total)} matching opportunities`, ...(showFresh ? [`New in the last 48 hours: ${fresh}`] : []), ''] : []), (searched ? 'Roles like the ones you searched for:' : 'What your searches found:'), ...lines.map((l) => `- ${l.label}: ${plural(l.n, 'role')}`)] : []),
    '', calloutTitle, calloutB, '',
    `${ctaLabel.replace(' →', '')}: ${url}`, priceLine, '',
    `${altLine} ${passUrl}`, '', questions, '', 'Jami', '',
    '--', `You are receiving this because you have a Backchannel account. Unsubscribe: ${unsub}`, address,
  ].join('\n')

  const serif = "Georgia,'Times New Roman',serif"
  const sans = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
  const summaryCard = showCard ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFFFFF;border-radius:12px;margin:0 0 24px"><tr><td style="padding:16px 18px">
      <div style="font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:#7A7366;font-weight:600;margin:0 0 6px">${esc(cardLabel)}</div>
      <div style="font-size:17px;font-weight:600;color:#191713;margin:0 0 12px"><span style="font-family:${serif};font-size:30px;font-weight:500;margin-right:6px">${fmtCount(total)}</span>matching opportunit${total === 1 ? 'y' : 'ies'}</div>
      ${showFresh ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #E4DED1"><tr>
        <td style="padding:12px 0 0;font-size:14.5px;color:#5C574D">New in the last 48 hours</td>
        <td align="right" style="padding:12px 0 0;font-family:${serif};font-size:22px;font-weight:500;color:#24468F">${fresh}</td>
      </tr></table>` : ''}
    </td></tr></table>` : ''
  const list = hasNumbers ? `
    <h2 style="margin:0 0 6px;font-family:${serif};font-size:19px;font-weight:500;color:#191713">${searched ? 'Roles like the ones you searched for' : 'What your searches found'}</h2>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px">${lines.map((l) => `<tr><td style="padding:11px 0;border-bottom:1px solid #E4DED1;font-size:14.5px;color:#191713">${esc(l.label)}</td><td align="right" style="padding:11px 0;border-bottom:1px solid #E4DED1;font-size:14.5px;font-weight:600;color:#191713;white-space:nowrap">${plural(l.n, 'role')}</td></tr>`).join('')}</table>` : ''

  const html = `<!doctype html><html><body style="margin:0;background:#F5F2EB;font-family:${sans};color:#191713">
  <div style="max-width:560px;margin:0 auto;padding:30px 20px 34px">
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 22px"><tr>
      <td style="padding:0 10px 0 0;vertical-align:middle"><img src="${SITE}/apple-touch-icon.png" width="34" height="34" alt="" style="display:block;border-radius:8px;border:0"></td>
      <td style="vertical-align:middle;font-family:${serif};font-size:22px;font-weight:600;color:#191713">backchannel<span style="color:#5C574D;font-weight:400;font-style:italic">.jobs</span></td>
    </tr></table>
    <h1 style="margin:0 0 10px;font-family:${serif};font-weight:500;font-size:26px;line-height:1.2;color:#191713">${esc(headline)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#5C574D">${esc(introFull)}</p>${summaryCard}${list}
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
    summary: { total, fresh, lines: lines.length, tier },
  }
}
