// The weekly market brief: for each paying member, how their saved searches did over the last seven days
// compared with the three weeks before, who is posting, and the newest roles.
//
// No AI and no Apify spend: every number is counted from roles we already hold, and every sentence is a template
// with the numbers filled in. Roles are matched the way the member's feed matches them (keywordMatches / locationMatches).

import type { SupabaseClient } from '@supabase/supabase-js'
import { keywordMatches, locationMatches, titleSearchGroups } from './matchTarget'
import { unsubUrl } from './winback'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const SITE = 'https://www.backchanneljobs.com'
const DAY = 86_400_000
const WEEKS = 4
const MAX_BLOCKS = 3
const TZ = 'America/New_York'

export type BriefRole = { title: string; company: string | null; location: string | null; postedAt: string; url: string | null }
export type TargetBrief = {
  keyword: string
  location: string | null
  weekly: number[]                                 // roles per week, oldest first; the last entry is this week
  direct: number                                   // this week, from direct employers (not agencies)
  fresh48: number                                  // this week, posted in the last 48 hours
  busiestDay: string | null
  companies: { name: string; n: number }[]
  recruiter: { name: string; n: number } | null
  newest: BriefRole[]
}
export type MemberBrief = { targets: TargetBrief[]; distinctThisWeek: number }

/** One key per ISO week, e.g. brief-2026-w45: the dedupe key in email_sends, so a member gets one brief a week. */
export function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = t.getUTCFullYear()
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / DAY + 1) / 7)
  return `brief-${y}-w${String(w).padStart(2, '0')}`
}

// ---------------------------------------------------------------- who gets it

export type BriefRecipient = { id: string; email: string }

/** Paying members who have not unsubscribed and have not been sent this week's brief yet. */
export async function loadBriefRecipients(db: Db, campaign: string): Promise<BriefRecipient[]> {
  const members: BriefRecipient[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('profiles').select('id, email')
      .gt('pass_expires_at', new Date().toISOString()).is('email_unsubscribed_at', null)
      .order('created_at', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(`profiles: ${error.message}`)
    members.push(...((data ?? []) as BriefRecipient[]))
    if ((data ?? []).length < 1000) break
  }
  const done = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('email_sends').select('user_id').eq('campaign', campaign).range(from, from + 999)
    if (error) throw new Error(`email_sends: ${error.message}`)
    for (const r of data ?? []) done.add(String(r.user_id))
    if ((data ?? []).length < 1000) break
  }
  return members.filter((m) => m.email && !done.has(m.id))
}

// ---------------------------------------------------------------- the numbers

const COLS = 'id, title, company, location, work_type, posted_at, extracted_at, post_url, author_name, employer_type'

/** Roles of the last four weeks whose title could match this keyword (a title prefilter in the database; keywordMatches then decides). */
async function rolesForKeyword(db: Db, keyword: string, since: string): Promise<Row[]> {
  const groups = titleSearchGroups(keyword)
  if (!groups) return []
  const out: Row[] = []
  for (let from = 0; from < 5000; from += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from('jobs').select(COLS)
      .eq('is_verified_job', true)
      .or(`posted_at.gte.${since},and(posted_at.is.null,extracted_at.gte.${since})`)
      .or('quality.is.null,quality.neq.low')
    for (const g of groups) q = q.or(g.map((x) => `title.ilike."%${x}%"`).join(','))
    const { data, error } = await q.order('posted_at', { ascending: false }).range(from, from + 999)
    if (error) throw new Error(`jobs: ${error.message}`)
    out.push(...((data ?? []) as Row[]))
    if ((data ?? []).length < 1000) break
  }
  return out
}

const weekdayOf = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TZ }).format(new Date(iso))

