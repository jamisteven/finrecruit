'use client'

import { useEffect, useRef, useState } from 'react'
import { captureAttribution, deviceType, getAttribution, getVisitorId } from '@/lib/attribution'

const FREE_DELAY_HOURS = 48

// Keep these in sync with Stripe. Copy below is derived from them so price changes stay consistent.
const PRICE = { intro: 9, monthly: 15, quarter: 39 }

const SECTOR_LABELS: Record<string, string> = {
  finance: 'Finance', tech: 'Tech', legal: 'Legal', marketing: 'Marketing',
  realestate: 'Real Estate', sales: 'Sales', hr: 'HR & Talent', biotech: 'Biotech & Pharma',
}
const sectorLabel = (s?: string | null) => (s && SECTOR_LABELS[s]) || 'Other'

type Plan = 'monthly' | 'quarter'
type LockedRole = { title: string; location: string | null; sector: string | null; posted_at: string | null }
type Withheld = { roles: LockedRole[]; matched: number; total: number; fallback: LockedRole[] }
type LastSearch = { q?: string; sector?: string; locations?: string[]; at?: number }
type Live = { fresh: number; shown: number; hasPass: boolean; addedToday: number; latestAt: string | null }
type GateJob = { title: string; company?: string | null; location?: string | null; posted_at?: string | null; at?: number }

function readLastSearch(): LastSearch | null {
  try {
    const raw = localStorage.getItem('bcj_last_search')
    if (!raw) return null
    const v = JSON.parse(raw) as LastSearch
    if (!v.at || Date.now() - v.at > 24 * 3600_000) return null
    return v
  } catch { return null }
}

function describeSearch(ls: LastSearch | null): string {
  if (!ls) return 'new roles'
  const q = (ls.q ?? '').trim()
  const sec = ls.sector && ls.sector !== 'all' ? sectorLabel(ls.sector).toLowerCase() : ''
  const what = q ? `${q} roles` : sec ? `${sec} roles` : 'new roles'
  const locs = (ls.locations ?? []).filter(Boolean)
  const where = locs.length === 0 ? '' : locs.length === 1 ? ` in ${locs[0]}` : ` in ${locs.slice(0, -1).join(', ')} and ${locs[locs.length - 1]}`
  return `${what}${where}`
}

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function unlockLabel(postedAt?: string | null): string | null {
  if (!postedAt) return null
  const t = new Date(postedAt).getTime()
  if (isNaN(t)) return null
  const at = new Date(t + FREE_DELAY_HOURS * 3600_000)
  const now = new Date()
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const dayDiff = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000)
  const day = dayDiff <= 0 ? 'today' : dayDiff === 1 ? 'tomorrow' : at.toLocaleDateString(undefined, { weekday: 'long' })
  return `${day} ${time}`
}

function ShieldIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 3 5 6v6c0 4.6 3 7.8 7 9 4-1.2 7-4.4 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
}
function CheckCircle() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="pp-check"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></svg>
}
function LockIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
}
function Silhouette() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
}
function OutIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg>
}
function StarIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
}

