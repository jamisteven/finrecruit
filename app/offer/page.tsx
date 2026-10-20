'use client'

import { useEffect, useRef, useState } from 'react'
import { captureAttribution, deviceType, getAttribution, getVisitorId } from '@/lib/attribution'

const FREE_DELAY_HOURS = 48

// Keep these in sync with Stripe. Copy below is derived from them so price changes stay consistent.
const PRICE = { intro: 9, monthly: 15, quarter: 39 }

// One fictional example for the "same role, two ways" section. Labelled as an example on the page;
// never a real person.
const EXAMPLE = {
  title: 'Senior Product Manager',
  company: 'Series B SaaS',
  meta: 'San Francisco (Hybrid)',
  summary: "I'm helping a Series B SaaS company hire a Senior Product Manager. Great team, competitive comp, remote friendly…",
  postedBy: 'Senior Recruiter, Redwood Talent',
}

const SECTOR_LABELS: Record<string, string> = {
  finance: 'Finance', tech: 'Tech', legal: 'Legal', marketing: 'Marketing',
  realestate: 'Real Estate', sales: 'Sales', hr: 'HR & Talent',
}
const sectorLabel = (s?: string | null) => (s && SECTOR_LABELS[s]) || 'Other'

type Plan = 'monthly' | 'quarter'
type LockedRole = { title: string; location: string | null; sector: string | null; posted_at: string | null }
type Withheld = { roles: LockedRole[]; matched: number; total: number; fallback: LockedRole[] }
type LastSearch = { q?: string; sector?: string; locations?: string[]; at?: number }
type Live = { fresh: number; shown: number; hasPass: boolean; addedToday: number; latestAt: string | null }
// The card whose recruiter line brought this visitor here: title, company, location, age. Never the person.
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

// When a withheld role reaches the free feed: "today 14:10" / "tomorrow 09:30" / "Thursday 14:10"
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