/** Each member's briefs, one per saved search that had roles in the last two weeks. A search shared by several members is counted once. */
export async function briefsFor(db: Db, userIds: string[]): Promise<Map<string, MemberBrief>> {
  const now = Date.now()
  const since = new Date(now - WEEKS * 7 * DAY).toISOString()
  const targets: { user_id: string; keyword: string; location: string | null }[] = []
  for (let i = 0; i < userIds.length; i += 100) {
    const { data, error } = await db.from('user_targets').select('user_id, keyword, location, created_at')
      .in('user_id', userIds.slice(i, i + 100)).order('created_at', { ascending: true })
    if (error) throw new Error(`user_targets: ${error.message}`)
    targets.push(...((data ?? []) as typeof targets))
  }
  const keywords = [...new Set(targets.map((t) => t.keyword))]
  const byKeyword = new Map<string, Row[]>()
  for (let i = 0; i < keywords.length; i += 6) {
    await Promise.all(keywords.slice(i, i + 6).map(async (k) => { byKeyword.set(k, await rolesForKeyword(db, k, since)) }))
  }

  const cache = new Map<string, { brief: TargetBrief; ids: Set<string> }>()
  const compute = (keyword: string, location: string | null) => {
    const key = `${keyword}|${location ?? ''}`
    const hit = cache.get(key)
    if (hit) return hit
    const weekly = Array<number>(WEEKS).fill(0)
    const mine: { r: Row; when: number }[] = []
    for (const r of byKeyword.get(keyword) ?? []) {
      if (!keywordMatches(keyword, r.title ?? '', null)) continue
      if (!locationMatches(location, r.location ?? null, r.work_type ?? null)) continue
      const when = Date.parse(r.posted_at ?? r.extracted_at)
      if (!Number.isFinite(when) || when > now) continue
      const idx = Math.floor((now - when) / (7 * DAY))
      if (idx >= WEEKS) continue
      weekly[WEEKS - 1 - idx]++
      if (idx === 0) mine.push({ r, when })
    }
    mine.sort((a, b) => b.when - a.when)
    const companies = new Map<string, number>(), recruiters = new Map<string, number>(), days = new Map<string, number>()
    for (const { r } of mine) {
      const c = String(r.company ?? '').trim(); if (c) companies.set(c, (companies.get(c) ?? 0) + 1)
      const a = String(r.author_name ?? '').trim(); if (a) recruiters.set(a, (recruiters.get(a) ?? 0) + 1)
      const d = weekdayOf(r.posted_at ?? r.extracted_at); days.set(d, (days.get(d) ?? 0) + 1)
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    const topDay = top(days, 1)[0]
    const topRec = top(recruiters, 1)[0]
    const brief: TargetBrief = {
      keyword, location, weekly,
      direct: mine.filter(({ r }) => r.employer_type !== 'agency').length,
      fresh48: mine.filter(({ when }) => when >= now - 2 * DAY).length,
      busiestDay: mine.length >= 3 && topDay && topDay[1] >= 2 ? topDay[0] : null,
      companies: top(companies, 3).map(([name, n]) => ({ name, n })),
      recruiter: topRec && topRec[1] >= 2 ? { name: topRec[0], n: topRec[1] } : null,
      newest: mine.slice(0, 3).map(({ r }) => ({ title: String(r.title ?? ''), company: r.company ?? null, location: r.location ?? null, postedAt: r.posted_at ?? r.extracted_at, url: r.post_url ?? null })),
    }
    const entry = { brief, ids: new Set(mine.map(({ r }) => String(r.id))) }
    cache.set(key, entry)
    return entry
  }

  const out = new Map<string, MemberBrief>()
  for (const t of targets) {
    const { brief, ids } = compute(t.keyword, t.location ?? null)
    const cur = out.get(t.user_id) ?? { targets: [], distinctThisWeek: 0 }
    // one search listed twice (same role and place) is shown once
    if (!cur.targets.some((x) => x.keyword === brief.keyword && x.location === brief.location)) {
      const seen = ((cur as MemberBrief & { _ids?: Set<string> })._ids ??= new Set<string>())
      for (const id of ids) seen.add(id)
      cur.distinctThisWeek = seen.size
      // a search with nothing this week and nothing last week has nothing to say
      if ((brief.weekly[WEEKS - 1] ?? 0) + (brief.weekly[WEEKS - 2] ?? 0) > 0) cur.targets.push(brief)
    }
    out.set(t.user_id, cur)
  }
  for (const [id, m] of out) { delete (m as MemberBrief & { _ids?: Set<string> })._ids; if (!m.targets.length) out.delete(id) }
  return out
}

// ---------------------------------------------------------------- the email

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const place = (l: string | null) => (l ? cap(l) : 'Anywhere')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dateLabel = (ms: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: TZ }).format(new Date(ms))
const ago = (iso: string) => {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000))
  return h < 1 ? 'just now' : h < 24 ? `${h} hour${h === 1 ? '' : 's'} ago` : h < 48 ? 'yesterday' : `${Math.floor(h / 24)} days ago`
}

/** The one-line comparison with last week, from the four weekly counts. */
function trendLine(weekly: number[]): string {
  const now = weekly[WEEKS - 1], last = weekly[WEEKS - 2]
  const earlier = Math.max(...weekly.slice(0, WEEKS - 1))
  const base = now > last ? (last === 0 ? 'None the week before.' : `Up from ${last} last week.`)
    : now < last ? `Down from ${last} last week.` : `The same as last week.`
  if (now > 0 && now > earlier) return `${base} The busiest week in the last four.`
  if (now > 0 && now < earlier && now < last) return `${base} A quieter week than usual.`
  return base
}

