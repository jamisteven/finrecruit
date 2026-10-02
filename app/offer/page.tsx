'use client'

import { useState } from 'react'

const FREE_DELAY_HOURS = 48

export default function OfferPage() {
  const [busy, setBusy] = useState<'monthly' | 'quarter' | null>(null)
  const [err, setErr] = useState(false)

  const track = (name: string, params: Record<string, unknown> = {}) => {
    try {
      const w = window as unknown as { gtag?: (...a: unknown[]) => void }
      w.gtag?.('event', name, params)
    } catch { /* analytics must never break the page */ }
  }

  const checkout = async (plan: 'monthly' | 'quarter') => {
    if (busy) return
    track('cta_click', { where: 'offer_page', plan })
    setBusy(plan); setErr(false)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.url) { window.location.href = data.url; return }
      console.error('[checkout] failed', res.status, data)
    } catch (e) { console.error('[checkout] request error', e) }
    setBusy(null); setErr(true)
    setTimeout(() => setErr(false), 6000)
  }

  return (
    <div className="pp">
      <header className="pp-top">
        <a className="pp-brand" href="/">backchannel<span>.jobs</span></a>
        <a className="pp-back" href="/">← Back to roles</a>
      </header>

      <main className="pp-main">
        <h1>See the roles <em>before everyone else.</em></h1>
        <p className="pp-sub">
          Recruiters and hiring managers share roles with their networks before they post them publicly.
          We find them and list them here. Free visitors see each role after {FREE_DELAY_HOURS} hours; early access shows it the moment it drops.
        </p>

        <div className="pp-cards">
          <section className="pp-card">
            <h2>Free</h2>
            <div className="pp-price"><b>$0</b><span>always</span></div>
            <ul>
              <li>Every role older than {FREE_DELAY_HOURS} hours</li>
              <li>3 fresh roles in full, plus a peek at 2 more</li>
              <li>Search and filter the whole list</li>
            </ul>
            <a className="pp-btn pp-btn-ghost" href="/login" onClick={() => track('cta_click', { where: 'offer_free_account' })}>Create a free account</a>
            <p className="pp-fine"><a href="/" onClick={() => track('cta_click', { where: 'offer_free_browse' })}>or just keep browsing</a></p>
          </section>

          <section className="pp-card pp-paid">
            <span className="pp-tag">Most popular</span>
            <h2>Monthly</h2>
            <div className="pp-price"><b>$9</b><span>first month, then $15/month</span></div>
            <ul>
              <li>Every new role the moment it drops</li>
              <li>Full details and a direct link to the recruiter</li>
              <li>Cancel anytime, no questions</li>
            </ul>
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => checkout('monthly')} disabled={busy !== null}>
              {busy === 'monthly' ? 'Opening checkout…' : 'Start for $9'}
            </button>
            <p className="pp-fine">Renews at $15/month until you cancel. Secure payment by Stripe.</p>
            {err && <p className="pp-err" role="alert">Couldn&apos;t open checkout. Please try again.</p>}
          </section>

          <section className="pp-card">
            <h2>3 months</h2>
            <div className="pp-price"><b>$39</b><span>one payment · 90 days</span></div>
            <ul>
              <li>Everything in Monthly</li>
              <li>About $13 a month</li>
              <li>Pay once, it never renews</li>
            </ul>
            <button type="button" className="pp-btn pp-btn-ghost" onClick={() => checkout('quarter')} disabled={busy !== null}>
              {busy === 'quarter' ? 'Opening checkout…' : 'Get 3 months – $39'}
            </button>
            <p className="pp-fine">Secure payment by Stripe.</p>
          </section>
        </div>

        <section className="pp-faq">
          <h3>Common questions</h3>
          <details><summary>How do I cancel?</summary><p>Open the menu in the top right, choose Manage billing, and cancel there. You keep early access until the end of the period you&apos;ve already paid for, and you won&apos;t be charged again.</p></details>
          <details><summary>What happens after the first month?</summary><p>The $9 is your first month. After that the plan renews at $15 a month until you cancel.</p></details>
          <details><summary>Does the 3-month option renew?</summary><p>No. It&apos;s a single payment for 90 days, and it simply ends. If you want to keep going you can buy again or switch to monthly.</p></details>
          <details><summary>Where do the roles come from?</summary><p>Public LinkedIn posts from recruiters and hiring managers, collected and organised by AI.</p></details>
          <details><summary>Why is free delayed by {FREE_DELAY_HOURS} hours?</summary><p>Early roles are where the value is, since fewer people have applied. That is what early access pays for. Everything older stays free.</p></details>
        </section>
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        .pp { --page:#F5F2EB; --surface:#FDFCFA; --ink:#191713; --ink-2:#5C574D; --hair:#D8D2C2; --accent-soft:#E4EAF6; --cta:#2F6BF2; --cta-h:#2458D4; --accent:#24468f;
          min-height: 100vh; background: var(--page); color: var(--ink); font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        @media (prefers-color-scheme: dark) {
          .pp { --page:#131210; --surface:#1C1A17; --ink:#F2EFE7; --ink-2:#A9A293; --hair:#3A362F; --accent-soft:#1D2538; --accent:#9DB4F0; }
        }
        .pp *, .pp *::before, .pp *::after { box-sizing: border-box; }
        .pp-top { max-width: 980px; margin: 0 auto; padding: 20px 20px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .pp-brand { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
        .pp-brand span { color: var(--ink-2); font-weight: 400; }
        .pp-back { font-size: 14px; color: var(--ink-2); text-decoration: none; }
        .pp-back:hover { color: var(--ink); }
        .pp-main { max-width: 980px; margin: 0 auto; padding: 36px 20px 72px; }
        .pp h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(32px, 6vw, 48px); line-height: 1.08; letter-spacing: -0.02em; margin: 0 0 14px; }
        .pp h1 em { font-style: normal; color: var(--accent); }
        .pp-sub { font-size: 17px; line-height: 1.55; color: var(--ink-2); max-width: 620px; margin: 0 0 32px; }
        .pp-cards { display: grid; grid-template-columns: 1fr 1.08fr 1fr; gap: 16px; align-items: stretch; }
        .pp-card { position: relative; background: var(--surface); border: 1px solid var(--hair); border-radius: 16px; padding: 26px 24px 22px; display: flex; flex-direction: column; }
        .pp-paid { background: var(--accent-soft); border-color: var(--cta); box-shadow: 0 10px 30px -12px rgba(47,107,242,0.35); }
        .pp-tag { position: absolute; top: -11px; left: 22px; background: var(--cta); color: #fff; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
        .pp h2 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
        .pp-price { display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; }
        .pp-price b { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 44px; letter-spacing: -0.02em; }
        .pp-price span { font-size: 14px; color: var(--ink-2); line-height: 1.25; }
        .pp ul { list-style: none; padding: 0; margin: 0 0 22px; display: grid; gap: 10px; flex: 1; }
        .pp li { font-size: 15px; line-height: 1.4; padding-left: 24px; position: relative; }
        .pp li::before { content: ''; position: absolute; left: 2px; top: 5px; width: 6px; height: 11px; border: solid var(--accent); border-width: 0 2px 2px 0; transform: rotate(45deg) scale(.85); }
        .pp-btn { display: block; width: 100%; text-align: center; font: inherit; font-size: 16px; font-weight: 600; padding: 14px 18px; border-radius: 12px; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
        .pp-btn-primary { background: var(--cta); color: #fff; }
        .pp-btn-primary:hover:not(:disabled) { background: var(--cta-h); }
        .pp-btn-primary:disabled { opacity: .7; cursor: default; }
        .pp-btn-ghost { background: transparent; color: var(--ink); border-color: var(--hair); }
        .pp-btn-ghost:hover { border-color: var(--ink-2); }
        .pp-btn:focus-visible, .pp a:focus-visible, .pp summary:focus-visible { outline: 2px solid var(--cta); outline-offset: 2px; }
        .pp-fine { font-size: 13px; color: var(--ink-2); text-align: center; margin: 10px 0 0; }
        .pp-fine a { color: var(--ink-2); }
        .pp-err { font-size: 13px; color: #C23B22; text-align: center; margin: 8px 0 0; }
        .pp-faq { margin-top: 44px; max-width: 640px; }
        .pp-faq h3 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
        .pp details { border-top: 1px solid var(--hair); padding: 14px 0; }
        .pp details:last-child { border-bottom: 1px solid var(--hair); }
        .pp summary { cursor: pointer; font-weight: 500; font-size: 15px; }
        .pp details p { margin: 10px 0 0; color: var(--ink-2); font-size: 15px; line-height: 1.55; }
        @media (max-width: 720px) {
          .pp-cards { grid-template-columns: 1fr; }
          .pp-paid { order: -1; }
          .pp-main { padding-top: 24px; }
        }
      `}</style>
    </div>
  )
}
