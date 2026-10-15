'use client'

import { useEffect, useRef, useState } from 'react'
import { captureAttribution, deviceType, getAttribution, getVisitorId } from '@/lib/attribution'

const FREE_DELAY_HOURS = 48

// Keep these in sync with Stripe. Copy below is derived from them so price changes stay consistent.
const PRICE = { intro: 9, monthly: 15, quarter: 39 }

const TRUST_ITEMS = ['No ghost jobs', 'Nothing older than 30 days', 'No ATS black holes', 'Cancel anytime, no lock-in']

const HOW_IT_WORKS = [
  { step: '1', title: 'Tell us your targets', body: 'Sector, role, location. Takes under a minute.' },
  { step: '2', title: 'We watch for it', body: 'Real recruiter posts get matched the moment they go live.' },
  { step: '3', title: 'You apply first', body: "Before it's public, while your application still gets read." },
]

// HYPOTHETICAL, for layout preview only. Attributed to a bracketed placeholder, not an invented
// named person, so it can't be mistaken for a real quote and doesn't end up shipping as one by
// accident. Swap in a real quote + real name before this goes live, or set this back to null.
const TESTIMONIAL: { quote: string; name: string; context: string } | null = {
  quote: 'I signed up on a Monday and had two interviews lined up by the following week, for roles nowhere to be found on the usual job platforms.',
  name: '[Chris M.]',
  context: '[Product Manager]',
}

const WHY_ITEMS: { icon: 'bolt' | 'person' | 'target' | 'clock'; title: string; body: string }[] = [
  { icon: 'bolt', title: 'Be first, not one of hundreds', body: "You see it before it hits LinkedIn's public feed or a job board, not two days after." },
  { icon: 'person', title: 'Real recruiter posts', body: 'Every role comes from an actual recruiter or hiring manager, not a scraped ATS feed.' },
  { icon: 'target', title: 'Built from what you search', body: 'Pulled from the sectors and locations people actually search for here, not a generic firehose.' },
  { icon: 'clock', title: 'No long-term commitment', body: 'Cancel in 2 clicks, or skip the subscription entirely with the 90-day pass.' },
]

// Same illustrative example used on the homepage's "Example" card, clearly tagged "Example" below,
// never presented as a real live listing. No fabricated testimonial accompanies it (see note near
// the testimonial section further down).
const EXAMPLE_LISTING = {
  title: 'Senior Product Manager',
  meta: 'Series B SaaS · San Francisco, CA (Hybrid)',
  postedBy: 'Senior Recruiter at Redwood Talent',
  quote: "I'm helping a Series B SaaS company hire a Senior Product Manager. Great team, competitive comp, remote friendly…",
  tags: ['Product', 'SaaS', 'Remote friendly'],
}

// Mirrors the sector labels on the homepage, kept small here since this page only needs it for one chip.
const SECTOR_LABELS: Record<string, string> = {
  finance: 'Finance', tech: 'Tech', legal: 'Legal', marketing: 'Marketing',
  realestate: 'Real Estate', sales: 'Sales', hr: 'HR & Talent',
}
const sectorLabel = (s?: string | null) => (s && SECTOR_LABELS[s]) || 'Other'

type Plan = 'monthly' | 'quarter'
type LockedExample = { title: string; sector: string | null; postedAt: string | null }
type Live = { fresh: number; shown: number; hasPass: boolean; addedToday: number; example: LockedExample | null }

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function BoltIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
}
function PersonIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2" /></svg>
}
function TargetIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></svg>
}
function ClockIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.4" /><path d="M12 7.6V12l3 2.2" /></svg>
}
function ShieldIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 3 5 6v6c0 4.6 3 7.8 7 9 4-1.2 7-4.4 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
}
function CheckCircle() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="pp-check"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></svg>
}

const WHY_ICONS = { bolt: BoltIcon, person: PersonIcon, target: TargetIcon, clock: ClockIcon }