const sans = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
const serif = "Georgia,'Times New Roman',serif"

function blockHtml(t: TargetBrief, roleCount: number): string {
  const now = t.weekly[WEEKS - 1]
  const max = Math.max(1, ...t.weekly)
  const labels = ['3 wks ago', '2 wks ago', 'Last week', 'This week']
  const bars = t.weekly.map((v, i) => {
    const cur = i === WEEKS - 1
    const h = Math.max(4, Math.round(70 * v / max))
    return `<td width="25%" valign="bottom" align="center" style="font-size:12px;color:#5C574D"><div style="font-weight:${cur ? 700 : 600};color:${cur ? '#1B4F82' : '#191713'}">${v}</div><div style="height:${h}px;background:${cur ? '#1B4F82' : '#D8D2C2'};border-radius:4px 4px 0 0;margin:4px 8px 0"></div></td>`
  }).join('')
  const barLabels = labels.map((l, i) => `<td align="center" style="font-size:11px;color:${i === WEEKS - 1 ? '#1B4F82' : '#7A7366'};${i === WEEKS - 1 ? 'font-weight:600;' : ''}padding-top:6px;border-top:1px solid #D8D2C2">${l}</td>`).join('')

  const facts: [string, string][] = []
  if (now > 0) facts.push([`${t.direct} of ${now}`, 'from direct employers'])
  if (t.busiestDay) facts.push([t.busiestDay, 'busiest posting day'])
  if (now > 0) facts.push([`${t.fresh48} of ${now}`, 'posted in the last 48 hours'])
  const factsHtml = facts.length ? `<tr><td style="padding:16px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EB;border-radius:10px"><tr>${facts.map(([v, l], i) =>
    `<td style="padding:14px 12px;${i > 0 ? 'border-left:1px solid #D8D2C2;' : ''}"><div style="font-size:19px;font-weight:600;color:#191713">${esc(v)}</div><div style="font-size:12px;color:#5C574D;margin-top:2px">${esc(l)}</div></td>`).join('')}</tr></table></td></tr>` : ''

  const top = t.companies[0]?.n ?? 0
  const companiesHtml = t.companies.length ? `<tr><td style="padding:20px 0 0"><div style="font-family:${serif};font-size:17px;font-weight:600;color:#191713">${top >= 2 ? 'Who posted the most' : 'Companies hiring'}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;font-size:14px">${t.companies.map((c, i) =>
      `<tr><td style="padding:9px 0;${i < t.companies.length - 1 || t.recruiter ? 'border-bottom:1px solid #E4DFD2;' : ''}color:#191713">${esc(c.name)}</td><td align="right" style="padding:9px 0;${i < t.companies.length - 1 || t.recruiter ? 'border-bottom:1px solid #E4DFD2;' : ''}color:#5C574D">${top >= 2 ? plural(c.n, 'role') : ''}</td></tr>`).join('')}
      ${t.recruiter ? `<tr><td colspan="2" style="padding:9px 0;color:#5C574D;font-size:13.5px">Most active recruiter: ${esc(t.recruiter.name)}, ${plural(t.recruiter.n, 'post')} this week</td></tr>` : ''}
    </table></td></tr>` : ''

  const newest = t.newest.slice(0, roleCount)
  const rolesHtml = newest.length ? `<tr><td style="padding:20px 0 0"><div style="font-family:${serif};font-size:17px;font-weight:600;color:#191713">Newest roles</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">${newest.map((r, i) =>
      `<tr><td style="padding:11px 0;${i < newest.length - 1 ? 'border-bottom:1px solid #E4DFD2;' : ''}"><div style="font-size:14px;font-weight:600;color:#191713">${esc(r.title)}</div>
        <div style="font-size:12.5px;color:#5C574D;margin-top:2px">${esc([r.company, r.location, `posted ${ago(r.postedAt)}`].filter(Boolean).join(' · '))}</div>
        ${r.url ? `<a href="${esc(r.url)}" style="display:inline-block;margin-top:5px;font-size:13px;color:#1B4F82;font-weight:600;text-decoration:none">View the post &rarr;</a>` : ''}</td></tr>`).join('')}
    </table></td></tr>` : ''

  return `<tr><td style="padding:26px 28px 6px;border-top:1px solid #E4DFD2">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1B4F82;font-weight:600">${esc(cap(t.keyword))} &middot; ${esc(place(t.location))}</div>
    <div style="font-family:${serif};font-size:26px;line-height:1.2;color:#191713;margin-top:8px"><span style="color:#1B4F82">${now}</span> new ${now === 1 ? 'role' : 'roles'} this week.</div>
    <div style="font-size:14px;color:#5C574D;margin-top:6px;line-height:1.5">${esc(trendLine(t.weekly))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>${bars}</tr><tr>${barLabels}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${factsHtml}${companiesHtml}${rolesHtml}</table>
  </td></tr>`
}

