'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DATASETS } from '@/lib/analyticsDatasets'
import { Chart, ChartCard, CHART_CSS, COLORS, Funnel, Heatmap, HBars, Tile, fmtUsd, weekOverWeek, type ChartRow, type Series } from './charts'
import { WEEKDAYS, WEEKDAYS_LONG, clock, hh, rebase, summarise, timingOf, tzOffsetHours } from './timing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any
type Tab = 'members' | 'growth' | 'demand' | 'engagement' | 'supply'

const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayTip = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const ago = (iso: string | null) => {
  if (!iso) return '—'
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
const secs = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)
const dur = (min: number) => (min < 1 ? 'under a minute' : min < 60 ? `${min} min` : min < 1440 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} days`)

/** daily rows -> chart rows (numbers only; anything missing is 0) */
const dayRows = (days: Data[], keys: string[]): ChartRow[] =>
  days.map((r) => ({ x: fmtDay(r.day), tip: dayTip(r.day), v: Object.fromEntries(keys.map((k) => [k, Number(r[k]) || 0])) }))
const one = (key: string, label: string, color: string): Series[] => [{ key, label, color }]

const getJson = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`)
  return r.json()
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [growth, setGrowth] = useState<Data | null>(null)
  const [gErr, setGErr] = useState<string | null>(null)
  const [gBusy, setGBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('members')
  const [win, setWin] = useState<'d7' | 'd30' | 'd90'>('d30')
  const [seg, setSeg] = useState<'all' | 'members' | 'free'>('all')
  const [ySort, setYSort] = useState<'spend' | 'yield'>('spend')
  const [memberSort, setMemberSort] = useState<'time' | 'newest'>('time')

  useEffect(() => {
    getJson('/api/analytics').then(setData).catch((e) => setErr(e.message))
  }, [])

  // growth reads 90 days of visits, so it loads the first time its tab opens
  const open = (t: Tab) => {
    setTab(t)
    if (t === 'growth' && !growth && !gBusy) {
      setGBusy(true)
      getJson('/api/analytics?panel=growth').then((j) => setGrowth(j.growth)).catch((e) => setGErr(e.message)).finally(() => setGBusy(false))
    }
  }

  const M = data?.members, D = data?.demand, E = data?.engagement, S = data?.supply
  const d = D?.[win]?.[seg]
  // 'time' = the server's order (active first, most time left); 'newest' = most recently joined first
  const members: Data[] = M ? (memberSort === 'newest'
    ? [...M.members].sort((a: Data, b: Data) => String(b.joinedAt ?? '').localeCompare(String(a.joinedAt ?? '')))
    : M.members) : []

  return (
    <div className="an-page">
      <style>{CSS}{CHART_CSS}</style>
      <div className="an-mast">
        <div className="an-mast-in">
          <Link className="an-wordmark" href="/" aria-label="backchannel.jobs home"><span className="an-mark">B</span><span>backchannel<em>.jobs</em></span></Link>
          <span className="an-badge">Internal · Analytics</span>
          <Link className="an-mast-link" href="/">Open the site &rarr;</Link>
        </div>
      </div>
    <div className="an">
      <header className="an-head">
        <div>
          <h1>Analytics</h1>
          <p className="an-sub">{data ? `Generated ${ago(data.generatedAt)} · reload for fresh numbers` : err ? `Couldn't load: ${err}` : 'Loading…'}</p>
        </div>
        <div className="an-tools">
          <nav className="an-tabs" aria-label="Panels">
            {(['members', 'growth', 'demand', 'engagement', 'supply'] as const).map((t) => (
              <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => open(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </nav>
          <details className="an-export">
            <summary className="an-btn primary">Export data ▾</summary>
            <div className="an-export-menu">
              <a href="/api/analytics/export?dataset=all" download>Everything (.zip)<span>All {Object.keys(DATASETS).length} files below plus a README. Times are UTC.</span></a>
              <hr />
              {Object.entries(DATASETS).map(([k, desc]) => <a key={k} href={`/api/analytics/export?dataset=${k}`} download>{k}.csv<span>{desc}</span></a>)}
            </div>
          </details>
        </div>
      </header>

      {!data && !err && <div className="an-card an-muted">Pulling the last 30 to 90 days from the database…</div>}

      {/* ------------------------------------------------ members */}
      {tab === 'members' && M && (
        <section className="an-grid">
          <div className="an-tiles">
            <div className="an-tile"><b>{M.active}</b><span>active members</span></div>
            <div className="an-tile"><b>${M.avgApifyUsd30}</b><span>average Apify cost per active member, last 30 days (their own searches, shared ones split)</span></div>
            <div className="an-tile"><b>{M.expiring7.length}</b><span>expire within 7 days</span></div>
            <div className="an-tile"><b>{M.members.reduce((s: number, m: Data) => s + m.flags, 0)}</b><span>target problems · stale = no run in 2 days (5 for slow-lane queries)</span></div>
          </div>
          {M.expiring7.length > 0 && (
            <div className="an-card an-warn">
              <b>Expiring soon:</b> {M.expiring7.map((m: Data) => `${m.email} (${m.daysLeft}d)`).join(' · ')}
            </div>
          )}
          <div className="an-seg" role="group" aria-label="Sort members">
            <span className="an-muted-inline" style={{ marginRight: 8 }}>Sort by</span>
            <button type="button" className={memberSort === 'time' ? 'on' : ''} onClick={() => setMemberSort('time')}>time left</button>
            <button type="button" className={memberSort === 'newest' ? 'on' : ''} onClick={() => setMemberSort('newest')}>newest member</button>
          </div>
          <div className="an-cols">
            <ChartCard title="Time left on each pass" sub="Days until access ends. Orange = a week or less." csv="members-days-left"
              rows={members.filter((m: Data) => m.active).map((m: Data) => ({ member: m.email, plan: m.plan, days_left: m.daysLeft }))}>
              <HBars rows={members.filter((m: Data) => m.active).map((m: Data) => ({ label: m.email, value: m.daysLeft, color: m.daysLeft <= 7 ? COLORS.orange : COLORS.blue }))} format={(n) => `${n}d`} empty="No active members" />
            </ChartCard>
            <ChartCard title="Roles in each member’s feed, last 14 days" sub="Direct-employer roles that fit a target’s role and place, each counted once, the same way the member’s own feed counts them. Agency roles and same-role-elsewhere are in the table view. A short bar is a member at risk of cancelling." csv="members-feed-14d"
              rows={members.filter((m: Data) => m.active).map((m: Data) => ({ member: m.email, direct_exact: m.feed.exact, via_agencies: m.feed.agency, same_role_elsewhere: m.feed.rough, different_roles_7d: m.exact7, target_problems: m.flags }))}>
              <HBars rows={members.filter((m: Data) => m.active).map((m: Data) => ({ label: m.email, value: m.feed.exact, note: `+${m.feed.agency} agency, +${m.feed.rough} elsewhere`, color: m.feed.exact < 10 ? COLORS.orange : COLORS.blue }))} empty="No active members" />
            </ChartCard>
          </div>
          {members.map((m: Data) => (
            <article key={m.email} className={`an-card an-member ${m.active ? '' : 'lapsed'}`}>
              <div className="an-member-head">
                <div>
                  <b>{m.email}</b>
                  <span className="an-meta">
                    {m.joinedAt ? `joined ${ago(m.joinedAt)} · ` : ''}Apify ${m.apifyUsd30} / 30d ({m.queryCount} searches) · {m.plan ?? 'no payment'} · {m.payments} payment{m.payments === 1 ? '' : 's'} · {m.active ? `${m.daysLeft} days left` : `lapsed ${-m.daysLeft}d ago`} · last visit {ago(m.lastVisit)}{m.device ? ` · ${m.device}` : ''}
                  </span>
                </div>
                <div className="an-member-sum"><b>{m.feed.exact}</b><span>in their feed, 14d · +{m.feed.agency} via agencies · +{m.feed.rough} same role elsewhere</span></div>
              </div>
              {m.targets.length === 0 ? <p className="an-muted">No targets saved.</p> : (
                <table>
                  <thead><tr><th>Role</th><th>Location</th><th className="num">Exact 7d</th><th className="num">Exact 14d</th><th className="num">Agency 14d</th><th className="num">Anywhere 14d</th><th>Query</th><th>Last run</th></tr></thead>
                  <tbody>
                    {m.targets.map((t: Data, i: number) => (
                      <tr key={i} className={t.flag ? 'flag' : ''}>
                        <td>{t.keyword}</td><td>{t.location || 'anywhere'}</td>
                        <td className="num">{t.exact7}</td><td className="num">{t.exact14}</td><td className="num">{t.agency14}</td><td className="num">{t.anywhere14}</td>
                        <td className="mono">{t.query ?? '—'}</td>
                        <td>{t.flag ? <span className="an-flag">{t.flag}</span> : <>{ago(t.lastRunAt)}{t.slowLane && <span className="an-lane" title="Last two runs kept at most one job; runs every 4 days instead of every 12 hours">slow lane</span>}</>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {m.widened?.length > 0 ? (
                <p className="an-widened"><b>Also running for their regions:</b> {m.widened.map((w: Data, i: number) => (
                  <span key={w.query}>{i > 0 && ' · '}<span className="mono">{w.query}</span> <span className={w.stale ? 'an-flag' : 'an-muted-inline'}>{w.active ? ago(w.lastRunAt) : 'inactive'}</span></span>
                ))}</p>
              ) : m.widenedMissing ? (
                <p className="an-widened an-warn-text">No wider-area queries behind this member&apos;s cities — their fallback matches rely on the shared sweep only.</p>
              ) : null}
            </article>
          ))}
        </section>
      )}

      {/* ------------------------------------------------ growth */}
      {tab === 'growth' && !growth && <div className="an-card an-muted">{gErr ? `Couldn't load growth: ${gErr}` : 'Reading 90 days of visits, accounts and checkouts…'}</div>}
      {tab === 'growth' && growth && data && <Growth G={growth} generatedAt={data.generatedAt} />}

      {/* ------------------------------------------------ demand */}
      {tab === 'demand' && D && (
        <section className="an-grid">
          <div className="an-controls">
            <div className="an-seg">{(['d7', 'd30', 'd90'] as const).map((w) => <button key={w} type="button" className={win === w ? 'on' : ''} onClick={() => setWin(w)}>{w.slice(1)} days</button>)}</div>
            <div className="an-seg">{(['all', 'members', 'free'] as const).map((s) => <button key={s} type="button" className={seg === s ? 'on' : ''} onClick={() => setSeg(s)}>{s}</button>)}</div>
          </div>
          <div className="an-tiles">
            <Tile value={d.searches} label="searches" spark={d.days.map((r: Data) => r.searches)} />
            <Tile value={d.visitors} label="people searching" spark={d.days.map((r: Data) => r.people)} />
            <Tile value={`${d.zeroShare}%`} label="returned nothing" spark={d.days.map((r: Data) => r.zero)} />
          </div>
          <ChartCard title="Searches per day" sub="Blue found something; orange returned nothing. A tall orange bar is demand the feed doesn’t cover." csv={`searches-per-day-${win}-${seg}`}
            rows={d.days.map((r: Data) => ({ day: r.day, searches: r.searches, no_results: r.zero, people: r.people }))}
            legend={[{ key: 'found', label: 'Found something', color: COLORS.blue }, { key: 'zero', label: 'Returned nothing', color: COLORS.orange }]}>
            <Chart kind="stacked" label="Searches per day" rows={d.days.map((r: Data) => ({ x: fmtDay(r.day), tip: dayTip(r.day), v: { found: r.searches - r.zero, zero: r.zero } }))}
              series={[{ key: 'found', label: 'Found something', color: COLORS.blue }, { key: 'zero', label: 'Returned nothing', color: COLORS.orange }]} />
          </ChartCard>
          <div className="an-cols">
            <ChartCard title="Roles searched" csv={`roles-searched-${win}-${seg}`} rows={d.terms.map((t: Data) => ({ term: t.key, people: t.count }))}>
              <HBars rows={d.terms.map((t: Data) => ({ label: t.key, value: t.count }))} />
            </ChartCard>
            <ChartCard title="Locations filtered" csv={`locations-filtered-${win}-${seg}`} rows={d.locations.map((t: Data) => ({ location: t.key, searches: t.count }))}>
              <HBars rows={d.locations.map((t: Data) => ({ label: t.key, value: t.count }))} color={COLORS.aqua} />
            </ChartCard>
            <ChartCard title="Searches with no results" csv={`no-results-${win}-${seg}`} rows={d.zeroResult.map((t: Data) => ({ term: t.key, searches: t.count }))}>
              <HBars rows={d.zeroResult.map((t: Data) => ({ label: t.key, value: t.count }))} color={COLORS.orange} empty="None" />
            </ChartCard>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ engagement */}
      {tab === 'engagement' && E && (
        <section className="an-grid">
          <div className="an-tiles">
            <Tile value={E.visitors} label="visitors, 30d" spark={E.days.map((r: Data) => r.visitors)} delta={weekOverWeek(E.days.map((r: Data) => r.visitors))} />
            <Tile value={`${E.returningShare}%`} label="came back on another day" />
            <Tile value={secs(E.time.all.medianSec)} label={`median active time · mean ${secs(E.time.all.meanSec)}`} />
            <Tile value={secs(E.time.members.medianSec)} label={`members’ median · free ${secs(E.time.free.medianSec)}`} />
          </div>
          <ChartCard title="Visitors, searchers and job-clickers per day" csv="engagement-daily" rows={E.days}
            sub={`Active time is first to last recorded event in a visit (page loads, searches, job clicks); a single page load counts as 0s, which is ${E.time.all.bounced}% of visits.`}
            legend={[{ key: 'visitors', label: 'Visitors', color: COLORS.blue }, { key: 'searched', label: 'Searched', color: COLORS.orange }, { key: 'clicked', label: 'Clicked a job', color: COLORS.aqua }]}>
            <Chart kind="line" area label="Visitors, searchers and job-clickers per day" rows={dayRows(E.days, ['visitors', 'searched', 'clicked'])}
              series={[{ key: 'visitors', label: 'Visitors', color: COLORS.blue }, { key: 'searched', label: 'Searched', color: COLORS.orange }, { key: 'clicked', label: 'Clicked a job', color: COLORS.aqua }]} />
          </ChartCard>
          <div className="an-cols">
            <ChartCard title="Funnel, 30 days" csv="funnel-30d"
              rows={[['Visitors', E.funnel.visitors], ['Searched', E.funnel.searched], ['Clicked a job', E.funnel.clickedJob], ['Started checkout', E.funnel.checkoutStarted], ['Paid', E.funnel.paid]].map(([step, people]) => ({ step, people }))}>
              <Funnel steps={[{ label: 'Visitors', value: E.funnel.visitors }, { label: 'Searched', value: E.funnel.searched }, { label: 'Clicked a job', value: E.funnel.clickedJob }, { label: 'Started checkout', value: E.funnel.checkoutStarted }, { label: 'Paid', value: E.funnel.paid }]} />
            </ChartCard>
            <ChartCard title="Where visits came from" csv="referrers-30d" rows={E.referrers.map((t: Data) => ({ referrer: t.key, visits: t.count }))}>
              <HBars rows={E.referrers.map((t: Data) => ({ label: t.key, value: t.count }))} />
            </ChartCard>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ supply */}
      {tab === 'supply' && S && (
        <section className="an-grid">
          <div className="an-tiles">
            <div className="an-tile"><b>${S.budget.spentUsd.toFixed(2)}</b><span>Apify this cycle · target ${S.budget.targetUsd.toFixed(0)} · day {S.budget.dayOfCycle}/{S.budget.daysInCycle}</span></div>
            <div className="an-tile"><b>{S.budget.mode}</b><span>governor mode · pace ${S.budget.paceUsd.toFixed(2)}</span></div>
            <div className="an-tile"><b>{S.haikuDays.at(-1)?.calls ?? 0}</b><span>classifier calls yesterday/today · ≈${S.haikuDays.at(-1)?.usd ?? 0}</span></div>
          </div>
          <ChartCard title="Posts bought per day, 30 days" csv="supply-daily" rows={S.days}
            sub="Each bar is one day’s purchase. The blue part became roles; grey was already seen; orange was rejected by the classifier."
            legend={[{ key: 'kept', label: 'Kept', color: COLORS.blue }, { key: 'dup', label: 'Repeats', color: COLORS.grey }, { key: 'rejected', label: 'Rejected', color: COLORS.orange }, { key: 'other', label: 'Other', color: COLORS.pale }]}>
            <Chart kind="stacked" label="Posts bought per day" rows={S.days.map((r: Data) => ({ x: fmtDay(r.day), tip: dayTip(r.day), v: { kept: r.kept, dup: r.dup, rejected: r.rejected, other: Math.max(0, r.posts - r.kept - r.dup - r.rejected) } }))}
              series={[{ key: 'kept', label: 'Kept', color: COLORS.blue }, { key: 'dup', label: 'Repeats', color: COLORS.grey }, { key: 'rejected', label: 'Rejected', color: COLORS.orange }, { key: 'other', label: 'Other', color: COLORS.pale }]} />
            <table className="an-compact">
              <thead><tr><th>Day</th><th className="num">Posts</th><th className="num">Kept</th><th className="num">Repeats</th><th className="num">Rejected</th><th className="num">$</th></tr></thead>
              <tbody>{[...S.days].reverse().slice(0, 10).map((r: Data) => <tr key={r.day}><td>{fmtDay(r.day)}</td><td className="num">{r.posts}</td><td className="num">{r.kept}</td><td className="num">{r.dup}</td><td className="num">{r.rejected}</td><td className="num">{r.usd.toFixed(2)}</td></tr>)}</tbody>
            </table>
          </ChartCard>
          <div className="an-cols">
            <ChartCard title="Apify spend per day" sub="Posts bought × cost per post." csv="apify-spend-daily" rows={S.days.map((r: Data) => ({ day: r.day, usd: r.usd, posts: r.posts }))}>
              <Chart label="Apify spend per day" rows={dayRows(S.days, ['usd'])} series={one('usd', 'Spend', COLORS.blue)} avg valueFmt={(n) => `$${n.toFixed(2)}`} />
            </ChartCard>
            <ChartCard title="Classifier calls per day" sub="Model calls only; the prefilter and gate are free." csv="classifier-calls-daily" rows={S.haikuDays}>
              <Chart label="Classifier calls per day" rows={S.haikuDays.map((r: Data) => ({ x: fmtDay(r.day), tip: dayTip(r.day), v: { calls: r.calls } }))} series={one('calls', 'Calls', COLORS.blue)} avg />
            </ChartCard>
          </div>
          <div className="an-cols">
            <ChartCard title="Roles added per day: direct vs agency" csv="job-mix-daily" rows={S.jobDays}
              legend={[{ key: 'direct', label: 'Direct employer', color: COLORS.blue }, { key: 'agency', label: 'Agency', color: COLORS.orange }]}>
              <Chart kind="stacked" label="Roles added per day, direct and agency" rows={dayRows(S.jobDays, ['direct', 'agency'])}
                series={[{ key: 'direct', label: 'Direct employer', color: COLORS.blue }, { key: 'agency', label: 'Agency', color: COLORS.orange }]} />
            </ChartCard>
            <ChartCard title="Roles added by sector, 30 days" csv="roles-by-sector" rows={S.sectors.map((t: Data) => ({ sector: t.key, roles: t.count }))}>
              <HBars rows={S.sectors.map((t: Data) => ({ label: t.key, value: t.count }))} />
            </ChartCard>
          </div>
          <div className="an-card">
            <h2>Apify spend by query, 14d</h2>
            <p className="an-sub2">Posts bought × $0.002. <b>priority</b> = searches for members, <b>hashtag</b> = the shared sweep. A low kept % on a member&apos;s search means a thin niche, not waste: widen it or slow it down, don&apos;t drop it. Ditch what no member wants or a sweep that keeps almost nothing.</p>
            <div className="an-tiles">{S.pipelines.map((p: Data) => <div key={p.pipeline} className="an-tile"><b>${p.usd}</b><span>{p.pipeline}: {p.queries} queries, {p.posts} posts, {p.kept} kept{p.perKept != null ? `, $${p.perKept} per kept job` : ''}</span></div>)}</div>
            <div className="an-seg" role="group" aria-label="Sort queries"><span className="an-muted-inline" style={{ marginRight: 8 }}>Sort by</span>
              <button type="button" className={ySort === 'spend' ? 'on' : ''} onClick={() => setYSort('spend')}>most spend</button>
              <button type="button" className={ySort === 'yield' ? 'on' : ''} onClick={() => setYSort('yield')}>lowest yield</button></div>
            <SpendTable rows={[...S.spend].sort((a: Data, b: Data) => ySort === 'spend' ? b.usd - a.usd : a.keptPct - b.keptPct || b.posts - a.posts).slice(0, 40)} />
          </div>
          <ChartCard title="What happened to posts, 14d" csv="classifier-outcomes" rows={S.classifier.map((t: Data) => ({ outcome: t.key, count: t.count }))}>
            <HBars rows={S.classifier.map((t: Data) => ({ label: t.key, value: t.count }))} color={COLORS.grey} />
          </ChartCard>
        </section>
      )}
    </div>
    </div>
  )
}

// ------------------------------------------------------------------ growth tab

const TZS = ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin']

function Growth({ G, generatedAt }: { G: Data; generatedAt: string }) {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const [range, setRange] = useState<14 | 30 | 90>(30)
  const [tz, setTz] = useState(browserTz)
  const [basis, setBasis] = useState<'paid' | 'created' | 'createdPaying'>('paid')
  const zones = [browserTz, ...TZS.filter((z) => z !== browserTz)]

  const all: Data[] = G.days
  const days: Data[] = all.slice(-range)
  const col = (k: string) => all.map((r) => r[k] as number)

  // ---- when people sign up
  const events: string[] = basis === 'paid' ? G.payments.map((p: Data) => p.at)
    : basis === 'created' ? G.signups.map((s: Data) => s.at)
    : G.signups.filter((s: Data) => s.paying).map((s: Data) => s.at)
  const T = timingOf(events, tz)
  const basisText = basis === 'paid' ? 'first payments' : basis === 'created' ? 'new accounts' : 'new accounts that went on to pay'
  const winTxt = `${hh(T.windowStart)}–${hh(T.windowStart + 3)}`
  const hourRows: ChartRow[] = T.hours.map((n, h) => ({ x: String(h).padStart(2, '0'), tip: `${hh(h)}–${hh(h + 1)}`, v: { n } }))
  const windowHours = [0, 1, 2].map((k) => (T.windowStart + k) % 24)
  const weekRows: ChartRow[] = T.days.map((n, i) => ({ x: WEEKDAYS[i], tip: WEEKDAYS_LONG[i], v: { n } }))

  // ---- when visitors are on the site (UTC counts shifted into the chosen zone)
  const off = tzOffsetHours(tz, new Date(generatedAt))
  const V = summarise(rebase(G.visitMatrix, off))
  const vHourRows: ChartRow[] = V.hours.map((n, h) => ({ x: String(h).padStart(2, '0'), tip: `${hh(h)}–${hh(h + 1)}`, v: { n } }))
  const vWindow = [0, 1, 2].map((k) => (V.windowStart + k) % 24)

  const wow = (k: string) => weekOverWeek(col(k))
  const revRange = days.reduce((s, r) => s + r.revenueUsd, 0)
  const tp = G.timeToPay

  return (
    <section className="an-grid">
      <div className="an-controls">
        <div className="an-seg" role="group" aria-label="Range">{([14, 30, 90] as const).map((r) => <button key={r} type="button" className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r} days</button>)}</div>
        <label className="an-tools"><span className="an-muted-inline">Time zone</span>
          <select className="an-select" value={tz} onChange={(e) => setTz(e.target.value)}>
            {zones.map((z) => <option key={z} value={z}>{z === browserTz ? `Your time · ${z}` : z}</option>)}
          </select>
        </label>
      </div>

      <div className="an-tiles">
        <Tile value={wow('visitors').now} label="visitors, last 7 days" spark={col('visitors').slice(-30)} delta={wow('visitors')} />
        <Tile value={wow('signups').now} label="new accounts, last 7 days" spark={col('signups').slice(-30)} delta={wow('signups')} />
        <Tile value={wow('paid').now} label="new paying members, last 7 days" spark={col('paid').slice(-30)} delta={wow('paid')} />
        <Tile value={fmtUsd(revRange)} label={`first-payment revenue, ${range} days (estimate; renewals not counted)`} spark={col('revenueUsd').slice(-range)} />
        <Tile value={G.totals.paying} label={`paying members ever · ${G.totals.payingPct}% of ${G.totals.profiles} accounts`} spark={col('payingMembers').slice(-30)} />
        <Tile value={tp.n ? dur(tp.medianMin) : '—'} label={tp.n ? `median time from account to first payment · ${tp.within1h}% pay within the hour` : 'time from account to first payment'} />
      </div>

      <div className="an-cols">
        <ChartCard title="Visitors per day" csv="visitors-daily" rows={days.map((r) => ({ day: r.day, visitors: r.visitors }))}>
          <Chart label="Visitors per day" rows={dayRows(days, ['visitors'])} series={one('visitors', 'Visitors', COLORS.blue)} avg />
        </ChartCard>
        <ChartCard title="Offer page and checkout" sub="People who saw /offer, and checkouts started. The gap between the lines is where the decision is lost." csv="offer-and-checkout-daily"
          rows={days.map((r) => ({ day: r.day, offer_viewers: r.offerViewers, checkouts_started: r.checkouts, first_payments: r.paid }))}
          legend={[{ key: 'offerViewers', label: 'Saw /offer', color: COLORS.blue }, { key: 'checkouts', label: 'Started checkout', color: COLORS.orange }, { key: 'paid', label: 'Paid', color: COLORS.aqua }]}>
          <Chart kind="line" label="Offer viewers, checkouts and payments per day" rows={dayRows(days, ['offerViewers', 'checkouts', 'paid'])}
            series={[{ key: 'offerViewers', label: 'Saw /offer', color: COLORS.blue }, { key: 'checkouts', label: 'Started checkout', color: COLORS.orange }, { key: 'paid', label: 'Paid', color: COLORS.aqua }]} />
        </ChartCard>
        <ChartCard title="New accounts per day" csv="new-accounts-daily" rows={days.map((r) => ({ day: r.day, new_accounts: r.signups }))}>
          <Chart label="New accounts per day" rows={dayRows(days, ['signups'])} series={one('signups', 'New accounts', COLORS.blue)} avg />
        </ChartCard>
        <ChartCard title="Paying members, cumulative" sub="Everyone who has ever paid, adding up over time." csv="paying-members-cumulative" rows={days.map((r) => ({ day: r.day, new_paying: r.paid, paying_members_total: r.payingMembers }))}>
          <Chart kind="line" area label="Paying members, cumulative" rows={dayRows(days, ['payingMembers'])} series={one('payingMembers', 'Paying members', COLORS.blue)} />
        </ChartCard>
        <ChartCard title="First-payment revenue per day" sub="Estimated from plan prices ($9 first month, $39 for 90 days). Renewals are not recorded here, so this undercounts." csv="revenue-daily" rows={days.map((r) => ({ day: r.day, est_usd: r.revenueUsd, new_paying: r.paid }))}>
          <Chart label="First-payment revenue per day" rows={dayRows(days, ['revenueUsd'])} series={one('revenueUsd', 'Revenue', COLORS.aqua)} valueFmt={fmtUsd} />
        </ChartCard>
        <ChartCard title="Plans and devices" csv="plans-devices" rows={[...G.plans.map((p: Data) => ({ kind: 'plan', name: p.plan, payments: p.payments, est_usd: p.estUsd })), ...G.devices.map((p: Data) => ({ kind: 'device', name: p.key, payments: p.count, est_usd: '' }))]}>
          <p className="an-sub2">Paid checkouts by plan</p>
          <HBars rows={G.plans.map((p: Data) => ({ label: p.plan, value: p.payments, note: fmtUsd(p.estUsd) }))} />
          <p className="an-sub2" style={{ marginTop: 14 }}>Paying members by first device</p>
          <HBars rows={G.devices.map((p: Data) => ({ label: p.key, value: p.count }))} color={COLORS.aqua} />
        </ChartCard>
      </div>

      <h2 className="an-section">When people sign up</h2>
      <div className="an-controls">
        <div className="an-seg" role="group" aria-label="What to count">
          <button type="button" className={basis === 'paid' ? 'on' : ''} onClick={() => setBasis('paid')}>First payment</button>
          <button type="button" className={basis === 'createdPaying' ? 'on' : ''} onClick={() => setBasis('createdPaying')}>Account created · paying</button>
          <button type="button" className={basis === 'created' ? 'on' : ''} onClick={() => setBasis('created')}>Account created · everyone</button>
        </div>
      </div>
      {T.n === 0 ? <div className="an-card an-muted">Nothing to show for {basisText} yet.</div> : (
        <>
          <div className="an-tiles">
            <Tile value={T.avgMin === null || T.spread < 0.2 ? '—' : clock(T.avgMin)} label={T.spread < 0.2 ? 'average time of day · no clear pattern (spread across the clock)' : `average time of day (${tz.split('/').pop()?.replace('_', ' ')}) · ${T.spread >= 0.6 ? 'tight cluster' : 'loose cluster'}`} />
            <Tile value={winTxt} label={`busiest 3 hours · ${T.windowCount} of ${T.n} ${basisText} (${Math.round((100 * T.windowCount) / T.n)}%)`} />
            <Tile value={WEEKDAYS_LONG[T.topDay]} label={`most common day · ${T.days[T.topDay]} of ${T.n}`} />
            <Tile value={T.n} label={`${basisText} counted${T.n < 30 ? ' · small sample, a hint not a pattern' : ''}`} />
          </div>
          <p className="an-insight">
            Of <b>{T.n}</b> {basisText}, <b>{T.windowCount}</b> ({Math.round((100 * T.windowCount) / T.n)}%) landed between <b>{winTxt}</b>, and <b>{WEEKDAYS_LONG[T.topDay]}</b> was the most common day (all times in {tz.replace('_', ' ')}).
            {T.avgMin !== null && T.spread >= 0.2 && <> The average is <b>{clock(T.avgMin)}</b>, calculated as a circular mean so that 23:30 and 00:30 average to midnight, not noon.</>}
          </p>
          <div className="an-cols">
            <ChartCard title="By hour of day" sub="Darker bars are the busiest three hours in a row." csv={`signup-hours-${basis}`} rows={T.hours.map((n, h) => ({ hour: hh(h), count: n }))}>
              <Chart label={`${basisText} by hour of day`} rows={hourRows} series={one('n', 'Signups', COLORS.blue)} hl={windowHours} height={190} />
            </ChartCard>
            <ChartCard title="By day of week" csv={`signup-weekdays-${basis}`} rows={T.days.map((n, i) => ({ weekday: WEEKDAYS_LONG[i], count: n }))}>
              <Chart label={`${basisText} by day of week`} rows={weekRows} series={one('n', 'Signups', COLORS.blue)} hl={[T.topDay]} height={190} />
            </ChartCard>
          </div>
          <ChartCard title="Day and hour together" csv={`signup-heatmap-${basis}`} rows={T.matrix.flatMap((r, d) => r.map((n, h) => ({ weekday: WEEKDAYS_LONG[d], hour: hh(h), count: n })))}>
            <Heatmap matrix={T.matrix} rowLabels={WEEKDAYS} unit={basisText} />
          </ChartCard>
        </>
      )}

      <h2 className="an-section">When visitors are on the site</h2>
      <div className="an-cols">
        <ChartCard title="Page loads by hour" sub={`Last 90 days, in ${tz.replace('_', ' ')} time. Useful for timing the daily digest and the priority scrape. Busiest three hours: ${hh(V.windowStart)}–${hh(V.windowStart + 3)}.`}
          csv="visits-by-hour" rows={V.hours.map((n, h) => ({ hour: hh(h), page_loads: n }))}>
          <Chart label="Page loads by hour" rows={vHourRows} series={one('n', 'Page loads', COLORS.blue)} hl={vWindow} height={190} />
        </ChartCard>
        <ChartCard title="Page loads by day and hour" csv="visits-heatmap" rows={V.matrix.flatMap((r, d) => r.map((n, h) => ({ weekday: WEEKDAYS_LONG[d], hour: hh(h), page_loads: n })))}>
          <Heatmap matrix={V.matrix} rowLabels={WEEKDAYS} unit="page loads" />
        </ChartCard>
      </div>

      <h2 className="an-section">What sends people to the offer page</h2>
      <ChartCard title="Entry points, 30 days" sub="People who saw /offer from each link, and how many of them started checkout. ‘(none)’ is a direct visit or an older link without a source." csv="offer-entry-points" rows={G.offerSources.map((r: Data) => ({ source: r.src, views: r.views, people: r.people, checkouts_started: r.started, paid: r.paid, started_pct_of_people: r.startPct }))}>
        {G.offerSources.length === 0 ? <p className="an-muted">No offer-page views recorded yet.</p> : (
          <div className="an-tablewrap" style={{ maxHeight: 'none' }}>
            <table className="an-compact">
              <thead><tr><th>Source</th><th style={{ width: '34%' }}>People</th><th className="num">People</th><th className="num">Started checkout</th><th className="num">Paid</th><th className="num">Started %</th></tr></thead>
              <tbody>{G.offerSources.map((r: Data) => (
                <tr key={r.src}>
                  <td className="mono">{r.src}</td>
                  <td><span className="an-bar-in"><i style={{ width: `${Math.max(2, (100 * r.people) / Math.max(1, G.offerSources[0].people))}%` }} /></span></td>
                  <td className="num">{r.people}</td><td className="num">{r.started}</td><td className="num">{r.paid}</td><td className="num">{r.startPct}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </section>
  )
}

function SpendTable({ rows }: { rows: Data[] }) {
  return (
    <table className="an-compact">
      <thead><tr><th>Query</th><th className="num">Runs</th><th className="num">Posts</th><th className="num">$</th><th className="num">Kept</th><th className="num">Kept %</th><th className="num">Repeat %</th><th className="num">$/kept</th><th>Verdict</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={`${r.pipeline}|${r.query}`}>
          <td><span className="an-pill">{r.pipeline}</span> {r.query}</td>
          <td className="num">{r.runs}</td><td className="num">{r.posts}</td><td className="num">{r.usd.toFixed(2)}</td><td className="num">{r.kept}</td>
          <td className="num">{r.keptPct}</td><td className="num">{r.dupPct}</td><td className="num">{r.perKept ?? '—'}</td>
          <td>{r.verdict.startsWith('ditch') ? <span className="an-flag">{r.verdict}</span> : r.verdict}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

const CSS = `
.an-page { --bg:#F5F2EB; --surface:#FDFCFA; --hair:#D8D2C2; --ink:#191713; --ink-2:#5C574D; --ink-3:#8A8378; --accent:#24468f; --accent-soft:#E9EFFC; --warn:#FFF4DB; --warn-ink:#7A4B00;
  min-height: 100vh; width: 100%; background: var(--bg); color: var(--ink); font-family: var(--font-inter), system-ui, sans-serif; font-size: 14px; color-scheme: light; }
.an-mast { background: var(--surface); border-bottom: 1px solid var(--hair); }
.an-mast-in { max-width: 1200px; margin: 0 auto; padding: 14px 28px; display: flex; align-items: center; gap: 14px; }
.an-wordmark { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-fraunces), Georgia, serif; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; text-decoration: none; color: var(--ink); }
.an-wordmark em { font-style: italic; font-weight: 400; color: var(--ink-2); }
.an-mark { flex: none; width: 30px; height: 30px; border-radius: 7px; background: #185FA5; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-fraunces), Georgia, serif; font-size: 18px; font-weight: 500; line-height: 1; }
.an-badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.an-mast-link { margin-left: auto; font-size: 13px; font-weight: 600; color: var(--ink-2); text-decoration: none; }
.an-mast-link:hover { color: var(--ink); }
.an { max-width: 1200px; margin: 0 auto; padding: 24px 28px 60px; }
.an-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.an h1 { margin: 0; font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 30px; letter-spacing: -.01em; }
.an h2 { margin: 0 0 10px; font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 17px; }
.an-sub { margin: 4px 0 0; color: var(--ink-3); font-size: 12.5px; }
.an-tabs, .an-seg { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid var(--hair); border-radius: 10px; background: var(--surface); }
.an-tabs button, .an-seg button { border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 600; color: var(--ink-2); padding: 7px 12px; border-radius: 8px; cursor: pointer; }
.an-tabs button.on, .an-seg button.on { background: var(--ink); color: #fff; }
.an-controls { display: flex; gap: 10px; flex-wrap: wrap; }
.an-grid { display: grid; gap: 14px; }
.an-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.an-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.an-tile { padding: 14px 16px; border: 1px solid var(--hair); border-radius: 12px; background: var(--surface); display: grid; gap: 2px; }
.an-tile b { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 26px; font-variant-numeric: tabular-nums; }
.an-tile span { font-size: 12.5px; color: var(--ink-2); }
.an-card { padding: 16px 18px; border: 1px solid var(--hair); border-radius: 14px; background: var(--surface); min-width: 0; }
.an-warn { background: var(--warn); color: var(--warn-ink); border-color: #F0D9A6; }
.an-muted { color: var(--ink-3); font-size: 12.5px; margin: 8px 0 0; }
.an-member.lapsed { opacity: .7; }
.an-member-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 10px; flex-wrap: wrap; }
.an-member-head b { font-size: 15px; }
.an-meta { display: block; color: var(--ink-2); font-size: 12.5px; margin-top: 2px; }
.an-member-sum { text-align: right; } .an-member-sum b { display: block; font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 24px; } .an-member-sum span { font-size: 11.5px; color: var(--ink-3); }
.an table { width: 100%; border-collapse: collapse; font-size: 13px; }
.an th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--hair); }
.an td { padding: 7px 8px; border-bottom: 1px solid #EEE9DD; vertical-align: top; }
.an .num { text-align: right; font-variant-numeric: tabular-nums; }
.an .mono { font-family: var(--font-spline-mono), ui-monospace, monospace; font-size: 12px; color: var(--ink-2); }
.an tr.flag td { background: var(--warn); }
.an-flag { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #F0D9A6; color: var(--warn-ink); font-size: 11.5px; font-weight: 600; }
.an-lane { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: #EFEBE1; color: var(--ink-2); font-size: 11px; font-weight: 600; }
.an-widened { margin: 10px 2px 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.7; }
.an-widened b { color: var(--ink); font-weight: 600; }
.an-muted-inline { color: var(--ink-3); }
.an-warn-text { color: var(--warn-ink); }
.an-pill { display: inline-block; padding: 1px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600; margin-right: 4px; }
.an-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.an-list li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid #EEE9DD; font-size: 13.5px; }
.an-list li b { font-variant-numeric: tabular-nums; }
.an-funnel { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.an-funnel li { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid #EEE9DD; }
.an-funnel b { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 20px; } .an-funnel small { color: var(--ink-3); min-width: 110px; text-align: right; }
.an-section { margin: 14px 2px 0; font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 20px; }
.bars { display: flex; align-items: flex-end; gap: 3px; height: 90px; margin: 6px 0 10px; }
.bar { flex: 1; display: flex; align-items: flex-end; height: 100%; }
.bar i { display: block; width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; opacity: .85; }
.an-compact td, .an-compact th { padding: 5px 8px; }
@media (max-width: 720px) { .an { padding: 16px 16px 48px; } .an-mast-in { padding: 12px 16px; } .an-badge { display: none; } .an-member-sum { text-align: left; } .an table { display: block; overflow-x: auto; } }
`
