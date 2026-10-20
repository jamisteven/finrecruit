'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any

const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const ago = (iso: string | null) => {
  if (!iso) return '—'
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
const secs = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)

function Bars({ rows, value, label, max }: { rows: Record<string, number | string>[]; value: string; label: string; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => Number(r[value]) || 0))
  return (
    <div className="bars" role="img" aria-label={`${label} by day`}>
      {rows.map((r) => (
        <div key={String(r.day)} className="bar" title={`${fmtDay(String(r.day))}: ${r[value]} ${label}`}>
          <i style={{ height: `${Math.max(2, (100 * (Number(r[value]) || 0)) / m)}%` }} />
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'members' | 'demand' | 'engagement' | 'supply'>('members')
  const [win, setWin] = useState<'d7' | 'd30' | 'd90'>('d30')
  const [seg, setSeg] = useState<'all' | 'members' | 'free'>('all')

  useEffect(() => {
    fetch('/api/analytics').then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`)
      return r.json()
    }).then(setData).catch((e) => setErr(e.message))
  }, [])

  const M = data?.members, D = data?.demand, E = data?.engagement, S = data?.supply
  const d = D?.[win]?.[seg]

  return (
    <div className="an-page">
      <style>{CSS}</style>
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
        <nav className="an-tabs" aria-label="Panels">
          {(['members', 'demand', 'engagement', 'supply'] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </nav>
      </header>

      {!data && !err && <div className="an-card an-muted">Pulling the last 30 to 90 days from the database…</div>}

      {/* ------------------------------------------------ members */}
      {tab === 'members' && M && (
        <section className="an-grid">
          <div className="an-tiles">
            <div className="an-tile"><b>{M.active}</b><span>active members</span></div>
            <div className="an-tile"><b>{M.expiring7.length}</b><span>expire within 7 days</span></div>
            <div className="an-tile"><b>{M.members.reduce((s: number, m: Data) => s + m.flags, 0)}</b><span>target problems · stale = no run in 2 days (5 for slow-lane queries)</span></div>
          </div>
          {M.expiring7.length > 0 && (
            <div className="an-card an-warn">
              <b>Expiring soon:</b> {M.expiring7.map((m: Data) => `${m.email} (${m.daysLeft}d)`).join(' · ')}
            </div>
          )}
          {M.members.map((m: Data) => (
            <article key={m.email} className={`an-card an-member ${m.active ? '' : 'lapsed'}`}>
              <div className="an-member-head">
                <div>
                  <b>{m.email}</b>
                  <span className="an-meta">
                    {m.plan ?? 'no payment'} · {m.payments} payment{m.payments === 1 ? '' : 's'} · {m.active ? `${m.daysLeft} days left` : `lapsed ${-m.daysLeft}d ago`} · last visit {ago(m.lastVisit)}{m.device ? ` · ${m.device}` : ''}
                  </span>
                </div>
                <div className="an-member-sum"><b>{m.exact7}</b><span>exact matches, 7d</span></div>
              </div>
              {m.targets.length === 0 ? <p className="an-muted">No targets saved.</p> : (
                <table>
                  <thead><tr><th>Role</th><th>Location</th><th className="num">Exact 7d</th><th className="num">Exact 14d</th><th className="num">Anywhere 14d</th><th>Query</th><th>Last run</th></tr></thead>
                  <tbody>
                    {m.targets.map((t: Data, i: number) => (
                      <tr key={i} className={t.flag ? 'flag' : ''}>
                        <td>{t.keyword}</td><td>{t.location || 'anywhere'}</td>
                        <td className="num">{t.exact7}</td><td className="num">{t.exact14}</td><td className="num">{t.anywhere14}</td>
                        <td className="mono">{t.query ?? '—'}</td>
                        <td>{t.flag ? <span className="an-flag">{t.flag}</span> : <>{ago(t.lastRunAt)}{t.slowLane && <span className="an-lane" title="Last two runs kept at most one job; runs every 4 days instead of every 12 hours">slow lane</span>}</>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          ))}
        </section>
      )}

      {/* ------------------------------------------------ demand */}
      {tab === 'demand' && D && (
        <section className="an-grid">
          <div className="an-controls">
            <div className="an-seg">{(['d7', 'd30', 'd90'] as const).map((w) => <button key={w} type="button" className={win === w ? 'on' : ''} onClick={() => setWin(w)}>{w.slice(1)} days</button>)}</div>
            <div className="an-seg">{(['all', 'members', 'free'] as const).map((s) => <button key={s} type="button" className={seg === s ? 'on' : ''} onClick={() => setSeg(s)}>{s}</button>)}</div>
          </div>
          <div className="an-tiles">
            <div className="an-tile"><b>{d.searches}</b><span>searches</span></div>
            <div className="an-tile"><b>{d.visitors}</b><span>people searching</span></div>
            <div className="an-tile"><b>{d.zeroShare}%</b><span>returned nothing</span></div>
          </div>
          <div className="an-cols">
            <div className="an-card"><h2>Roles searched</h2><ol className="an-list">{d.terms.map((t: Data) => <li key={t.key}><span>{t.key}</span><b>{t.count}</b></li>)}</ol></div>
            <div className="an-card"><h2>Locations filtered</h2><ol className="an-list">{d.locations.map((t: Data) => <li key={t.key}><span>{t.key}</span><b>{t.count}</b></li>)}</ol></div>
            <div className="an-card"><h2>Searches with no results</h2><ol className="an-list">{d.zeroResult.length ? d.zeroResult.map((t: Data) => <li key={t.key}><span>{t.key}</span><b>{t.count}</b></li>) : <li className="an-muted">none</li>}</ol></div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ engagement */}
      {tab === 'engagement' && E && (
        <section className="an-grid">
          <div className="an-tiles">
            <div className="an-tile"><b>{E.visitors}</b><span>visitors, 30d</span></div>
            <div className="an-tile"><b>{E.returningShare}%</b><span>came back on another day</span></div>
            <div className="an-tile"><b>{secs(E.time.all.medianSec)}</b><span>median active time · mean {secs(E.time.all.meanSec)}</span></div>
            <div className="an-tile"><b>{secs(E.time.members.medianSec)}</b><span>members&apos; median · free {secs(E.time.free.medianSec)}</span></div>
          </div>
          <div className="an-card">
            <h2>Visitors by day</h2>
            <Bars rows={E.days} value="visitors" label="visitors" />
            <p className="an-muted">Active time is first to last recorded event in a visit (page loads, searches, job clicks); a single page load counts as 0s, which is {E.time.all.bounced}% of visits.</p>
          </div>
          <div className="an-cols">
            <div className="an-card">
              <h2>Funnel, 30 days</h2>
              <ol className="an-funnel">
                {[['Visitors', E.funnel.visitors], ['Searched', E.funnel.searched], ['Clicked a job', E.funnel.clickedJob], ['Started checkout', E.funnel.checkoutStarted], ['Paid', E.funnel.paid]].map(([k, v], i, arr) => (
                  <li key={String(k)}><span>{k}</span><b>{v as number}</b><small>{i ? `${Math.round(100 * (v as number) / Math.max(1, arr[i - 1][1] as number))}% of previous` : ''}</small></li>
                ))}
              </ol>
            </div>
            <div className="an-card"><h2>Where visits came from</h2><ol className="an-list">{E.referrers.map((t: Data) => <li key={t.key}><span>{t.key}</span><b>{t.count}</b></li>)}</ol></div>
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
          <div className="an-card">
            <h2>Posts bought per day, 30 days</h2>
            <Bars rows={S.days} value="posts" label="posts" />
            <table className="an-compact">
              <thead><tr><th>Day</th><th className="num">Posts</th><th className="num">Kept</th><th className="num">Repeats</th><th className="num">Rejected</th><th className="num">$</th></tr></thead>
              <tbody>{[...S.days].reverse().slice(0, 10).map((r: Data) => <tr key={r.day}><td>{fmtDay(r.day)}</td><td className="num">{r.posts}</td><td className="num">{r.kept}</td><td className="num">{r.dup}</td><td className="num">{r.rejected}</td><td className="num">{r.usd.toFixed(2)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="an-cols">
            <div className="an-card"><h2>Worst-yielding queries, 14d</h2><YieldTable rows={S.worst} /></div>
            <div className="an-card"><h2>Best-yielding queries, 14d</h2><YieldTable rows={S.best} /></div>
          </div>
          <div className="an-card"><h2>What happened to posts, 14d</h2><ol className="an-list">{S.classifier.map((t: Data) => <li key={t.key}><span className="mono">{t.key}</span><b>{t.count}</b></li>)}</ol></div>
        </section>
      )}
    </div>
    </div>
  )
}

function YieldTable({ rows }: { rows: Data[] }) {
  return (
    <table className="an-compact">
      <thead><tr><th>Query</th><th className="num">Posts</th><th className="num">Kept %</th><th className="num">Repeat %</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={`${r.pipeline}|${r.query}`}><td><span className="an-pill">{r.pipeline}</span> {r.query}</td><td className="num">{r.posts}</td><td className="num">{r.keptPct}</td><td className="num">{r.dupPct}</td></tr>)}</tbody>
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
.an-pill { display: inline-block; padding: 1px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600; margin-right: 4px; }
.an-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.an-list li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid #EEE9DD; font-size: 13.5px; }
.an-list li b { font-variant-numeric: tabular-nums; }
.an-funnel { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.an-funnel li { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid #EEE9DD; }
.an-funnel b { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 20px; } .an-funnel small { color: var(--ink-3); min-width: 110px; text-align: right; }
.bars { display: flex; align-items: flex-end; gap: 3px; height: 90px; margin: 6px 0 10px; }
.bar { flex: 1; display: flex; align-items: flex-end; height: 100%; }
.bar i { display: block; width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; opacity: .85; }
.an-compact td, .an-compact th { padding: 5px 8px; }
@media (max-width: 720px) { .an { padding: 16px 16px 48px; } .an-mast-in { padding: 12px 16px; } .an-badge { display: none; } .an-member-sum { text-align: left; } .an table { display: block; overflow-x: auto; } }
`
