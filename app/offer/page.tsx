'use client'

import { useEffect, useRef, useState } from 'react'
import { captureAttribution, deviceType, getAttribution, getVisitorId } from '@/lib/attribution'

const FREE_DELAY_HOURS = 48

// Keep these in sync with Stripe. Copy below is derived from them so price changes stay consistent.
const PRICE = { intro: 9, monthly: 15, quarter: 39 }

type Plan = 'monthly' | 'quarter'
type Live = { fresh: number; shown: number; hasPass: boolean; locked: { title: string; sector: string; posted_at: string | null }[] }

const SECTOR_LABEL: Record<string, string> = { finance: 'Finance', tech: 'Tech', legal: 'Legal', marketing: 'Marketing', realestate: 'Real Estate' }
const ago = (iso: string | null) => {
  if (!iso) return ''
  const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600_000)
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : `${Math.round(h)}h ago`
}

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
)

export default function OfferPage() {
  const [busy, setBusy] = useState<Plan | null>(null)
  const [err, setErr] = useState(false)
  const [showSticky, setShowSticky] = useState(false)
  // Real numbers from the same API the main page uses (limit=1: no role data is downloaded)
  const [live, setLive] = useState<Live | null>(null)
  const heroCta = useRef<HTMLDivElement>(null)

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
          locked: Array.isArray(d.lockedJobs) ? d.lockedJobs : [],
        }
        setLive(next)
        track('offer_view', { fresh: next.fresh, locked: next.locked.length, has_pass: next.hasPass })
      })
      .catch(() => {})
  }, [])

  // Mobile sticky CTA: appears once the hero button has scrolled out of view
  useEffect(() => {
    const el = heroCta.current
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
  const hiddenCount = live ? Math.max(0, live.fresh - live.shown) : 0
  const mainCta = fresh > 0 ? `See all ${freshTxt} new roles for $${PRICE.intro}` : `Get early access for $${PRICE.intro}`
  const errMsg = <p className="pp-err" role="alert">Checkout didn&apos;t open, and you haven&apos;t been charged. Please try again.</p>

  return (
    <div className="pp">
      <header className="pp-top">
        <a className="pp-brand" href="/">backchannel<span>.jobs</span></a>
        <a className="pp-back" href="/">← Back to roles</a>
      </header>

      <main className="pp-main">
        {/* ───────── HERO: outcome-led promise + one clear action ───────── */}
        <section className="pp-hero">
          <div className="pp-hero-copy">
            <p className="pp-eyebrow">Premium early access</p>
            <h1>Apply in the first hours, <em>not after everyone else.</em></h1>
            <p className="pp-sub">
              Recruiters read the first applications first. Premium shows you every new recruiter post the moment it goes live.
              Free visitors wait {FREE_DELAY_HOURS} hours, by which time the pile is already deep.
            </p>

            <div ref={heroCta} className="pp-hero-cta">
              {hasPass ? (
                <>
                  <a className="pp-btn pp-btn-primary" href="/" onClick={() => track('cta_click', { where: 'offer_hero_member' })}>You have Premium · See new roles →</a>
                  <p className="pp-fine">Want more time? Extend below. It adds on to what you already have.</p>
                </>
              ) : (
                <>
                  <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly', 'offer_hero')} disabled={busy !== null}>
                    {busy === 'monthly' ? 'Opening secure checkout…' : mainCta}
                  </button>
                  <ul className="pp-reassure" aria-label="Plan terms">
                    <li>${PRICE.intro} first month, then ${PRICE.monthly}/mo</li>
                    <li>Cancel in two clicks</li>
                    <li>Secure checkout by Stripe</li>
                  </ul>
                  {err && errMsg}
                </>
              )}
            </div>
          </div>

          {/* Live proof: what they're missing right now */}
          {fresh > 0 && (
            <aside className="pp-live" aria-live="polite">
              <p className="pp-live-head">
                <span className="pp-dot" />
                <b>{freshTxt} new roles</b> in the last {FREE_DELAY_HOURS}h
              </p>
              <p className="pp-live-sub">
                {hiddenCount > 0
                  ? <>You can open {live!.shown}. <b>{hiddenCount.toLocaleString()} are locked</b> until they&apos;re {FREE_DELAY_HOURS}h old.</>
                  : <>Free visitors only see these once they&apos;re {FREE_DELAY_HOURS}h old.</>}
              </p>
              {live!.locked.length > 0 && (
                <ul>
                  {live!.locked.map((j, i) => (
                    <li key={i}>
                      <LockIcon />
                      <span className="pp-lt">{j.title}</span>
                      <span className="pp-lm">{SECTOR_LABEL[j.sector] ?? j.sector}{j.posted_at ? ` · ${ago(j.posted_at)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="pp-linkbtn" onClick={() => checkout('monthly', 'offer_live_box')} disabled={busy !== null}>
                Unlock these now →
              </button>
            </aside>
          )}
        </section>

        {/* ───────── WHY TIMING MATTERS: make the 48h gap visible ───────── */}
        <section className="pp-tl" aria-label="When you see a new role">
          <div className="pp-tl-row">
            <span className="pp-tl-name">Premium</span>
            <div className="pp-tl-track"><span className="pp-tl-pin pp-tl-pin-prem" style={{ left: '0%' }}>Sees it instantly</span></div>
          </div>
          <div className="pp-tl-row">
            <span className="pp-tl-name">Free</span>
            <div className="pp-tl-track"><span className="pp-tl-gap" /><span className="pp-tl-pin" style={{ left: '100%' }}>Sees it {FREE_DELAY_HOURS}h later</span></div>
          </div>
          <div className="pp-tl-axis"><span>Recruiter posts</span><span>+24h</span><span>+{FREE_DELAY_HOURS}h</span></div>
        </section>

        {/* ───────── PLANS: two paid options, free demoted ───────── */}
        <section className="pp-plans" id="plans">
          <h2 className="pp-h2">{hasPass ? 'Extend your Premium' : 'Choose how you want to pay'}</h2>
          <p className="pp-h2-sub">Both plans include the same thing: every role, the moment it&apos;s posted.</p>

          <div className="pp-cards">
            <section className="pp-card pp-paid">
              <span className="pp-tag">Best way to start</span>
              <h3>Monthly</h3>
              <div className="pp-price"><b>${PRICE.intro}</b><span>first month<br />then ${PRICE.monthly}/month</span></div>
              <ul>
                <li><b>Every new role the moment it&apos;s posted</b>, {FREE_DELAY_HOURS}h before free</li>
                <li>Full details and a direct link to the recruiter on every role</li>
                <li>Stop the day you land the job: cancel in two clicks</li>
              </ul>
              <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly', 'offer_card')} disabled={busy !== null}>
                {busy === 'monthly' ? 'Opening secure checkout…' : `Start for $${PRICE.intro}`}
              </button>
              <p className="pp-fine">Renews at ${PRICE.monthly}/month until you cancel. Secure payment by Stripe.</p>
              {err && errMsg}
            </section>

            <section className="pp-card">
              <span className="pp-tag pp-tag-quiet">No subscription</span>
              <h3>3-month pass</h3>
              <div className="pp-price"><b>${PRICE.quarter}</b><span>one payment<br />90 days of access</span></div>
              <ul>
                <li><b>Everything in Monthly</b>, for a full 90-day search</li>
                <li>About ${Math.round(PRICE.quarter / 3)} a month, paid once</li>
                <li>Never renews: no card on file, nothing to cancel</li>
              </ul>
              <button type="button" className="pp-btn pp-btn-secondary" onClick={() => checkout('quarter', 'offer_card')} disabled={busy !== null}>
                {busy === 'quarter' ? 'Opening secure checkout…' : `Get 90 days for $${PRICE.quarter}`}
              </button>
              <p className="pp-fine">Single payment. Secure payment by Stripe.</p>
            </section>
          </div>

          {!hasPass && (
            <div className="pp-free">
              <div>
                <b>Not ready? Stay on Free.</b>{' '}
                <span>Roles older than {FREE_DELAY_HOURS}h, plus 3 fresh roles in full each day.</span>
              </div>
              <div className="pp-free-links">
                <a href="/login" onClick={() => track('cta_click', { where: 'offer_free_account' })}>Create a free account</a>
                <a href="/" onClick={() => track('cta_click', { where: 'offer_free_browse' })}>Keep browsing</a>
              </div>
            </div>
          )}
        </section>

        {/* ───────── OBJECTION HANDLING ───────── */}
        <section className="pp-faq">
          <h2 className="pp-h2">Questions before you start</h2>
          <details open><summary>Why does seeing a role early matter?</summary><p>When a recruiter posts a role, the first applications land in an empty inbox and get read properly. Two days later there can be hundreds. Premium puts you in that first group. Everything older stays free.</p></details>
          <details><summary>Where do the roles come from?</summary><p>Public LinkedIn posts from recruiters and hiring managers, collected and organised by AI. Many of these never make it to the big job boards, or only arrive there later.</p></details>
          <details><summary>How do I cancel?</summary><p>Open the menu in the top right, choose Manage billing, and cancel. You keep Premium until the end of the period you&apos;ve paid for and won&apos;t be charged again.</p></details>
          <details><summary>What happens after the first month?</summary><p>The ${PRICE.intro} covers your first month. After that it renews at ${PRICE.monthly} a month until you cancel, which you can do at any time.</p></details>
          <details><summary>Which plan should I pick?</summary><p>Monthly if you want to try it cheaply or expect to land something soon. The 3-month pass if you&apos;d rather pay once and not think about renewals during your search.</p></details>
          <details><summary>Does the 3-month pass renew?</summary><p>No. It&apos;s one payment for 90 days and then it simply ends. You can buy again or switch to monthly whenever you like.</p></details>
        </section>

        {/* ───────── CLOSING CTA ───────── */}
        {!hasPass && (
          <section className="pp-final">
            <h2>The next role worth applying to is being posted right now.</h2>
            <p>See it while you can still be one of the first.</p>
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly', 'offer_final')} disabled={busy !== null}>
              {busy === 'monthly' ? 'Opening secure checkout…' : `Get early access for $${PRICE.intro}`}
            </button>
            <p className="pp-fine">${PRICE.intro} first month, then ${PRICE.monthly}/month · Cancel anytime</p>
            {err && errMsg}
          </section>
        )}
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
        .pp-top { max-width: 1040px; margin: 0 auto; padding: 20px 20px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .pp-brand { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
        .pp-brand span { color: var(--ink-2); font-weight: 400; }
        .pp-back { font-size: 14px; color: var(--ink-2); text-decoration: none; }
        .pp-back:hover { color: var(--ink); }
        .pp-main { max-width: 1040px; margin: 0 auto; padding: 36px 20px 80px; }

        /* Hero */
        .pp-hero { display: grid; grid-template-columns: 1.15fr 1fr; gap: 36px; align-items: start; }
        .pp-eyebrow { font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); margin: 0 0 12px; }
        .pp h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(32px, 5.4vw, 50px); line-height: 1.06; letter-spacing: -0.02em; margin: 0 0 16px; }
        .pp h1 em { font-style: normal; color: var(--accent); }
        .pp-sub { font-size: 17px; line-height: 1.55; color: var(--ink-2); max-width: 560px; margin: 0 0 24px; }
        .pp-hero-cta { max-width: 420px; }
        .pp-reassure { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 6px 16px; }
        .pp-reassure li { font-size: 13px; color: var(--ink-2); padding-left: 18px; position: relative; }
        .pp-reassure li::before { content: ''; position: absolute; left: 3px; top: 3px; width: 5px; height: 9px; border: solid var(--good); border-width: 0 2px 2px 0; transform: rotate(45deg); }

        /* Live proof */
        .pp-live { padding: 18px; border: 1px solid var(--hair); border-radius: 16px; background: var(--surface); box-shadow: 0 12px 32px -20px rgba(25,23,19,.35); }
        .pp-live p { margin: 0; }
        .pp-live-head { font-size: 16px; }
        .pp-live-head b { font-weight: 600; }
        .pp-live-sub { font-size: 14px; color: var(--ink-2); margin-top: 4px !important; line-height: 1.45; }
        .pp-live-sub b { color: var(--ink); font-weight: 600; }
        .pp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--good); margin-right: 8px; vertical-align: 1px; box-shadow: 0 0 0 0 rgba(10,122,61,.5); animation: pp-pulse 2s infinite; }
        @keyframes pp-pulse { 70% { box-shadow: 0 0 0 7px rgba(10,122,61,0); } 100% { box-shadow: 0 0 0 0 rgba(10,122,61,0); } }
        .pp-live ul { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 8px; }
        .pp-live li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--page); font-size: 14px; }
        .pp-live li svg { flex: none; color: var(--ink-2); }
        .pp-lt { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-lm { margin-left: auto; flex: none; color: var(--ink-2); font-size: 13px; }
        .pp-linkbtn { margin-top: 12px; background: none; border: 0; padding: 4px 0; font: inherit; font-size: 15px; font-weight: 600; color: var(--cta); cursor: pointer; }
        .pp-linkbtn:hover:not(:disabled) { color: var(--cta-h); text-decoration: underline; }

        /* Timeline */
        .pp-tl { margin: 52px 0 0; padding: 22px 24px 16px; border: 1px solid var(--hair); border-radius: 16px; background: var(--surface); }
        .pp-tl-row { display: grid; grid-template-columns: 84px 1fr; align-items: center; gap: 12px; margin-bottom: 18px; }
        .pp-tl-name { font-size: 14px; font-weight: 600; }
        .pp-tl-track { position: relative; height: 6px; border-radius: 999px; background: var(--page); margin-right: 8px; }
        .pp-tl-gap { position: absolute; inset: 0; border-radius: 999px; background: repeating-linear-gradient(90deg, var(--hair) 0 6px, transparent 6px 12px); }
        .pp-tl-pin { position: absolute; top: 50%; transform: translate(-100%, -50%); white-space: nowrap; font-size: 13px; font-weight: 500; padding: 5px 10px; border-radius: 999px; background: var(--ink-2); color: #fff; }
        .pp-tl-pin-prem { transform: translate(0, -50%); background: var(--cta); }
        .pp-tl-axis { display: flex; justify-content: space-between; margin-left: 96px; font-size: 12px; color: var(--ink-2); }

        /* Plans */
        .pp-plans { margin-top: 56px; }
        .pp-h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 28px; letter-spacing: -0.01em; margin: 0 0 6px; }
        .pp-h2-sub { color: var(--ink-2); font-size: 15px; margin: 0 0 26px; }
        .pp-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; max-width: 820px; }
        .pp-card { position: relative; background: var(--surface); border: 1px solid var(--hair); border-radius: 16px; padding: 28px 24px 22px; display: flex; flex-direction: column; }
        .pp-paid { background: var(--accent-soft); border: 2px solid var(--cta); box-shadow: 0 14px 34px -14px rgba(47,107,242,0.4); }
        .pp-tag { position: absolute; top: -12px; left: 22px; background: var(--cta); color: #fff; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
        .pp-tag-quiet { background: var(--ink); }
        .pp h3 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
        .pp-price { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
        .pp-price b { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 46px; letter-spacing: -0.02em; line-height: 1; }
        .pp-price span { font-size: 14px; color: var(--ink-2); line-height: 1.3; }
        .pp-card ul { list-style: none; padding: 0; margin: 0 0 22px; display: grid; gap: 10px; flex: 1; align-content: start; }
        .pp-card li { font-size: 15px; line-height: 1.4; padding-left: 24px; position: relative; }
        .pp-card li b { font-weight: 600; }
        .pp-card li::before { content: ''; position: absolute; left: 2px; top: 5px; width: 6px; height: 11px; border: solid var(--accent); border-width: 0 2px 2px 0; transform: rotate(45deg) scale(.85); }

        /* Buttons */
        .pp-btn { display: block; width: 100%; text-align: center; font: inherit; font-size: 16px; font-weight: 600; padding: 15px 18px; border-radius: 12px; cursor: pointer; text-decoration: none; border: 1px solid transparent; transition: background .15s, border-color .15s, transform .15s; }
        .pp-btn-primary { background: var(--cta); color: #fff; box-shadow: 0 8px 20px -8px rgba(47,107,242,.6); }
        .pp-btn-primary:hover:not(:disabled) { background: var(--cta-h); transform: translateY(-1px); }
        .pp-btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--ink); }
        .pp-btn-secondary:hover:not(:disabled) { background: var(--ink); color: #fff; }
        .pp-btn:disabled, .pp-linkbtn:disabled { opacity: .7; cursor: default; }
        .pp-hero .pp-btn-primary { padding: 18px 20px; font-size: 17px; }
        .pp-btn:focus-visible, .pp a:focus-visible, .pp summary:focus-visible, .pp-linkbtn:focus-visible { outline: 2px solid var(--cta); outline-offset: 2px; }
        .pp-fine { font-size: 13px; color: var(--ink-2); text-align: center; margin: 10px 0 0; }
        .pp-err { font-size: 13px; color: #C23B22; text-align: center; margin: 8px 0 0; }

        /* Free, demoted */
        .pp-free { max-width: 820px; margin-top: 18px; padding: 16px 20px; border: 1px dashed var(--hair); border-radius: 14px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 14px; }
        .pp-free b { font-weight: 600; }
        .pp-free span { color: var(--ink-2); }
        .pp-free-links { display: flex; gap: 18px; }
        .pp-free-links a { color: var(--ink-2); font-weight: 500; }
        .pp-free-links a:hover { color: var(--ink); }

        /* FAQ */
        .pp-faq { margin-top: 64px; max-width: 680px; }
        .pp-faq .pp-h2 { margin-bottom: 14px; }
        .pp details { border-top: 1px solid var(--hair); padding: 15px 0; }
        .pp details:last-child { border-bottom: 1px solid var(--hair); }
        .pp summary { cursor: pointer; font-weight: 500; font-size: 16px; }
        .pp details p { margin: 10px 0 0; color: var(--ink-2); font-size: 15px; line-height: 1.6; }

        /* Final CTA */
        .pp-final { margin-top: 64px; padding: 40px 28px; border-radius: 20px; background: var(--ink); color: #fff; text-align: center; }
        .pp-final h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(24px, 3.6vw, 32px); line-height: 1.15; margin: 0 auto 8px; max-width: 620px; }
        .pp-final > p { color: #CFC9BC; margin: 0 0 22px; }
        .pp-final .pp-btn { max-width: 380px; margin: 0 auto; }
        .pp-final .pp-fine { color: #A9A397; }

        /* Sticky mobile CTA */
        .pp-sticky { display: none; }

        @media (max-width: 860px) {
          .pp-hero { grid-template-columns: 1fr; gap: 24px; }
          .pp-hero-cta { max-width: none; }
        }
        @media (max-width: 720px) {
          .pp-main { padding-top: 24px; padding-bottom: 110px; }
          .pp-cards { grid-template-columns: 1fr; gap: 22px; }
          .pp-tl { padding: 18px 16px 12px; }
          .pp-tl-row { grid-template-columns: 64px 1fr; }
          .pp-tl-axis { margin-left: 76px; }
          .pp-tl-pin { font-size: 12px; padding: 4px 8px; }
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