export default function OfferPage() {
  const [busy, setBusy] = useState<Plan | null>(null)
  const [err, setErr] = useState(false)
  const [showSticky, setShowSticky] = useState(false)
  const [live, setLive] = useState<Live | null>(null)
  const [withheld, setWithheld] = useState<Withheld | null>(null)
  const [lastSearch, setLastSearch] = useState<LastSearch | null>(null)
  const [gateJob, setGateJob] = useState<GateJob | null>(null)
  const priceRef = useRef<HTMLDivElement>(null)
  const srcRef = useRef<string | null>(null)
  const [src, setSrc] = useState<string | null>(null)

  const track = (name: string, params: Record<string, unknown> = {}) => {
    try {
      const w = window as unknown as { gtag?: (...a: unknown[]) => void }
      w.gtag?.('event', name, params)
    } catch { /* analytics must never break the page */ }
  }

  useEffect(() => { captureAttribution() }, [])
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('src')
      srcRef.current = v
      if (v) setTimeout(() => setSrc(v), 0)
    } catch {}
    try {
      const raw = sessionStorage.getItem('bcj_gate_job')
      if (raw) {
        const v = JSON.parse(raw) as GateJob
        if (v && v.title && Date.now() - (v.at ?? 0) < 30 * 60_000) setTimeout(() => setGateJob(v), 0)
      }
    } catch {}
  }, [])
  
  useEffect(() => {
    fetch('/api/jobs?limit=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const next: Live = {
          shown: d.previewCount ?? 0,
          fresh: (d.withheld ?? 0) + (d.previewCount ?? 0),
          hasPass: !!d.hasPass,
          addedToday: d.addedToday ?? 0,
          latestAt: d.latestPostedAt ?? null,
        }
        setLive(next)
        track('offer_view', { fresh: next.fresh, has_pass: next.hasPass, src: srcRef.current })
        try {
          fetch('/api/offer-view', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
            body: JSON.stringify({ visitor_id: getVisitorId(), src: srcRef.current, fresh: next.fresh, has_pass: next.hasPass }),
          }).catch(() => {})
        } catch {}
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const ls = readLastSearch()
    const p = new URLSearchParams({ withheld: '1' })
    if (ls?.q) p.set('q', ls.q)
    if (ls?.sector && ls.sector !== 'all') p.set('sector', ls.sector)
    if (ls?.locations?.length) p.set('loc', ls.locations.join('|'))
    fetch(`/api/jobs?${p}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setLastSearch(ls)
        setWithheld({ roles: d.roles ?? [], matched: d.matched ?? 0, total: d.total ?? 0, fallback: d.fallback ?? [] })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const el = priceRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setShowSticky(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const checkout = async (plan: Plan, where: string) => {
    if (busy) return
    track('cta_click', { where, plan, src: srcRef.current })
    setBusy(plan); setErr(false)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          visitor_id: getVisitorId(),
          device: deviceType(),
          attribution: getAttribution(),
          src: srcRef.current,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) { window.location.assign(data.url); return }
    } catch {}
    setBusy(null); setErr(true)
    setTimeout(() => setErr(false), 8000)
  }

  const hasPass = !!live?.hasPass
  const hidden = live ? Math.max(0, live.fresh - live.shown) : 0
  const hasSearch = !!lastSearch && (!!lastSearch.q || (lastSearch.locations?.length ?? 0) > 0 || (!!lastSearch.sector && lastSearch.sector !== 'all'))
  const searchMatched = !!withheld && withheld.roles.length > 0 && hasSearch
  const searchDesc = describeSearch(lastSearch)
  const lockedRows: LockedRole[] = withheld ? (withheld.roles.length ? withheld.roles : withheld.fallback) : []

  const variant: 'recruiter' | 'search' | 'locked' | 'cold' =
    gateJob ? 'recruiter'
    : searchMatched ? 'search'
    : (src === 'feed_top' || src === 'locked_title' || src === 'new_today' || src === 'inline') && hidden > 0 ? 'locked'
    : 'cold'
  const lockedCount = variant === 'search' ? withheld!.matched : hidden
  const rows = variant === 'cold' ? lockedRows.slice(0, 3) : lockedRows.slice(0, 5)
  const more = Math.max(0, lockedCount - rows.length)
  const q = (lastSearch?.q ?? '').trim()
  
  const buttonLabel =
    busy === 'monthly' ? 'Securing your pass…'
    : variant === 'recruiter' ? `Unlock Hiring Manager & Direct Link · $${PRICE.intro}`
    : variant === 'search' ? `Unlock All ${lockedCount} Matching Roles · $${PRICE.intro}`
    : variant === 'locked' ? `Unlock All ${lockedCount} Hidden Roles · $${PRICE.intro}`
    : `Get Instant Access for $${PRICE.intro}`

  const lockedRow = (r: LockedRole, i: number, where: string) => (
    <li key={`${r.title}-${i}`}>
      <button type="button" className="pp-row" onClick={() => checkout('monthly', where)} disabled={busy !== null}>
        <span className="pp-row-ico" aria-hidden="true"><LockIcon /></span>
        <span className="pp-row-txt">
          <span className="pp-row-title">{r.title}</span>
          <span className="pp-row-meta">
            {r.location ? r.location : sectorLabel(r.sector)}
            {timeAgo(r.posted_at) ? ` · ${timeAgo(r.posted_at)}` : ''}
            {unlockLabel(r.posted_at) ? ` · Free in ${unlockLabel(r.posted_at)}` : ''}
          </span>
        </span>
        <span className="pp-row-go">Unlock &rarr;</span>
      </button>
    </li>
  )

  return (
    <div className="pp">
      <header className="pp-top">
        <a className="pp-brand" href="/">backchannel<span>.jobs</span></a>
        <div className="pp-top-trust">
          <span className="pp-stars"><StarIcon/><StarIcon/><StarIcon/><StarIcon/><StarIcon/></span>
          <span>Trusted by job seekers at top tech & finance firms</span>
        </div>
      </header>

      <main className="pp-main">
        <section className="pp-hero">
          <div className="pp-hook">
            {variant === 'search' && (
              <span className="pp-eyebrow">🎯 Exact Match Found for: {q || sectorLabel(lastSearch?.sector)}{lastSearch?.locations?.length ? ` in ${lastSearch.locations.join(', ')}` : ''}</span>
            )}
            {variant === 'recruiter' && gateJob ? (
              <h1>Bypass the ATS black hole for <em>{gateJob.title}</em>.</h1>
            ) : variant === 'search' ? (
              <h1><em>{lockedCount.toLocaleString()} {searchDesc}</em> were posted before anyone else saw them.</h1>
            ) : variant === 'locked' ? (
              <h1><em>{lockedCount.toLocaleString()} fresh roles</em> are hidden right now. Stop finding out about them days too late.</h1>
            ) : (
              <h1>Skip the job board black hole. <em>Apply directly to hiring managers and internal teams.</em></h1>
            )}
            
            <p className="sub">Most high-value roles are shared directly by hiring managers, internal recruiters, and staff, they never make it to traditional job boards. Backchannel indexes these unlisted posts in real time so you can pitch decision-makers first.</p>            
            
            {hasPass && <p className="pp-have">✨ You already have active Premium access. <a href="/">Go to today&apos;s feed &rarr;</a></p>}

            {/* Value proposition check strip */}
            <div className="pp-value-strip">
              <div>⚡ <strong>Real-time alerts</strong> before public indexing</div>
              <div>🤝 <strong>Direct hiring manager</strong> identity & link</div>
              <div>🔒 <strong>Cancel anytime</strong> in 2 clicks</div>
            </div>
          </div>

          <div className="pp-price-col" ref={priceRef}>
            <section className="pp-card">
              <div className="pp-card-badge">⚡ Special Intro Offer — 40% Off</div>
              <div className="pp-price-lockup">
                <div className="pp-price">
                  <b>${PRICE.intro}</b>
                  <div className="pp-price-meta">
                    <span className="pp-strike">${PRICE.monthly} /mo</span>
                    <span className="pp-price-sub">for your first month</span>
                  </div>
                </div>
              </div>
              
              <ul className="pp-bullets">
                <li><CheckCircle /><span><b>Instant access to all hidden roles</b> the second they go live</span></li>
                <li><CheckCircle /><span><b>Direct profile links</b> to the recruiter who posted them</span></li>
                {variant === 'search' && q
                  ? <li><CheckCircle /><span>Continuous custom tracking for <b>&ldquo;{q}&rdquo;</b></span></li>
                  : <li><CheckCircle /><span>Personalized role matching built for your target track</span></li>}
                <li><CheckCircle /><span>Zero automated filler roles or scraped spam</span></li>
              </ul>

              <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly', 'offer_card')} disabled={busy !== null}>
                {buttonLabel}
              </button>
              
              <div className="pp-guarantee-box">
                <ShieldIcon /> <span>Secure checkout via Stripe. Cancel anytime with 2 clicks from your settings—keep full access until your billing cycle ends.</span>
              </div>

              <div className="pp-divider"><span>or save more</span></div>

              <button type="button" className="pp-quarter" onClick={() => checkout('quarter', 'offer_quarter')} disabled={busy !== null}>
                {busy === 'quarter' ? 'Opening secure checkout…' : <>Get a 90-Day Unrestricted Pass for <b>${PRICE.quarter} (Best Value) &rarr;</b></>}
              </button>
              
              {err && <p className="pp-err" role="alert">⚠️ Checkout didn&apos;t open, and you haven&apos;t been charged. Please try again or check your blocker settings.</p>}
            </section>
          </div>

          {/* the thing they came for */}
          {!hasPass && (
            <div className="pp-thing">
              {variant === 'recruiter' && gateJob && (
                <>
                  <article className="pp-jobcard">
                    <div className="pp-jobcard-top">
                      <span className="pp-jobcard-flag">🔒 Locked Premium Role</span>
                      {timeAgo(gateJob.posted_at) && <span className="pp-jobcard-ago">{timeAgo(gateJob.posted_at)}</span>}
                    </div>
                    <h3>{gateJob.title}</h3>
                    <p className="pp-jobcard-meta"><b>{gateJob.company ?? 'Company confidential'}</b>{gateJob.location ? ` · ${gateJob.location}` : ''}</p>
                    <div className="pp-jobcard-foot">
                      <span className="pp-jobcard-avatar" aria-hidden="true"><Silhouette /></span>
                      <span className="pp-jobcard-who">Posted by <span className="pp-blur" aria-hidden="true">Firstname Lastname</span> · Direct LinkedIn profile & post</span>
                      <span className="pp-jobcard-btn">Unlock Now <OutIcon /></span>
                    </div>
                  </article>
                  <p className="pp-thing-note">💡 Unlocking reveals the exact decision-maker&apos;s profile link so you can pitch them directly instead of entering the black hole of an online portal.</p>
                </>
              )}

              {(variant === 'search' || variant === 'locked') && rows.length > 0 && (
                <div className="pp-list">
                  <div className="pp-list-header-bar">
                    <span>Preview of currently locked roles:</span>
                    <span className="pp-badge-count">{lockedCount} total matching</span>
                  </div>
                  <ul>{rows.map((r, i) => lockedRow(r, i, variant === 'search' ? 'offer_search_row' : 'offer_locked_row'))}</ul>
                  <span className="pp-list-more">
                    ✨ Plus <b>{more > 0 ? `${more.toLocaleString()} more` : 'all others'}</b> hidden inside the {FREE_DELAY_HOURS}-hour priority window.
                  </span>
                </div>
              )}

              {variant === 'cold' && (
                <>
                  <div className="pp-proof">
                    {live ? (
                      <>
                        <span><i className="pp-dot" aria-hidden="true" /><b>{live.addedToday.toLocaleString()} roles</b> added today</span>
                        {timeAgo(live.latestAt) && <><span className="pp-proof-sep" aria-hidden="true" /><span>latest posted <b>{timeAgo(live.latestAt)}</b></span></>}
                      </>
                    ) : <span>&nbsp;</span>}
                  </div>
                  {rows.length > 0 && (
                    <div className="pp-list">
                      <span className="pp-list-head">🔒 Live preview — locked for free users:</span>
                      <ul>{rows.map((r, i) => lockedRow(r, i, 'offer_locked_row'))}</ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* FAQ Section */}
        <section className="pp-faq">
          <h2>Frequently Asked Questions</h2>
          <details open><summary>How do I cancel my subscription?</summary><p>It takes literally two clicks. Go to your account menu in the top right, select &ldquo;Manage billing,&rdquo; and hit cancel. You will keep complete access until your paid period ends, and you will never be billed again.</p></details>
          <details><summary>Why do I need this instead of LinkedIn Jobs?</summary><p>LinkedIn Jobs displays listings days after they are created, forcing you to compete with hundreds of automated applicants. Backchannel indexes raw, unvarnished posts written directly by hiring managers looking for speed over bureaucracy.</p></details>
          <details><summary>What happens after my first month?</summary><p>Your first month is discounted to ${PRICE.intro}. Afterward, it renews at ${PRICE.monthly}/month until you choose to cancel. Alternatively, choose our 90-day pass for a one-time payment of ${PRICE.quarter} with zero auto-renewal.</p></details>
          <details><summary>What parts of the site remain free?</summary><p>All roles older than {FREE_DELAY_HOURS} hours remain entirely free to read in full. Premium simply removes the delay window so you can see fresh opportunities before anyone else.</p></details>
        </section>
      </main>

      <footer className="pp-footer">
        <span><ShieldIcon /> Secure 256-bit Stripe Checkout. Your data and billing info are completely private.</span>
        <a href="/">&larr; Return to the free feed</a>
      </footer>

      {/* Mobile sticky CTA */}
      {!hasPass && (
        <div className={`pp-sticky${showSticky ? ' is-on' : ''}`} aria-hidden={!showSticky}>
          <div className="pp-sticky-txt">
            <span>First month special</span>
            <b>${PRICE.intro} <span className="pp-sticky-strike">(${PRICE.monthly})</span></b>
          </div>
          <button type="button" className="pp-btn pp-btn-primary" tabIndex={showSticky ? 0 : -1} onClick={() => checkout('monthly', 'offer_sticky')} disabled={busy !== null}>
            {busy === 'monthly' ? 'Opening…' : 'Unlock All Roles Now'}
          </button>
        </div>
      )}

      <style>{`
        .pp { --page:#F5F2EB; --surface:#FDFCFA; --ink:#191713; --ink-2:#5C574D; --ink-3:#7A7366; --hair:#D8D2C2; --hair-2:#E4DFD2; --accent-soft:#E4EAF6; --accent-line:#C7D4F5; --cta:#1B4F82; --cta-h:#143B5E; --accent:#1B4F82; --good:#0A7A3D; --link:#1B4F82;
          min-height: 100vh; background: var(--page); color: var(--ink); font-family: var(--font-inter), system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .pp *, .pp *::before, .pp *::after { box-sizing: border-box; }
        .pp-top { max-width: 1080px; margin: 0 auto; padding: 22px 24px 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
        .pp-brand { font-family: var(--font-fraunces), Georgia, serif; font-size: 22px; font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
        .pp-brand span { color: var(--ink-2); font-weight: 400; }
        .pp-top-trust { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); background: rgba(0,0,0,0.03); padding: 4px 10px; border-radius: 99px; }
        .pp-stars { display: inline-flex; gap: 2px; color: #D97706; }
        
        .pp-main { max-width: 1080px; margin: 0 auto; padding: 40px 24px 40px; }
        .pp-check { color: var(--good); flex: none; margin-top: 2px; }

        .pp-hero { display: grid; grid-template-columns: minmax(0, 1.15fr) 420px; grid-template-areas: "hook price" "thing price"; column-gap: 56px; row-gap: 24px; align-items: start; margin-bottom: 48px; }
        .pp-hook { grid-area: hook; display: flex; flex-direction: column; gap: 16px; }
        .pp-price-col { grid-area: price; }
        .pp-thing { grid-area: thing; display: flex; flex-direction: column; gap: 14px; }
        
        .pp-eyebrow { display: inline-block; font: 600 12px var(--font-spline-mono), monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); background: var(--accent-soft); padding: 4px 10px; border-radius: 6px; width: fit-content; }
        .pp h1 { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: clamp(28px, 3.2vw, 42px); line-height: 1.12; letter-spacing: -0.02em; margin: 0; }
        .pp h1 em { font-style: normal; color: var(--accent); }
        .pp-sub { font-size: 16.5px; line-height: 1.6; color: var(--ink-2); margin: 0; max-width: 52ch; }
        .pp-have { margin: 0; font-size: 14px; color: var(--ink-2); }
        .pp-have a { color: var(--accent); font-weight: 600; }

        .pp-value-strip { display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; color: var(--ink-2); background: var(--surface); padding: 14px 18px; border-radius: 12px; border: 1px solid var(--hair); max-width: 52ch; }
        .pp-value-strip strong { color: var(--ink); }

        .pp-proof { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13.5px; color: var(--ink-2); min-height: 20px; }
        .pp-proof b { color: var(--ink); font-weight: 600; }
        .pp-proof span { display: inline-flex; align-items: center; gap: 6px; }
        .pp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }
        .pp-proof-sep { width: 1px; height: 14px; background: var(--hair); }

        .pp-list { max-width: 560px; padding: 14px; border: 1px solid var(--hair); border-radius: 14px; background: var(--surface); display: flex; flex-direction: column; gap: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .pp-list-header-bar { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--ink-2); padding: 0 4px 4px; border-bottom: 1px solid var(--hair-2); margin-bottom: 4px; }
        .pp-badge-count { font-weight: 600; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 4px; font-size: 11.5px; }
        .pp-list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .pp-list-head { font-size: 13.5px; color: var(--ink-2); padding: 0 2px 2px; }
        .pp-list-more { padding: 6px 4px 2px; font-size: 13px; color: var(--ink-3); }
        
        .pp-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px; background: #fff; font: inherit; color: inherit; cursor: pointer; transition: all .12s; }
        .pp-row:hover:not(:disabled) { border-color: var(--accent); background: #FAF9F6; transform: translateY(-1px); }
        .pp-row:disabled { opacity: .7; cursor: default; }
        .pp-row-ico { flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; background: var(--accent-soft); color: var(--accent); }
        .pp-row-txt { display: flex; flex-direction: column; min-width: 0; }
        .pp-row-title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-row-meta { font-size: 12px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-row-go { margin-left: auto; flex: none; font-size: 12px; font-weight: 600; color: var(--accent); }

        .pp-jobcard { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--accent-line); border-radius: 14px; padding: 16px 20px 0; max-width: 560px; box-shadow: 0 1px 2px rgba(25,23,19,.05), 0 6px 20px -8px rgba(25,23,19,.09); }
        .pp-jobcard::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--good); }
        .pp-jobcard-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .pp-jobcard-flag { font: 500 11px var(--font-spline-mono), monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 6px; }
        .pp-jobcard-ago { margin-left: auto; font: 500 11.5px var(--font-spline-mono), monospace; color: var(--ink-3); }
        .pp-jobcard h3 { margin: 0; font-family: var(--font-fraunces), Georgia, serif; font-size: 19px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.25; color: var(--ink); }
        .pp-jobcard-meta { margin: 4px 0 0; font-size: 13px; color: var(--ink-2); }
        .pp-jobcard-meta b { color: var(--ink); font-weight: 600; }
        .pp-jobcard-foot { margin: 14px -20px 0; padding: 11px 20px 12px; border-top: 1px solid var(--hair-2); display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-2); }
        .pp-jobcard-avatar { width: 34px; height: 34px; border-radius: 50%; flex: none; background: #F0ECE2; color: #97907E; border: 1px solid var(--hair); display: grid; place-items: center; font-size: 12px; font-weight: 600; }
        .pp-jobcard-who { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pp-blur { display: inline-block; filter: blur(4px); color: var(--ink); font-weight: 600; user-select: none; }
        .pp-jobcard-btn { flex: none; height: 28px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; color: #fff; background: var(--accent); border-radius: 6px; font-size: 12px; font-weight: 600; }
        .pp-thing-note { margin: 2px 0 0; font-size: 13px; color: var(--ink-2); max-width: 54ch; line-height: 1.5; background: var(--surface); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--hair); }

        /* The optimized price card */
        .pp-card { position: relative; background: var(--surface); border: 2px solid var(--accent-line); border-radius: 18px; padding: 26px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 4px 12px rgba(27,79,130,.08), 0 20px 40px -16px rgba(25,23,19,.15); }
        .pp-card-badge { align-self: flex-start; background: #FEF3C7; color: #92400E; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; letter-spacing: .02em; }
        
        .pp-price-lockup { display: flex; flex-direction: column; gap: 4px; padding-bottom: 4px; border-bottom: 1px solid var(--hair-2); }
        .pp-price { display: flex; align-items: baseline; gap: 12px; }
        .pp-price b { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 48px; letter-spacing: -0.02em; line-height: 1; color: var(--ink); }
        .pp-price-meta { display: flex; flex-direction: column; }
        .pp-strike { font-size: 14px; color: var(--ink-3); text-decoration: line-through; font-weight: 500; }
        .pp-price-sub { font-size: 12.5px; color: var(--ink-2); font-weight: 500; }

        .pp-bullets { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 13.5px; line-height: 1.45; }
        .pp-bullets li { display: flex; gap: 10px; align-items: flex-start; }
        .pp-bullets b { font-weight: 600; color: var(--ink); }
        
        .pp-btn { display: block; width: 100%; text-align: center; font: inherit; font-size: 15.5px; font-weight: 700; padding: 15px 16px; border-radius: 12px; cursor: pointer; text-decoration: none; border: 0; transition: background .15s, transform .1s; box-shadow: 0 2px 6px rgba(27,79,130,.25); }
        .pp-btn-primary { background: var(--cta); color: #fff; }
        .pp-btn-primary:hover:not(:disabled) { background: var(--cta-h); transform: translateY(-1px); }
        .pp-btn:disabled { opacity: .7; cursor: default; }
        .pp-btn:focus-visible, .pp a:focus-visible, .pp summary:focus-visible, .pp-row:focus-visible, .pp-quarter:focus-visible { outline: 2px solid var(--cta); outline-offset: 2px; }
        
        .pp-guarantee-box { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.4; color: var(--ink-2); background: rgba(0,0,0,0.02); padding: 10px 12px; border-radius: 8px; }
        .pp-guarantee-box svg { flex: none; color: var(--good); margin-top: 1px; }

        .pp-divider { display: flex; align-items: center; text-align: center; color: var(--ink-3); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin: -4px 0; }
        .pp-divider::before, .pp-divider::after { content: ''; flex: 1; border-bottom: 1px solid var(--hair); }
        .pp-divider span { padding: 0 10px; }

        .pp-quarter { background: var(--surface); border: 1px solid var(--hair); padding: 11px 12px; border-radius: 10px; font: inherit; font-size: 13px; color: var(--ink-2); cursor: pointer; text-align: center; transition: border-color .12s; }
        .pp-quarter b { color: var(--accent); font-weight: 600; }
        .pp-quarter:hover:not(:disabled) { border-color: var(--accent); background: #FAF9F6; }
        .pp-quarter:disabled { opacity: .7; cursor: default; }
        
        .pp-err { font-size: 13px; color: #C23B22; text-align: center; margin: 0; background: #FEE2E2; padding: 8px; border-radius: 6px; }

        .pp-faq h2 { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 22px; letter-spacing: -0.01em; margin: 0 0 12px; }
        .pp-faq { max-width: 720px; display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
        .pp-faq details { border: 1px solid var(--hair); border-radius: 12px; background: var(--surface); padding: 12px 16px; }
        .pp-faq summary { font-weight: 600; font-size: 14.5px; cursor: pointer; color: var(--ink); }
        .pp-faq p { margin: 8px 0 0; font-size: 14px; line-height: 1.55; color: var(--ink-2); }
        
        .pp-footer { max-width: 1080px; margin: 0 auto; padding: 0 24px 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--ink-3); }
        .pp-footer span { display: inline-flex; align-items: center; gap: 6px; }
        .pp-footer a { color: var(--ink-2); text-decoration: none; }
        .pp-footer a:hover { color: var(--ink); }

        .pp-sticky { display: none; }

        @media (max-width: 900px) {
          .pp-main { padding: 28px 20px 40px; }
          .pp-hero { grid-template-columns: minmax(0, 1fr); grid-template-areas: "hook" "price" "thing"; column-gap: 0; row-gap: 20px; margin-bottom: 40px; }
          .pp-sub { font-size: 15px; }
          .pp-card { padding: 20px; gap: 14px; }
          .pp-price b { font-size: 42px; }
          .pp-list, .pp-jobcard { max-width: none; }
          .pp-sticky { display: flex; align-items: center; justify-content: space-between; position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--hair); transform: translateY(110%); transition: transform .2s cubic-bezier(0.16, 1, 0.3, 1); z-index: 20; box-shadow: 0 -4px 16px rgba(0,0,0,0.08); }
          .pp-sticky.is-on { transform: translateY(0); }
          .pp-sticky-txt { display: flex; flex-direction: column; line-height: 1.25; font-size: 12px; color: var(--ink-2); }
          .pp-sticky-txt b { font-size: 15px; color: var(--ink); font-weight: 600; }
          .pp-sticky-strike { font-size: 12px; text-decoration: line-through; color: var(--ink-3); font-weight: 400; margin-left: 2px; }
          .pp-sticky .pp-btn { flex: none; width: auto; padding: 12px 20px; font-size: 14px; }
          .pp-main { padding-bottom: 96px; }
        }
      `}</style>
    </div>
  )
}