export function buildBrief(args: { userId: string; brief: MemberBrief; address: string }) {
  const { userId, brief, address } = args
  const now = Date.now()
  const range = `${dateLabel(now - 7 * DAY)} – ${dateLabel(now)}`
  const sorted = [...brief.targets].sort((a, b) => b.weekly[WEEKS - 1] - a.weekly[WEEKS - 1])
  const shown = sorted.slice(0, MAX_BLOCKS)
  const rest = sorted.slice(MAX_BLOCKS)
  const roleCount = shown.length > 1 ? 2 : 3
  const total = brief.distinctThisWeek
  const only = brief.targets.length === 1 ? brief.targets[0] : null
  const subject = only
    ? `${plural(total, 'new role')} for ${only.keyword.length > 40 ? only.keyword.slice(0, 40) + '…' : only.keyword} this week`
    : `Your weekly brief: ${plural(total, 'new role')} across your searches`
  const unsub = unsubUrl(userId)
  const feed = `${SITE}/?mine=1`
  const tracked = brief.targets.map((t) => `${cap(t.keyword)} in ${place(t.location)}`)

  const text = [
    `Your weekly market brief, ${range}`,
    '',
    ...shown.flatMap((t) => [
      `${cap(t.keyword)} · ${place(t.location)}: ${plural(t.weekly[WEEKS - 1], 'new role')} this week. ${trendLine(t.weekly)}`,
      `Last four weeks: ${t.weekly.join(', ')}`,
      ...(t.companies.length ? [`Most posts: ${t.companies.map((c) => `${c.name} (${c.n})`).join(', ')}`] : []),
      ...t.newest.slice(0, roleCount).map((r) => `- ${r.title}${r.company ? `, ${r.company}` : ''}${r.url ? `: ${r.url}` : ''}`),
      '',
    ]),
    ...(rest.length ? [`Also tracking: ${rest.map((t) => `${cap(t.keyword)} (${t.weekly[WEEKS - 1]})`).join(', ')}`, ''] : []),
    `See everything in your feed: ${feed}`,
    '',
    `Unsubscribe: ${unsub}`,
    address,
  ].join('\n')

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#E9E5DA;font-family:${sans};color:#191713">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:18px 0 32px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FDFCFA;border:1px solid #D8D2C2;border-radius:14px;overflow:hidden">
  <tr><td style="padding:24px 28px 14px">
    <div style="font-family:${serif};font-size:22px;font-weight:600;letter-spacing:-0.01em">backchannel<span style="color:#7A7366;font-weight:400">.jobs</span></div>
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5C574D;margin-top:12px;font-weight:600">Your weekly market brief &middot; ${esc(range)}</div>
  </td></tr>
  ${shown.map((t) => blockHtml(t, roleCount)).join('\n')}
  ${rest.length ? `<tr><td style="padding:14px 28px 4px;border-top:1px solid #E4DFD2;font-size:13.5px;color:#5C574D;line-height:1.5">Also tracking: ${esc(rest.map((t) => `${cap(t.keyword)} (${t.weekly[WEEKS - 1]} this week)`).join(' · '))}</td></tr>` : ''}
  <tr><td align="center" style="padding:22px 28px 12px"><a href="${feed}" style="display:inline-block;background:#1B4F82;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px">See everything in your feed &rarr;</a></td></tr>
  <tr><td style="padding:18px 28px 26px;font-size:12px;color:#7A7366;line-height:1.6;border-top:1px solid #E4DFD2">
    You get this because you track ${esc(tracked.slice(0, 3).join(', '))}${tracked.length > 3 ? ` and ${tracked.length - 3} more` : ''}. Change your searches in your feed settings.<br>
    <a href="${unsub}" style="color:#7A7366;text-decoration:underline">Unsubscribe from weekly briefs</a><br>${esc(address)}
  </td></tr>
</table></td></tr></table></body></html>`

  return {
    subject, html, text,
    headers: { 'List-Unsubscribe': `<${unsub}>, <mailto:${process.env.EMAIL_REPLY_TO || 'unsubscribe@backchanneljobs.com'}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    summary: { blocks: shown.length, distinctThisWeek: total },
  }
}