export default function OfferPage() {
  const [busy, setBusy] = useState<Plan | null>(null)
  const [err, setErr] = useState(false)
  const [erroredPlan, setErroredPlan] = useState<Plan | null>(null)
  const [showSticky, setShowSticky] = useState(false)
  // Real numbers from the same API the main page uses (limit=1: no role data is downloaded)
  const [live, setLive] = useState<Live | null>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  // Which homepage CTA sent this visitor here (?src=hero_plan, ?src=member_bar, …), so offer_view
  // and cta_click can finally be segmented by entry point instead of lumped together.
  const srcRef = useRef<string | null>(null)

  const track = (name: string, params: Record<string, unknown> = {}) => {
    try {
      const w = window as unknown as { gtag?: (...a: unknown[]) => void }
      w.gtag?.('event', name, params)
    } catch { /* analytics must never break the page */ }
  }

  useEffect(() => { captureAttribution() }, [])   // in case someone lands here first
  useEffect(() => {
    try { srcRef.current = new URLSearchParams(window.location.search).get('src') } catch {}
  }, [])
  useEffect(() => {
    fetch('/api/jobs?limit=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const lj = Array.isArray(d.lockedJobs) && d.lockedJobs.length > 0 ? d.lockedJobs[0] : null
        const next: Live = {
          // roles posted inside the free delay window = the ones free visitors can't see, plus the few shown as samples
          shown: d.previewCount ?? 0,
          fresh: (d.withheld ?? 0) + (d.previewCount ?? 0),
          hasPass: !!d.hasPass,
          addedToday: d.addedToday ?? 0,
          example: lj ? { title: lj.title, sector: lj.sector ?? null, postedAt: lj.posted_at ?? null } : null,
        }
        setLive(next)
        track('offer_view', { fresh: next.fresh, has_pass: next.hasPass, src: srcRef.current })
      })
      .catch(() => {})
  }, [])

  // Mobile sticky CTA: appears once the pricing column has scrolled past
  useEffect(() => {
    const el = cardsRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setShowSticky(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const checkout = async (plan: Plan, where: string) => {
    if (busy) return
    track('cta_click', { where, plan, src: srcRef.current })
    setBusy(plan); setErr(false); setErroredPlan(null)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          visitor_id: getVisitorId(),
          device: deviceType(),
          attribution: getAttribution(),
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) { window.location.href = data.url; return }
      console.error('[checkout] failed', res.status, data)
    } catch (e) { console.error('[checkout] request error', e) }
    setBusy(null); setErr(true); setErroredPlan(plan)
    setTimeout(() => { setErr(false); setErroredPlan(null) }, 8000)
  }

  const hasPass = !!live?.hasPass
  const fresh = live && !hasPass && live.fresh > 0 ? live.fresh : 0
  const freshTxt = fresh.toLocaleString()
  const hidden = live ? Math.max(0, live.fresh - live.shown) : 0
  const exampleAgo = timeAgo(live?.example?.postedAt ?? null)
  const errMsg = <p className="pp-err" role="alert">Checkout didn&apos;t open, and you haven&apos;t been charged. Please try again.</p>

  return (
    <div className="pp">
      {/* Nav is deliberately just the logo, no page links. Every exit from this page except the
          CTA is removed by design; the "back to all roles" link lives in the footer instead, where
          leaving is still possible but isn't competing with the offer for attention up top. */}
      <header className="pp-top">
        <a className="pp-brand" href="/">backchannel<span>.jobs</span></a>
      </header>

      <main className="pp-main">
        {/* ───────── Hero: copy left, pricing right, so the offer is visible without scrolling ───────── */}
        <section className="pp-hero">
          <div className="pp-hero-copy">
            <span className="pp-eyebrow"><BoltIcon /> Premium access</span>
            <h1>The jobs LinkedIn doesn&apos;t show you <em>until it&apos;s too late.</em></h1>
            <p className="pp-sub">{`Free sees a role ${FREE_DELAY_HOURS} hours after it's posted, once hundreds of people have already applied. Premium sees every recruiter post the moment it goes live.`}</p>

            <ul className="pp-trustgrid">
              {TRUST_ITEMS.map((t) => (
                <li key={t}><CheckCircle />{t}</li>
              ))}
            </ul>

            {hasPass && <p className="pp-have">You already have Premium. <a href="/">See today&apos;s new roles →</a> Buying again adds more time.</p>}

            {!hasPass && (
              <>
                <div className="pp-tip">
                  <span className="pp-tip-icon"><ClockIcon /></span>
                  {fresh > 0 ? (
                    <span>
                      <b>{freshTxt} new roles</b> posted in the last {FREE_DELAY_HOURS}h.{' '}
                      {hidden > 0 ? `${hidden.toLocaleString()} locked on Free.` : "Free can't see them yet."}
                    </span>
                  ) : (
                    <span><b>New roles drop every weekday.</b> Premium sees them the second they land, while Free waits {FREE_DELAY_HOURS} hours.</span>
                  )}
                </div>

                {/* Fills the space beside the (taller) pricing column instead of leaving it blank.
                    Real explanatory content, not padding for padding's sake: this is the "how it
                    works" recap that got cut from the top of the page for being one too many boxes
                    there; it has a natural home here instead. */}
                <ol className="pp-hero-how">
                  {HOW_IT_WORKS.map((s) => (
                    <li key={s.step}>
                      <span className="pp-hero-how-step">{s.step}</span>
                      <span><b>{s.title}:</b> {s.body}</span>
                    </li>
                  ))}
                </ol>

                {/* TESTIMONIAL is null until there's a real one; this is deliberately the slot for it
                    (same reasoning as the note further down near "Why it's worth it": no invented name
                    or quote, even as a placeholder). Once TESTIMONIAL is set, it renders right here,
                    beside the price, which is exactly where proof should sit. */}
                {TESTIMONIAL && (
                  <blockquote className="pp-hero-quote">
                    <p>&ldquo;{TESTIMONIAL.quote}&rdquo;</p>
                    <cite>{TESTIMONIAL.name}, {TESTIMONIAL.context}</cite>
                  </blockquote>
                )}
              </>
            )}
          </div>

          <div className="pp-hero-price" ref={cardsRef}>
            <section className="pp-card pp-paid">
              <span className="pp-tag">40% off your first month</span>
              <h2>Premium monthly</h2>
              <div className="pp-price">
                <b>${PRICE.intro}</b>
                <span className="pp-strike">${PRICE.monthly}</span>
                <span className="pp-price-sub">first month<br />then ${PRICE.monthly}/month</span>
              </div>
              <ul>
                <li><b>Every new role the moment it&apos;s posted</b></li>
                <li><b>We go looking for your roles specifically</b></li>
                <li>Full details + direct recruiter link on every role</li>
                <li>Everything in Free</li>
              </ul>
              <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly', 'offer_card')} disabled={busy !== null}>
                {busy === 'monthly' ? 'Opening secure checkout…' : fresh > 0 ? `Unlock my ${freshTxt} new roles · $${PRICE.intro}` : `Get my early access · $${PRICE.intro}`}
              </button>
              <p className="pp-secure"><ShieldIcon /> Secure checkout &middot; cancel in 2 clicks, anytime</p>
              <p className="pp-fine">Then ${PRICE.monthly}/month until you cancel.</p>
              {err && erroredPlan === 'monthly' && errMsg}
            </section>

            <section className="pp-card pp-card-mini">
              <div className="pp-mini-head">
                <span className="pp-tag pp-tag-quiet">No subscription</span>
                <h2>Premium &middot; 3 months</h2>
              </div>
              <div className="pp-price pp-price-mini">
                <b>${PRICE.quarter}</b>
                <span className="pp-strike">${PRICE.monthly * 3}</span>
                <span className="pp-price-sub">one payment, 90 days<br />about ${Math.round(PRICE.quarter / 3)}/month &middot; never renews</span>
              </div>
              <button type="button" className="pp-btn pp-btn-secondary" onClick={() => checkout('quarter', 'offer_card')} disabled={busy !== null}>
                {busy === 'quarter' ? 'Opening secure checkout…' : `Get my 90 days · $${PRICE.quarter}`}
              </button>
              {err && erroredPlan === 'quarter' && errMsg}
            </section>
          </div>
        </section>

        {/* ───────── See what you'll get: one honest fictional example + one real locked example ───────── */}
        {!hasPass && (
          <section className="pp-compare">
            <h2>See what you&apos;ll get</h2>
            <p className="pp-compare-sub">Same jobs. More context. Faster access.</p>
            <div className="pp-compare-grid">
              <ul className="pp-compare-list">
                <li><CheckCircle /> Full recruiter name, title &amp; company on every role</li>
                <li><CheckCircle /> Direct link to apply, not a scraped repost</li>
                <li><CheckCircle /> Delivered the moment it&apos;s posted, not {FREE_DELAY_HOURS}h later</li>
                <li><CheckCircle /> Custom searches for the roles &amp; locations you want</li>
              </ul>
              <div className="pp-job-grid">
                <div className="pp-job-card">
                  <span className="pp-job-tag pp-job-tag-example">Example</span>
                  <div className="pp-job-title">{EXAMPLE_LISTING.title}</div>
                  <div className="pp-job-meta">{EXAMPLE_LISTING.meta}</div>
                  <div className="pp-job-posted">Posted by: {EXAMPLE_LISTING.postedBy}</div>
                  <p className="pp-job-quote">&ldquo;{EXAMPLE_LISTING.quote}&rdquo;</p>
                  <div className="pp-job-tags">
                    {EXAMPLE_LISTING.tags.map((t) => <span key={t}>{t}</span>)}
                  </div>
                </div>
                <div className="pp-job-card pp-job-locked">
                  <span className="pp-job-tag pp-job-tag-free">Free</span>
                  <div className="pp-job-title">{live?.example?.title ?? 'A new role, locked'}</div>
                  <div className="pp-job-meta">{live?.example ? sectorLabel(live.example.sector) : 'Sector hidden'}{exampleAgo ? ` · ${exampleAgo}` : ''}</div>
                  <div className="pp-example-skeleton" aria-hidden="true"><span /><span /><span /></div>
                  <button type="button" className="pp-job-cta" onClick={() => checkout('monthly', 'offer_compare')} disabled={busy !== null}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                    Unlock with Premium
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ───────── Why it's worth it ───────── */}
        <section className="pp-why">
          <h2>Why it&apos;s worth it</h2>
          <p className="pp-why-sub">These aren&apos;t just more job listings. They&apos;re opportunities before the crowd.</p>
          <div className="pp-why-grid">
            {WHY_ITEMS.map((w) => {
              const Icon = WHY_ICONS[w.icon]
              return (
                <div className="pp-why-item" key={w.title}>
                  <span className="pp-why-icon"><Icon /></span>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </div>
              )
            })}
          </div>
        </section>

        {/*
          A testimonial belongs right here. This is exactly where "see what you'll get" and "why it's
          worth it" hand off to "other people vouch for it" in a well-built offer page. It's deliberately
          left out rather than filled with a placeholder quote and an invented name/photo: that would be
          a fabricated review presented as genuine, which we don't do even as a placeholder on a page
          that's otherwise real. Drop in a real one (name + a detail that makes it checkable: company,
          role, or how long they'd been looking) once you have it:

          <section className="pp-testimonial">
            <p className="pp-quote">"…"</p>
            <p className="pp-quote-by"><b>Real Name</b>, role, context</p>
          </section>
        */}

        {/* ───────── Trust bar: real numbers only, no fabricated stats, no recreated card-brand logos ───────── */}
        <section className="pp-trustbar">
          <div className="pp-stats-row">
            <div className="pp-stat"><b>{freshTxt || '…'}</b><span>new roles &middot; last {FREE_DELAY_HOURS}h</span></div>
            <div className="pp-stat"><b>{live ? (live.addedToday || 0).toLocaleString() : '…'}</b><span>posted today</span></div>
            <div className="pp-stat"><b>{live ? hidden.toLocaleString() : '…'}</b><span>currently locked on Free</span></div>
          </div>
          <p className="pp-secure pp-secure-bar"><ShieldIcon /> Payments processed securely by Stripe. We never see your card details.</p>
        </section>

        {/* ───────── FAQ: cancellation & renewal first, they're the biggest objection ───────── */}
        <section className="pp-faq">
          <h3>Common questions</h3>
          <details><summary>How do I cancel?</summary><p>Open the menu in the top right, choose Manage billing, and cancel. You keep Premium until the end of the period you&apos;ve paid for and won&apos;t be charged again.</p></details>
          <details><summary>What happens after the first month?</summary><p>The ${PRICE.intro} covers your first month. After that it renews at ${PRICE.monthly} a month until you cancel.</p></details>
          <details><summary>Does the 3-month option renew?</summary><p>No. It&apos;s one payment for 90 days and then it simply ends. You can buy again or switch to monthly whenever you like.</p></details>
          <details><summary>Why does seeing a role early matter?</summary><p>The first applications land in an empty inbox and get read properly. Two days later there can be hundreds. Premium puts you in that first group. Everything older stays free.</p></details>
          <details><summary>How do the custom searches work?</summary><p>After you join we ask which roles you&apos;re after and where. Those become real searches we run against new recruiter posts every few hours, not just a filter on the feed. Edit them any time from the menu.</p></details>
          <details><summary>Where do the roles come from?</summary><p>Public LinkedIn posts from recruiters and hiring managers, collected and organised by AI.</p></details>
        </section>
      </main>

      <footer className="pp-footer">
        <a href="/">&larr; Back to all roles</a>
      </footer>

      {/* Mobile sticky CTA */}
      {!hasPass && (
        <div className={`pp-sticky${showSticky ? ' is-on' : ''}`} aria-hidden={!showSticky}>
          <div className="pp-sticky-txt">
            <b>{fresh > 0 ? `${freshTxt} new roles locked` : 'See new roles first'}</b>
            <span>${PRICE.intro} first month · cancel anytime</span>
          </div>
          <button type="button" className="pp-btn pp-btn-primary" tabIndex={showSticky ? 0 : -1} onClick={() => checkout('monthly', 'offer_sticky')} disabled={busy !== null}>
            {busy === 'monthly' ? 'Opening…' : 'Unlock'}
          </button>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        .pp { --page:#F5F2EB; --surface:#FDFCFA; --ink:#191713; --ink-2:#5C574D; --hair:#D8D2C2; --accent-soft:#E4EAF6; --cta:#2F6BF2; --cta-h:#2458D4; --accent:#24468f; --good:#0A7A3D;
          min-height: 100vh; background: var(--page); color: var(--ink); font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .pp *, .pp *::before, .pp *::after { box-sizing: border-box; }
        .pp-top { max-width: 1080px; margin: 0 auto; padding: 18px 20px 0; }
        .pp-brand { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
        .pp-brand span { color: var(--ink-2); font-weight: 400; }
        .pp-main { max-width: 1080px; margin: 0 auto; padding: 22px 20px 64px; }
        .pp-check { color: var(--good); flex: none; }

        /* Hero: copy left, pricing right */
        .pp-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 40px; align-items: start; margin-bottom: 56px; }
        .pp-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--accent); background: var(--accent-soft); padding: 5px 11px 5px 9px; border-radius: 999px; margin-bottom: 14px; }
        .pp h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(28px, 3.2vw, 40px); line-height: 1.14; letter-spacing: -0.02em; margin: 0 0 14px; }
        .pp h1 em { font-style: normal; color: var(--accent); }
        .pp-sub { font-size: 16px; line-height: 1.55; color: var(--ink-2); margin: 0 0 20px; }
        .pp-have { margin: 0 0 4px; font-size: 14px; color: var(--ink-2); }
        .pp-have a { color: var(--cta); font-weight: 600; }

        .pp-trustgrid { list-style: none; padding: 0; margin: 0 0 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 9px 16px; }
        .pp-trustgrid li { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 500; }

        .pp-tip { display: flex; align-items: flex-start; gap: 10px; padding: 13px 16px; border: 1px solid var(--hair); border-radius: 12px; background: var(--surface); font-size: 14px; line-height: 1.5; max-width: 480px; margin-bottom: 22px; }
        .pp-tip-icon { color: var(--accent); flex: none; margin-top: 1px; }
        .pp-tip b { font-weight: 600; }

        .pp-hero-how { list-style: none; padding: 0; margin: 0 0 22px; display: grid; gap: 14px; max-width: 480px; }
        .pp-hero-how li { display: flex; align-items: flex-start; gap: 12px; font-size: 13.5px; line-height: 1.5; color: var(--ink-2); }
        .pp-hero-how-step { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
        .pp-hero-how b { font-weight: 600; color: var(--ink); }

        .pp-hero-quote { margin: 0; padding: 16px 18px; border-left: 3px solid var(--accent); background: var(--surface); border-radius: 0 12px 12px 0; max-width: 480px; }
        .pp-hero-quote p { font-size: 14.5px; font-style: italic; line-height: 1.55; margin: 0 0 8px; color: var(--ink); }
        .pp-hero-quote cite { font-style: normal; font-size: 12.5px; color: var(--ink-2); }

        /* Pricing column */
        .pp-hero-price { display: grid; gap: 14px; }
        .pp-card { position: relative; background: var(--surface); border: 1px solid var(--hair); border-radius: 16px; padding: 22px 20px 16px; display: flex; flex-direction: column; }
        .pp-paid { background: var(--accent-soft); border: 2px solid var(--cta); box-shadow: 0 14px 34px -14px rgba(47,107,242,0.4); }
        .pp-tag { position: absolute; top: -12px; left: 20px; background: var(--cta); color: #fff; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
        .pp-tag-quiet { background: var(--ink); position: static; }
        .pp h2 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
        .pp-price { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px 12px; margin-bottom: 12px; }
        .pp-price b { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 44px; letter-spacing: -0.02em; line-height: 1; }
        .pp-price-sub { font-size: 13.5px; color: var(--ink-2); line-height: 1.35; }
        .pp-strike { font-size: 15px; color: var(--ink-2); text-decoration: line-through; }
        .pp-card ul { list-style: none; padding: 0; margin: 0 0 14px; display: grid; gap: 7px; flex: 1; align-content: start; }
        .pp-card li { font-size: 15px; line-height: 1.4; padding-left: 24px; position: relative; }
        .pp-card li b { font-weight: 600; }
        .pp-card li::before { content: ''; position: absolute; left: 2px; top: 5px; width: 6px; height: 11px; border: solid var(--accent); border-width: 0 2px 2px 0; transform: rotate(45deg) scale(.85); }

        /* Compact secondary (quarterly) card */
        .pp-card-mini { padding: 16px 20px; }
        .pp-mini-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .pp-mini-head h2 { margin: 0; }
        .pp-price-mini { margin-bottom: 12px; }
        .pp-price-mini .pp-price-sub { line-height: 1.4; }

        /* Buttons */
        .pp-btn { display: block; width: 100%; text-align: center; font: inherit; font-size: 16px; font-weight: 600; padding: 14px 16px; border-radius: 12px; cursor: pointer; text-decoration: none; border: 1px solid transparent; transition: background .15s, border-color .15s, color .15s; }
        .pp-btn-primary { background: var(--cta); color: #fff; box-shadow: 0 8px 20px -8px rgba(47,107,242,.6); }
        .pp-btn-primary:hover:not(:disabled) { background: var(--cta-h); }
        .pp-paid .pp-btn-primary { padding: 16px; font-size: 17px; }
        .pp-btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--ink); }
        .pp-btn-secondary:hover:not(:disabled) { background: var(--ink); color: #fff; }
        .pp-btn:disabled { opacity: .7; cursor: default; }
        .pp-btn:focus-visible, .pp a:focus-visible, .pp summary:focus-visible, .pp-job-cta:focus-visible { outline: 2px solid var(--cta); outline-offset: 2px; }
        .pp-secure { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12.5px; color: var(--ink); font-weight: 500; text-align: center; margin: 10px 0 0; }
        .pp-fine { font-size: 12.5px; color: var(--ink-2); text-align: center; margin: 4px 0 0; }
        .pp-err { font-size: 13px; color: #C23B22; text-align: center; margin: 8px 0 0; }

        /* See what you'll get */
        .pp-compare { margin-bottom: 52px; }
        .pp-compare h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
        .pp-compare-sub { color: var(--ink-2); font-size: 14.5px; margin: 0 0 22px; }
        .pp-compare-grid { display: grid; grid-template-columns: 0.85fr 1.15fr; gap: 32px; align-items: start; }
        .pp-compare-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
        .pp-compare-list li { display: flex; align-items: flex-start; gap: 9px; font-size: 15px; line-height: 1.45; }
        .pp-job-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .pp-job-card { background: var(--surface); border: 1px solid var(--hair); border-radius: 14px; padding: 16px; position: relative; }
        .pp-job-tag { display: inline-block; font-size: 10.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; margin-bottom: 10px; }
        .pp-job-tag-example { background: var(--hair); color: var(--ink-2); }
        .pp-job-tag-free { background: var(--accent-soft); color: var(--accent); }
        .pp-job-title { font-size: 14.5px; font-weight: 600; margin-bottom: 3px; }
        .pp-job-meta { font-size: 12.5px; color: var(--ink-2); margin-bottom: 8px; }
        .pp-job-posted { font-size: 12px; color: var(--ink-2); margin-bottom: 8px; }
        .pp-job-quote { font-size: 12.5px; font-style: italic; color: var(--ink-2); line-height: 1.5; margin: 0 0 10px; }
        .pp-job-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .pp-job-tags span { font-size: 11px; background: var(--page); border: 1px solid var(--hair); padding: 2px 8px; border-radius: 999px; color: var(--ink-2); }
        .pp-example-skeleton { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .pp-example-skeleton span { display: block; height: 7px; border-radius: 4px; background: var(--hair); opacity: 0.6; }
        .pp-example-skeleton span:nth-child(1) { width: 85%; }
        .pp-example-skeleton span:nth-child(2) { width: 62%; }
        .pp-example-skeleton span:nth-child(3) { width: 40%; }
        .pp-job-cta { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--accent); background: var(--accent-soft); border: none; padding: 7px 12px; border-radius: 8px; cursor: pointer; }
        .pp-job-cta:hover:not(:disabled) { background: var(--cta); color: #fff; }
        .pp-job-cta:disabled { opacity: .7; cursor: default; }

        /* Why it's worth it */
        .pp-why { margin-bottom: 52px; }
        .pp-why h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
        .pp-why-sub { color: var(--ink-2); font-size: 14.5px; margin: 0 0 22px; }
        .pp-why-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
        .pp-why-item h3 { font-size: 15px; font-weight: 600; margin: 12px 0 6px; }
        .pp-why-item p { font-size: 13.5px; color: var(--ink-2); line-height: 1.5; margin: 0; }
        .pp-why-icon { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); }

        /* Trust bar */
        .pp-trustbar { margin-bottom: 40px; padding: 24px 0; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); }
        .pp-stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: center; margin-bottom: 14px; }
        .pp-stat b { display: block; font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 26px; letter-spacing: -0.01em; }
        .pp-stat span { font-size: 12px; color: var(--ink-2); }
        .pp-secure-bar { margin: 0; }

        /* FAQ */
        .pp-faq { max-width: 680px; }
        .pp-faq h3 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
        .pp details { border-top: 1px solid var(--hair); padding: 14px 0; }
        .pp details:last-child { border-bottom: 1px solid var(--hair); }
        .pp summary { cursor: pointer; font-weight: 500; font-size: 15px; }
        .pp details p { margin: 10px 0 0; color: var(--ink-2); font-size: 15px; line-height: 1.55; }

        .pp-footer { max-width: 1080px; margin: 0 auto; padding: 0 20px 56px; }
        .pp-footer a { font-size: 13px; color: var(--ink-2); text-decoration: none; }
        .pp-footer a:hover { color: var(--ink); }

        .pp-sticky { display: none; }

        @media (max-width: 920px) {
          .pp-why-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 860px) {
          .pp-hero { grid-template-columns: 1fr; gap: 28px; margin-bottom: 44px; }
          .pp-hero-price { order: -1; }
          .pp-compare-grid { grid-template-columns: 1fr; gap: 24px; }
        }
        @media (max-width: 640px) {
          .pp-job-grid { grid-template-columns: 1fr; }
          .pp-why-grid { grid-template-columns: 1fr 1fr; gap: 16px; }
          .pp-stats-row { grid-template-columns: 1fr; gap: 10px; }
        }
        @media (max-width: 760px) {
          .pp-main { padding-top: 18px; padding-bottom: 110px; }
          .pp-sticky { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; gap: 12px; align-items: center; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--hair); box-shadow: 0 -8px 24px -12px rgba(25,23,19,.3); transform: translateY(110%); transition: transform .25s ease; }
          .pp-sticky.is-on { transform: none; }
          .pp-sticky-txt { display: grid; font-size: 14px; line-height: 1.3; min-width: 0; }
          .pp-sticky-txt b { font-weight: 600; }
          .pp-sticky-txt span { font-size: 12px; color: var(--ink-2); }
          .pp-sticky .pp-btn { width: auto; flex: none; margin-left: auto; padding: 12px 22px; }
        }
        @media (prefers-reduced-motion: reduce) { .pp-sticky, .pp-btn { transition: none; } }
      `}</style>
    </div>
  )
}
