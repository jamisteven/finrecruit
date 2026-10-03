'use client'

import { useEffect, useRef, useState } from 'react'
import { captureAttribution, deviceType, getAttribution, getVisitorId } from '@/lib/attribution'

const FREE_DELAY_HOURS = 48

// Keep these in sync with Stripe. Copy below is derived from them so price changes stay consistent.
const PRICE = { intro: 9, monthly: 15, quarter: 39 }

type Plan = 'monthly' | 'quarter'
type Live = { fresh: number; shown: number; hasPass: boolean }

export default function OfferPage() {
  const [busy, setBusy] = useState<Plan | null>(null)
  const [err, setErr] = useState(false)
  const [showSticky, setShowSticky] = useState(false)
  // Real numbers from the same API the main page uses (limit=1: no role data is downloaded)
  const [live, setLive] = useState<Live | null>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  const track = (name: string, params: Record<string, unknown> = {}) => {
    try {
      const w = window as unknown as { gtag?: (...a: unknown[]) => void }
      w.gtag?.('event', name, params)
    } catch { /* analytics must never break the page */ }
  }

  useEffect(() => { captureAttribution() }, [])   // in case someone lands here first
  useEffect(() => {
    fetch('/api/jobs?limit=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const next: Live = {
          // roles posted inside the free delay window = the ones free visitors can't see, plus the few shown as samples
          shown: d.previewCount ?? 0,
          fresh: (d.withheld ?? 0) + (d.previewCount ?? 0),
          hasPass: !!d.hasPass,
        }
        setLive(next)
        track('offer_view', { fresh: next.fresh, has_pass: next.hasPass })
      })
      .catch(() => {})
  }, [])

  // Mobile sticky CTA: appears once the plan cards have scrolled past
  useEffect(() => {
    const el = cardsRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setShowSticky(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const checkout = async (plan: Plan, where: string) => {
    if (busy) return
    track('cta_click', { where, plan })
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
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) { window.location.href = data.url; return }
      console.error('[checkout] failed', res.status, data)
    } catch (e) { console.error('[checkout] request error', e) }
    setBusy(null); setErr(true)
    setTimeout(() => setErr(false), 8000)
  }

  const hasPass = !!live?.hasPass
  const fresh = live && !hasPass && live.fresh > 0 ? live.fresh : 0
  const freshTxt = fresh.toLocaleString()
  const hidden = live ? Math.max(0, live.fresh - live.shown) : 0
  const errMsg = <p className="pp-err" role="alert">Checkout didn&apos;t open, and you haven&apos;t been charged. Please try again.</p>

  return (
    <div className="pp">
      <header className="pp-top">
        <a className="pp-brand" href="/">backchannel<span>.jobs</span></a>
        <a className="pp-back" href="/">← Back to roles</a>
      </header>

      <main className="pp-main">
        {/* ───────── Compact hero ───────── */}
        <h1>The best roles go in two days ,<em>see them in two minutes.</em></h1>
        <p className="pp-sub">
          Free shows roles after {FREE_DELAY_HOURS} hours, once the applications have piled up. Premium shows every recruiter post the moment it goes live.
        </p>

        {hasPass && <p className="pp-have">You already have Premium. <a href="/">See today&apos;s new roles →</a> Buying again adds more time.</p>}

        {fresh > 0 && (
          <p className="pp-live" aria-live="polite">
            <span className="pp-dot" />
            <b>{freshTxt} new roles posted in the last {FREE_DELAY_HOURS}h.</b>{' '}
            {hidden > 0 ? <>{hidden.toLocaleString()} are locked on Free.</> : <>Free can&apos;t see them yet.</>}
          </p>
        )}

        {/* ───────── Pricing, above the fold ───────── */}
        <div className="pp-cards" ref={cardsRef}>
          <section className="pp-card pp-free">
            <h2>Free</h2>
            <div className="pp-price"><b>$0</b><span>old roles only</span></div>
            <ul>
              <li>Every role older than {FREE_DELAY_HOURS} hours</li>
              <li>3 fresh roles in full each day</li>
              <li className="no">Nothing posted in the last {FREE_DELAY_HOURS} hours</li>
              <li className="no">No first look at new recruiter posts</li>
            </ul>
            <a className="pp-btn pp-btn-ghost" href="/login" onClick={() => track('cta_click', { where: 'offer_free_account' })}>Create a free account</a>
            <p className="pp-fine"><a href="/" onClick={() => track('cta_click', { where: 'offer_free_browse' })}>or just keep browsing</a></p>
          </section>

          <section className="pp-card pp-paid">
            <span className="pp-tag">Best way to start</span>
            <h2>Premium monthly</h2>
            <div className="pp-price"><b>${PRICE.intro}</b><span>first month<br />then ${PRICE.monthly}/month</span></div>
            <ul>
              <li><b>Every new role the moment it&apos;s posted</b></li>
              <li>Full details + direct recruiter link on every role</li>
              <li>Everything in Free</li>
              <li>Cancel in two clicks, anytime</li>
            </ul>
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly', 'offer_card')} disabled={busy !== null}>
              {busy === 'monthly' ? 'Opening secure checkout…' : fresh > 0 ? `Unlock ${freshTxt} new roles · $${PRICE.intro}` : `Get early access · $${PRICE.intro}`}
            </button>
            <p className="pp-fine">Then ${PRICE.monthly}/month until you cancel. Secure payment by Stripe.</p>
            {err && errMsg}
          </section>

          <section className="pp-card">
            <span className="pp-tag pp-tag-quiet">No subscription</span>
            <h2>Premium 3 months</h2>
            <div className="pp-price"><b>${PRICE.quarter}</b><span>one payment<br />90 days</span></div>
            <ul>
              <li><b>Everything in Premium monthly</b></li>
              <li>About ${Math.round(PRICE.quarter / 3)} a month, paid once</li>
              <li>Covers a full job search</li>
              <li>Never renews, nothing to cancel</li>
            </ul>
            <button type="button" className="pp-btn pp-btn-secondary" onClick={() => checkout('quarter', 'offer_card')} disabled={busy !== null}>
              {busy === 'quarter' ? 'Opening secure checkout…' : `Get 90 days · $${PRICE.quarter}`}
            </button>
            <p className="pp-fine">Single payment. Secure payment by Stripe.</p>
          </section>
        </div>

        {/* ───────── FAQ ───────── */}
        <section className="pp-faq">
          <h3>Common questions</h3>
          <details><summary>Why does seeing a role early matter?</summary><p>The first applications land in an empty inbox and get read properly. Two days later there can be hundreds. Premium puts you in that first group. Everything older stays free.</p></details>
          <details><summary>How do I cancel?</summary><p>Open the menu in the top right, choose Manage billing, and cancel. You keep Premium until the end of the period you&apos;ve paid for and won&apos;t be charged again.</p></details>
          <details><summary>What happens after the first month?</summary><p>The ${PRICE.intro} covers your first month. After that it renews at ${PRICE.monthly} a month until you cancel.</p></details>
          <details><summary>Does the 3-month option renew?</summary><p>No. It&apos;s one payment for 90 days and then it simply ends. You can buy again or switch to monthly whenever you like.</p></details>
          <details><summary>Where do the roles come from?</summary><p>Public LinkedIn posts from recruiters and hiring managers, collected and organised by AI.</p></details>
        </section>
      </main>

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
        .pp-top { max-width: 1000px; margin: 0 auto; padding: 18px 20px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .pp-brand { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
        .pp-brand span { color: var(--ink-2); font-weight: 400; }
        .pp-back { font-size: 14px; color: var(--ink-2); text-decoration: none; }
        .pp-back:hover { color: var(--ink); }
        .pp-main { max-width: 1000px; margin: 0 auto; padding: 26px 20px 72px; }

        /* Hero (kept short so the cards sit above the fold) */
        .pp h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(28px, 4.4vw, 40px); line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 10px; max-width: 760px; }
        .pp h1 em { font-style: normal; color: var(--accent); }
        .pp-sub { font-size: 16px; line-height: 1.5; color: var(--ink-2); max-width: 640px; margin: 0 0 14px; }
        .pp-have { margin: 0 0 14px; font-size: 14px; color: var(--ink-2); }
        .pp-have a { color: var(--cta); font-weight: 600; }
        .pp-live { display: inline-block; margin: 0 0 26px; padding: 8px 14px; border: 1px solid var(--hair); border-radius: 999px; background: var(--surface); font-size: 14px; line-height: 1.4; }
        .pp-live b { font-weight: 600; }
        .pp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--good); margin-right: 8px; vertical-align: 1px; box-shadow: 0 0 0 0 rgba(10,122,61,.5); animation: pp-pulse 2s infinite; }
        @keyframes pp-pulse { 70% { box-shadow: 0 0 0 7px rgba(10,122,61,0); } 100% { box-shadow: 0 0 0 0 rgba(10,122,61,0); } }

        /* Cards */
        .pp-cards { display: grid; grid-template-columns: 1fr 1.08fr 1fr; gap: 16px; align-items: stretch; margin-top: 12px; }
        .pp-card { position: relative; background: var(--surface); border: 1px solid var(--hair); border-radius: 16px; padding: 26px 22px 20px; display: flex; flex-direction: column; }
        .pp-paid { background: var(--accent-soft); border: 2px solid var(--cta); box-shadow: 0 14px 34px -14px rgba(47,107,242,0.4); }
        .pp-tag { position: absolute; top: -12px; left: 20px; background: var(--cta); color: #fff; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
        .pp-tag-quiet { background: var(--ink); }
        .pp h2 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
        .pp-price { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .pp-price b { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 44px; letter-spacing: -0.02em; line-height: 1; }
        .pp-price span { font-size: 14px; color: var(--ink-2); line-height: 1.3; }
        .pp-card ul { list-style: none; padding: 0; margin: 0 0 20px; display: grid; gap: 9px; flex: 1; align-content: start; }
        .pp-card li { font-size: 15px; line-height: 1.4; padding-left: 24px; position: relative; }
        .pp-card li b { font-weight: 600; }
        .pp-card li::before { content: ''; position: absolute; left: 2px; top: 5px; width: 6px; height: 11px; border: solid var(--accent); border-width: 0 2px 2px 0; transform: rotate(45deg) scale(.85); }
        .pp-card li.no { color: var(--ink-2); }
        .pp-card li.no::before { border: none; width: auto; height: auto; top: 0; left: 3px; transform: none; content: '\\00d7'; font-size: 18px; line-height: 1.2; color: #B3402A; font-weight: 600; }

        /* Buttons */
        .pp-btn { display: block; width: 100%; text-align: center; font: inherit; font-size: 16px; font-weight: 600; padding: 14px 16px; border-radius: 12px; cursor: pointer; text-decoration: none; border: 1px solid transparent; transition: background .15s, border-color .15s, color .15s; }
        .pp-btn-primary { background: var(--cta); color: #fff; box-shadow: 0 8px 20px -8px rgba(47,107,242,.6); }
        .pp-btn-primary:hover:not(:disabled) { background: var(--cta-h); }
        .pp-paid .pp-btn-primary { padding: 16px; font-size: 17px; }
        .pp-btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--ink); }
        .pp-btn-secondary:hover:not(:disabled) { background: var(--ink); color: #fff; }
        .pp-btn-ghost { background: transparent; color: var(--ink); border-color: var(--hair); }
        .pp-btn-ghost:hover { border-color: var(--ink-2); }
        .pp-btn:disabled { opacity: .7; cursor: default; }
        .pp-btn:focus-visible, .pp a:focus-visible, .pp summary:focus-visible { outline: 2px solid var(--cta); outline-offset: 2px; }
        .pp-fine { font-size: 13px; color: var(--ink-2); text-align: center; margin: 10px 0 0; }
        .pp-fine a { color: var(--ink-2); }
        .pp-err { font-size: 13px; color: #C23B22; text-align: center; margin: 8px 0 0; }


        /* FAQ */
        .pp-faq { margin-top: 40px; max-width: 640px; }
        .pp-faq h3 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
        .pp details { border-top: 1px solid var(--hair); padding: 14px 0; }
        .pp details:last-child { border-bottom: 1px solid var(--hair); }
        .pp summary { cursor: pointer; font-weight: 500; font-size: 15px; }
        .pp details p { margin: 10px 0 0; color: var(--ink-2); font-size: 15px; line-height: 1.55; }

        .pp-sticky { display: none; }

        @media (max-width: 760px) {
          .pp-main { padding-top: 18px; padding-bottom: 110px; }
          .pp-cards { grid-template-columns: 1fr; gap: 22px; }
          .pp-paid { order: -2; }
          .pp-free { order: 1; }
          .pp-live { border-radius: 14px; }
          .pp-sticky { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; gap: 12px; align-items: center; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--hair); box-shadow: 0 -8px 24px -12px rgba(25,23,19,.3); transform: translateY(110%); transition: transform .25s ease; }
          .pp-sticky.is-on { transform: none; }
          .pp-sticky-txt { display: grid; font-size: 14px; line-height: 1.3; min-width: 0; }
          .pp-sticky-txt b { font-weight: 600; }
          .pp-sticky-txt span { font-size: 12px; color: var(--ink-2); }
          .pp-sticky .pp-btn { width: auto; flex: none; margin-left: auto; padding: 12px 22px; }
        }
        @media (prefers-reduced-motion: reduce) { .pp-dot { animation: none; } .pp-sticky, .pp-btn { transition: none; } }
      `}</style>
    </div>
  )
}