export default function OfferPage() {
  const [busy, setBusy] = useState<Plan | null>(null)
  const [err, setErr] = useState(false)
  const [showSticky, setShowSticky] = useState(false)
  // Real numbers from the same API the main page uses (limit=1: one role row, a free sample)
  const [live, setLive] = useState<Live | null>(null)
  // The fresh roles this visitor isn't seeing, matched to their last search on the feed
  const [withheld, setWithheld] = useState<Withheld | null>(null)
  const [lastSearch, setLastSearch] = useState<LastSearch | null>(null)
  const [gateJob, setGateJob] = useState<GateJob | null>(null)
  const priceRef = useRef<HTMLDivElement>(null)
  // Which link sent this visitor here (?src=recruiter_line, feed_top, locked_title, search_bar, hero_plan, …).
  // It decides the first screen, and segments offer_view / cta_click / checkout_events by entry point.
  const srcRef = useRef<string | null>(null)
  const [src, setSrc] = useState<string | null>(null)   // the same value, for render

  const track = (name: string, params: Record<string, unknown> = {}) => {
    try {
      const w = window as unknown as { gtag?: (...a: unknown[]) => void }
      w.gtag?.('event', name, params)
    } catch { /* analytics must never break the page */ }
  }

  useEffect(() => { captureAttribution() }, [])   // in case someone lands here first
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
        // deferred a tick: the React Compiler rejects a synchronous setState inside an effect
        if (v && v.title && Date.now() - (v.at ?? 0) < 30 * 60_000) setTimeout(() => setGateJob(v), 0)
      }
    } catch { /* storage blocked */ }
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
          latestAt: d.jobs?.[0]?.posted_at ?? null,
        }
        setLive(next)
        track('offer_view', { fresh: next.fresh, has_pass: next.hasPass, src: srcRef.current })
        // first-party copy: which link brought this visitor here, so offer views and checkouts can
        // be read by source in Supabase rather than only in GA4
        try {
          fetch('/api/offer-view', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
            body: JSON.stringify({ visitor_id: getVisitorId(), src: srcRef.current, fresh: next.fresh, has_pass: next.hasPass }),
          }).catch(() => {})
        } catch { /* never block the page */ }
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

  // Mobile sticky CTA: appears once the price card has scrolled past
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
      console.error('[checkout] failed', res.status, data)
    } catch (e) { console.error('[checkout] request error', e) }
    setBusy(null); setErr(true)
    setTimeout(() => setErr(false), 8000)
  }

  const hasPass = !!live?.hasPass
  const hidden = live ? Math.max(0, live.fresh - live.shown) : 0
  const hasSearch = !!lastSearch && (!!lastSearch.q || (lastSearch.locations?.length ?? 0) > 0 || (!!lastSearch.sector && lastSearch.sector !== 'all'))
  const searchMatched = !!withheld && withheld.roles.length > 0 && hasSearch
  const searchDesc = describeSearch(lastSearch)
  const lockedRows: LockedRole[] = withheld ? (withheld.roles.length ? withheld.roles : withheld.fallback) : []

  // One first screen per reason for coming. The skeleton never changes: headline, sub, the thing
  // they came for, the price. Only the thing and the button label vary.
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
    busy === 'monthly' ? 'Opening secure checkout…'
    : variant === 'recruiter' ? `See who posted this · $${PRICE.intro}`
    : variant === 'search' ? `Unlock my ${lockedCount} ${q ? `${q} ` : ''}roles · $${PRICE.intro}`
    : variant === 'locked' ? `Unlock all ${lockedCount} · $${PRICE.intro}`
    : `Get instant access · $${PRICE.intro}`

  const lockedRow = (r: LockedRole, i: number, where: string) => (
    <li key={`${r.title}-${i}`}>
      <button type="button" className="pp-row" onClick={() => checkout('monthly', where)} disabled={busy !== null}>
        <span className="pp-row-ico" aria-hidden="true"><LockIcon /></span>
        <span className="pp-row-txt">
          <span className="pp-row-title">{r.title}</span>
          <span className="pp-row-meta">
            {r.location ? r.location : sectorLabel(r.sector)}
            {timeAgo(r.posted_at) ? ` · ${timeAgo(r.posted_at)}` : ''}
            {unlockLabel(r.posted_at) ? ` · on Free ${unlockLabel(r.posted_at)}` : ''}
          </span>
        </span>
        <span className="pp-row-go">Unlock</span>
      </button>
    </li>
  )

  return (
    <div className="pp">
      {/* Nav is just the logo. Every exit except the CTA is removed; the way back is in the footer. */}
      <header className="pp-top">
        <a className="pp-brand" href="/">backchannel<span>.jobs</span></a>
      </header>

      <main className="pp-main">
        <section className="pp-hero">
          <div className="pp-hook">
            {variant === 'search' && (
              <span className="pp-eyebrow">Your search · {q || sectorLabel(lastSearch?.sector)}{lastSearch?.locations?.length ? ` · ${lastSearch.locations.join(', ')}` : ''}</span>
            )}
            {variant === 'recruiter' && gateJob ? (
              <h1>Be candidate #1 for <em>{gateJob.title}</em>, not #400.</h1>
            ) : variant === 'search' ? (
              <h1><em>{lockedCount.toLocaleString()} {searchDesc}</em> {lockedCount === 1 ? 'was' : 'were'} posted in the last {FREE_DELAY_HOURS} hours. You saw none of {lockedCount === 1 ? 'it' : 'them'}.</h1>
            ) : variant === 'locked' ? (
              <h1><em>{lockedCount.toLocaleString()} roles</em> posted in the last {FREE_DELAY_HOURS} hours. Members are reading them now.</h1>
            ) : (
              <h1>Be candidate #1, <em>not #400.</em></h1>
            )}
            <p className="pp-sub">Public job boards put you at a timing disadvantage. Access newly opened roles immediately and put your application directly on the recruiter&apos;s desk.</p>
            {hasPass && <p className="pp-have">You already have Premium. <a href="/">See today&apos;s new roles →</a> Buying again adds more time.</p>}
          </div>

          <div className="pp-price-col" ref={priceRef}>
            <section className="pp-card">
              <span className="pp-tag">40% off your first month</span>
              <div className="pp-price">
                <b>${PRICE.intro}</b>
                <span className="pp-strike">${PRICE.monthly}</span>
                <span className="pp-price-sub">first month<br />then ${PRICE.monthly}/month</span>
              </div>
              <ul className="pp-bullets">
                <li><CheckCircle /><span><b>Every new role the moment it&apos;s posted</b></span></li>
                <li><CheckCircle /><span>Direct link to the recruiter on every role</span></li>
                {variant === 'search' && q
                  ? <li><CheckCircle /><span><b>We keep searching &ldquo;{q}&rdquo; for you</b>, every few hours</span></li>
                  : <li><CheckCircle /><span>We go looking for your roles specifically</span></li>}
              </ul>
              <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly', 'offer_card')} disabled={busy !== null}>
                {buttonLabel}
              </button>
              <p className="pp-fine">Then ${PRICE.monthly}/month. Cancel in two clicks; you keep access until the period ends.</p>
              <button type="button" className="pp-quarter" onClick={() => checkout('quarter', 'offer_quarter')} disabled={busy !== null}>
                {busy === 'quarter' ? 'Opening secure checkout…' : <>Prefer no subscription? <b>90 days for ${PRICE.quarter} &rarr;</b></>}
              </button>
              {err && <p className="pp-err" role="alert">Checkout didn&apos;t open, and you haven&apos;t been charged. Please try again.</p>}
            </section>
          </div>

          {/* the thing they came for */}
          {!hasPass && (
            <div className="pp-thing">
              {variant === 'recruiter' && gateJob && (
                <>
                  <article className="pp-jobcard">
                    <div className="pp-jobcard-top">
                      <span className="pp-jobcard-flag">With Premium</span>
                      {timeAgo(gateJob.posted_at) && <span className="pp-jobcard-ago">{timeAgo(gateJob.posted_at)}</span>}
                    </div>
                    <h3>{gateJob.title}</h3>
                    <p className="pp-jobcard-meta"><b>{gateJob.company ?? 'Company not disclosed'}</b>{gateJob.location ? ` · ${gateJob.location}` : ''}</p>
                    <div className="pp-jobcard-foot">
                      <span className="pp-jobcard-avatar" aria-hidden="true"><Silhouette /></span>
                      <span className="pp-jobcard-who">Posted by <span className="pp-blur" aria-hidden="true">Firstname Lastname</span> · their name, profile and post</span>
                      <span className="pp-jobcard-btn">View post <OutIcon /></span>
                    </div>
                  </article>
                  <p className="pp-thing-note">The person who posted it and the link to their post, on this role and every other, the moment it goes up.</p>
                </>
              )}

              {(variant === 'search' || variant === 'locked') && rows.length > 0 && (
                <div className="pp-list">
                  <ul>{rows.map((r, i) => lockedRow(r, i, variant === 'search' ? 'offer_search_row' : 'offer_locked_row'))}</ul>
                  <span className="pp-list-more">
                    {more > 0 ? `and ${more.toLocaleString()} more` : 'That’s all of them'}
                    {variant === 'search' ? ', matching your search. Nearby and remote not counted.' : ', newest first.'}
                  </span>
                </div>
              )}

              {variant === 'cold' && (
                <>
                  <div className="pp-proof">
                    {live ? (
                      <>
                        <span><i className="pp-dot" aria-hidden="true" /><b>{live.addedToday.toLocaleString()}</b>&nbsp;added today</span>
                        {timeAgo(live.latestAt) && <><span className="pp-proof-sep" aria-hidden="true" /><span>last one <b>{timeAgo(live.latestAt)}</b></span></>}
                        {hidden > 0 && <><span className="pp-proof-sep" aria-hidden="true" /><span><b>{hidden.toLocaleString()}</b> inside the {FREE_DELAY_HOURS}-hour window right now</span></>}
                      </>
                    ) : <span>&nbsp;</span>}
                  </div>
                  {rows.length > 0 && (
                    <div className="pp-list">
                      <span className="pp-list-head">The newest {rows.length === 1 ? 'one' : rows.length}, locked on Free:</span>
                      <ul>{rows.map((r, i) => lockedRow(r, i, 'offer_locked_row'))}</ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* ───────── Below the fold: one section that shows the difference, then the four real questions ───────── */}
        {!hasPass && (
          <section className="pp-compare">
            <h2>The same role, two ways</h2>
            <div className="pp-compare-grid">
              <article className="pp-jobcard pp-jobcard-free">
                <div className="pp-jobcard-top"><span className="pp-jobcard-flag pp-jobcard-flag-free">On Free · example</span><span className="pp-jobcard-ago">3d ago</span></div>
                <h3>{EXAMPLE.title}</h3>
                <p className="pp-jobcard-meta"><b>{EXAMPLE.company}</b> · {EXAMPLE.meta}</p>
                <p className="pp-jobcard-sum">{EXAMPLE.summary}</p>
                <div className="pp-jobcard-foot">
                  <span className="pp-jobcard-avatar" aria-hidden="true"><Silhouette /></span>
                  <span className="pp-jobcard-who">Posted by <span className="pp-blur" aria-hidden="true">Firstname Lastname</span> · Senior Recruiter</span>
                </div>
              </article>
              <article className="pp-jobcard pp-jobcard-prem">
                <div className="pp-jobcard-top"><span className="pp-jobcard-flag">With Premium · example</span><span className="pp-jobcard-ago pp-jobcard-ago-fresh">11m ago</span></div>
                <h3 className="pp-jobcard-link">{EXAMPLE.title}</h3>
                <p className="pp-jobcard-meta"><b>{EXAMPLE.company}</b> · {EXAMPLE.meta}</p>
                <p className="pp-jobcard-sum">{EXAMPLE.summary}</p>
                <div className="pp-jobcard-foot">
                  <span className="pp-jobcard-avatar pp-jobcard-avatar-on" aria-hidden="true">SR</span>
                  <span className="pp-jobcard-who"><b>{EXAMPLE.postedBy}</b> · named, with their profile</span>
                  <span className="pp-jobcard-btn">View post <OutIcon /></span>
                </div>
              </article>
            </div>
            <p className="pp-compare-note">Left: three days late, with no way to reach the person. Right: eleven minutes after it was posted, with the person. That is the whole difference, on every role.</p>
          </section>
        )}

        <section className="pp-faq">
          <h2>Before you decide</h2>
          <details open><summary>How do I cancel?</summary><p>Menu, top right &rarr; Manage billing &rarr; Cancel. Two clicks. You keep Premium until the end of the period you&apos;ve paid for and aren&apos;t charged again.</p></details>
          <details><summary>What happens after the first month?</summary><p>${PRICE.intro} covers the first month. Then ${PRICE.monthly} a month until you cancel. The 90-day pass is one payment of ${PRICE.quarter} and never renews.</p></details>
          <details><summary>Where do the roles come from?</summary><p>Public LinkedIn posts by recruiters and hiring managers, checked and organised by AI. No scraped job boards, nothing older than 30 days.</p></details>
          <details><summary>What stays free?</summary><p>Every role older than {FREE_DELAY_HOURS} hours, readable in full, plus a few of today&apos;s roles with the recruiter shown. Who posted the rest, and the link to their post, is Premium.</p></details>
        </section>
      </main>

      <footer className="pp-footer">
        <span><ShieldIcon /> Payments by Stripe. We never see your card.</span>
        <a href="/">&larr; Back to the free feed</a>
      </footer>

      {/* Mobile sticky CTA */}
      {!hasPass && (
        <div className={`pp-sticky${showSticky ? ' is-on' : ''}`} aria-hidden={!showSticky}>
          <div className="pp-sticky-txt">
            <b>${PRICE.intro}</b>
            <span>first month</span>
          </div>
          <button type="button" className="pp-btn pp-btn-primary" tabIndex={showSticky ? 0 : -1} onClick={() => checkout('monthly', 'offer_sticky')} disabled={busy !== null}>
            {busy === 'monthly' ? 'Opening…' : variant === 'recruiter' ? 'See who posted this' : variant === 'cold' ? 'Get instant access' : 'Unlock'}
          </button>
        </div>
      )}

      <style>{`
        .pp { --page:#F5F2EB; --surface:#FDFCFA; --ink:#191713; --ink-2:#5C574D; --ink-3:#7A7366; --hair:#D8D2C2; --hair-2:#E4DFD2; --accent-soft:#E4EAF6; --accent-line:#C7D4F5; --cta:#24468f; --cta-h:#1a3368; --accent:#24468f; --good:#0A7A3D; --link:#1B4F82;
          min-height: 100vh; background: var(--page); color: var(--ink); font-family: var(--font-inter), system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .pp *, .pp *::before, .pp *::after { box-sizing: border-box; }
        .pp-top { max-width: 1080px; margin: 0 auto; padding: 22px 24px 0; }
        .pp-brand { font-family: var(--font-fraunces), Georgia, serif; font-size: 22px; font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
        .pp-brand span { color: var(--ink-2); font-weight: 400; }
        .pp-main { max-width: 1080px; margin: 0 auto; padding: 48px 24px 40px; }
        .pp-check { color: var(--good); flex: none; margin-top: 2px; }

        /* ── First screen: headline + sub (left, top), price (right, spanning), the thing (left, below) ── */
        .pp-hero { display: grid; grid-template-columns: minmax(0, 1.15fr) 400px; grid-template-areas: "hook price" "thing price"; column-gap: 64px; row-gap: 22px; align-items: start; margin-bottom: 56px; }
        .pp-hook { grid-area: hook; }
        .pp-price-col { grid-area: price; }
        .pp-thing { grid-area: thing; display: flex; flex-direction: column; gap: 14px; }
        .pp-eyebrow { display: block; font: 500 11.5px var(--font-spline-mono), monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 12px; }
        .pp h1 { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: clamp(30px, 3.4vw, 44px); line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 14px; }
        .pp h1 em { font-style: normal; color: var(--accent); }
        .pp-sub { font-size: 17px; line-height: 1.55; color: var(--ink-2); margin: 0; max-width: 50ch; }
        .pp-have { margin: 12px 0 0; font-size: 14px; color: var(--ink-2); }
        .pp-have a { color: var(--accent); font-weight: 600; }

        /* proof line: live numbers only */
        .pp-proof { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 13.5px; color: var(--ink-2); min-height: 20px; }
        .pp-proof b { color: var(--ink); font-weight: 600; }
        .pp-proof span { display: inline-flex; align-items: center; gap: 7px; }
        .pp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }
        .pp-proof-sep { width: 1px; height: 14px; background: var(--hair); }

        /* locked rows */
        .pp-list { max-width: 560px; padding: 12px 12px 10px; border: 1px solid var(--hair); border-radius: 14px; background: var(--surface); display: flex; flex-direction: column; gap: 6px; }
        .pp-list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .pp-list-head { font-size: 13.5px; color: var(--ink-2); padding: 0 2px 2px; }
        .pp-list-more { padding: 6px 4px 2px; font-size: 13px; color: var(--ink-3); }
        .pp-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 9px 12px; border: 1px solid var(--hair); border-radius: 10px; background: #fff; font: inherit; color: inherit; cursor: pointer; transition: border-color .12s; }
        .pp-row:hover:not(:disabled) { border-color: var(--accent); }
        .pp-row:disabled { opacity: .7; cursor: default; }
        .pp-row-ico { flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; background: var(--hair-2); color: var(--ink-2); }
        .pp-row-txt { display: flex; flex-direction: column; min-width: 0; }
        .pp-row-title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-row-meta { font-size: 12.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-row-go { margin-left: auto; flex: none; font-size: 12.5px; font-weight: 600; color: var(--accent); }

        /* a feed card, as on the home page */
        .pp-jobcard { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--accent-line); border-radius: 14px; padding: 16px 20px 0; max-width: 560px; box-shadow: 0 1px 2px rgba(25,23,19,.05), 0 6px 20px -8px rgba(25,23,19,.09); }
        .pp-jobcard::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--good); }
        .pp-jobcard-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .pp-jobcard-flag { font: 500 11px var(--font-spline-mono), monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 6px; }
        .pp-jobcard-flag-free { color: var(--ink-2); background: #EFEBE1; }
        .pp-jobcard-ago { margin-left: auto; font: 500 11.5px var(--font-spline-mono), monospace; color: var(--ink-3); }
        .pp-jobcard-ago-fresh { color: var(--good); }
        .pp-jobcard h3 { margin: 0; font-family: var(--font-fraunces), Georgia, serif; font-size: 19px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.25; color: var(--ink); }
        .pp-jobcard h3.pp-jobcard-link { color: var(--link); }
        .pp-jobcard-meta { margin: 4px 0 0; font-size: 13px; color: var(--ink-2); }
        .pp-jobcard-meta b { color: var(--ink); font-weight: 600; }
        .pp-jobcard-sum { margin: 8px 0 0; font-size: 13px; color: var(--ink-2); line-height: 1.5; }
        .pp-jobcard-foot { margin: 14px -20px 0; padding: 11px 20px 12px; border-top: 1px solid var(--hair-2); display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-2); }
        .pp-jobcard-avatar { width: 34px; height: 34px; border-radius: 50%; flex: none; background: #F0ECE2; color: #97907E; border: 1px solid var(--hair); display: grid; place-items: center; font-size: 12px; font-weight: 600; }
        .pp-jobcard-avatar-on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
        .pp-jobcard-who { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pp-jobcard-who b { color: var(--ink); font-weight: 600; }
        .pp-blur { display: inline-block; filter: blur(4px); color: var(--ink); font-weight: 600; user-select: none; }
        .pp-jobcard-btn { flex: none; height: 28px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; color: var(--ink); border: 1.5px solid #B9B2A2; border-radius: 8px; font-size: 12px; font-weight: 600; }
        .pp-thing-note { margin: -2px 0 0; font-size: 13px; color: var(--ink-3); max-width: 54ch; line-height: 1.5; }

        /* the one price card */
        .pp-card { position: relative; background: var(--surface); border: 1px solid var(--hair); border-radius: 18px; padding: 24px 26px 20px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 2px 4px rgba(25,23,19,.06), 0 18px 40px -16px rgba(25,23,19,.18); }
        .pp-tag { align-self: flex-start; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
        .pp-price { display: flex; align-items: baseline; gap: 10px; }
        .pp-price b { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 52px; letter-spacing: -0.02em; line-height: 1; }
        .pp-price-sub { font-size: 13px; color: var(--ink-2); line-height: 1.3; }
        .pp-strike { font-size: 18px; color: var(--ink-3); text-decoration: line-through; }
        .pp-bullets { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 14px; line-height: 1.4; }
        .pp-bullets li { display: flex; gap: 9px; align-items: flex-start; }
        .pp-bullets b { font-weight: 600; }
        .pp-btn { display: block; width: 100%; text-align: center; font: inherit; font-size: 15.5px; font-weight: 700; padding: 15px 16px; border-radius: 12px; cursor: pointer; text-decoration: none; border: 0; transition: background .15s; }
        .pp-btn-primary { background: var(--cta); color: #fff; }
        .pp-btn-primary:hover:not(:disabled) { background: var(--cta-h); }
        .pp-btn:disabled { opacity: .7; cursor: default; }
        .pp-btn:focus-visible, .pp a:focus-visible, .pp summary:focus-visible, .pp-row:focus-visible, .pp-quarter:focus-visible { outline: 2px solid var(--cta); outline-offset: 2px; }
        .pp-fine { font-size: 12.5px; line-height: 1.5; color: var(--ink-2); text-align: center; margin: -4px 0 0; }
        .pp-quarter { background: none; border: 0; padding: 4px 0 0; font: inherit; font-size: 13px; color: var(--ink-2); cursor: pointer; text-align: center; }
        .pp-quarter b { color: var(--accent); font-weight: 600; }
        .pp-quarter:hover:not(:disabled) b { text-decoration: underline; text-underline-offset: 3px; }
        .pp-quarter:disabled { opacity: .7; cursor: default; }
        .pp-err { font-size: 13px; color: #C23B22; text-align: center; margin: 0; }

        /* below the fold */
        .pp-compare { margin-bottom: 44px; }
        .pp-compare h2, .pp-faq h2 { font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 26px; letter-spacing: -0.01em; margin: 0 0 16px; }
        .pp-compare-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .pp-compare-grid .pp-jobcard { max-width: none; }
        .pp-jobcard-free { border-color: var(--hair-2); box-shadow: none; }
        .pp-jobcard-prem { box-shadow: 0 2px 4px rgba(25,23,19,.06), 0 14px 34px -10px rgba(25,23,19,.16); }
        .pp-compare-note { margin: 14px 0 0; font-size: 13.5px; color: var(--ink-2); line-height: 1.5; }
        .pp-faq { max-width: 720px; display: flex; flex-direction: column; gap: 10px; }
        .pp-faq h2 { font-size: 22px; margin-bottom: 4px; }
        .pp-faq details { border: 1px solid var(--hair); border-radius: 12px; background: var(--surface); padding: 12px 16px; }
        .pp-faq summary { font-weight: 600; font-size: 14.5px; cursor: pointer; }
        .pp-faq p { margin: 8px 0 0; font-size: 14px; line-height: 1.55; color: var(--ink-2); }
        .pp-footer { max-width: 1080px; margin: 0 auto; padding: 0 24px 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--ink-3); }
        .pp-footer span { display: inline-flex; align-items: center; gap: 6px; }
        .pp-footer a { color: var(--ink-2); text-decoration: none; }
        .pp-footer a:hover { color: var(--ink); }

        .pp-sticky { display: none; }

        @media (max-width: 900px) {
          /* phone: headline, sub, price, then the thing */
          .pp-main { padding: 28px 20px 40px; }
          .pp-hero { grid-template-columns: minmax(0, 1fr); grid-template-areas: "hook" "price" "thing"; column-gap: 0; row-gap: 18px; margin-bottom: 40px; }
          .pp-sub { font-size: 15px; }
          .pp-card { padding: 18px 18px 16px; gap: 12px; }
          .pp-price b { font-size: 44px; }
          .pp-list, .pp-jobcard { max-width: none; }
          .pp-compare-grid { grid-template-columns: minmax(0, 1fr); }
          .pp-sticky { display: flex; align-items: center; gap: 12px; position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--hair); transform: translateY(110%); transition: transform .2s; z-index: 20; }
          .pp-sticky.is-on { transform: translateY(0); }
          .pp-sticky-txt { display: flex; flex-direction: column; line-height: 1.2; font-size: 12.5px; color: var(--ink-2); }
          .pp-sticky-txt b { font-size: 15px; color: var(--ink); font-weight: 600; }
          .pp-sticky .pp-btn { flex: 1; padding: 13px 14px; font-size: 14.5px; }
          .pp-main { padding-bottom: 96px; }
        }
      `}</style>
    </div>
  )
}
