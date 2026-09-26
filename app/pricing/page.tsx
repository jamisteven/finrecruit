'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

export default function PricingPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [hasPass, setHasPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    createClient().auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null))
      .catch(() => {})
    fetch('/api/jobs?limit=1')
      .then((r) => r.json())
      .then((d) => setHasPass(!!d.hasPass))
      .catch(() => {})
  }, [])

  const buy = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const d = await res.json()
      if (d.url) window.location.href = d.url
      else { setError(d.error ?? 'Could not start checkout'); setBusy(false) }
    } catch {
      setError('Could not start checkout'); setBusy(false)
    }
  }

  return (
    <main className="pricing">
      <a className="back" href="/">← Back to roles</a>

      <h1>Recruiters post. You see it the same day.</h1>
      <p className="lede">
        Roles land in the feed eight times a day. Free members see them after 24 hours —
        by which point most have a queue. A pass removes the delay for two weeks.
      </p>

      <div className="tiers">
        <div className="tier">
          <div className="tier-name">Free</div>
          <div className="tier-price">$0</div>
          <ul>
            <li>Roles from 24 hours ago</li>
            <li>Every sector and city</li>
            <li>Save roles to revisit</li>
          </ul>
        </div>

        <div className="tier featured">
          <div className="tier-head">
            <span className="tier-name">14-day pass</span>
            <span className="chip">No subscription</span>
          </div>
          <div className="tier-price">$9</div>
          <ul>
            <li>Roles the moment they land</li>
            <li>Every sector and city</li>
            <li>Save roles to revisit</li>
            <li>Expires on its own — nothing to cancel</li>
          </ul>

          {hasPass ? (
            <div className="state">Your pass is active.</div>
          ) : (
            <button onClick={buy} disabled={busy}>{busy ? 'Opening checkout…' : 'Get the pass — $9'}</button>
          )}
          {error && <div className="err">{error}</div>}
        </div>
      </div>

      <p className="foot">Payment handled by Stripe. We never see your card details.</p>

      <style>{`
        .pricing { max-width: 720px; margin: 0 auto; padding: 48px 22px 70px;
          font-family: 'Inter', system-ui, sans-serif; color: #191713; background: #F6F3EC; min-height: 100vh; }
        .pricing .back { font-size: 13px; color: #6B6862; text-decoration: none; }
        .pricing h1 { font-family: 'Fraunces', Georgia, serif; font-size: 31px; font-weight: 500;
          line-height: 1.2; margin: 26px 0 10px; }
        .pricing .lede { font-size: 14.5px; line-height: 1.65; color: #57544E; margin: 0 0 32px; max-width: 54ch; }
        .pricing .tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(255px, 1fr)); gap: 14px; }
        .pricing .tier { background: #FFF; border: 1px solid #E2DCD0; border-radius: 14px; padding: 20px; }
        .pricing .tier.featured { border: 2px solid #191713; }
        .pricing .tier-head { display: flex; justify-content: space-between; align-items: center; }
        .pricing .tier-name { font-size: 14px; }
        .pricing .chip { font-size: 10.5px; background: #EFEAE0; color: #6B6862; padding: 3px 9px; border-radius: 9px; }
        .pricing .tier-price { font-family: 'Fraunces', Georgia, serif; font-size: 27px; margin: 4px 0 14px; }
        .pricing ul { list-style: none; padding: 0; margin: 0 0 18px; }
        .pricing li { font-size: 13px; color: #57544E; padding: 5px 0 5px 17px; position: relative; }
        .pricing li::before { content: '·'; position: absolute; left: 4px; color: #9A958C; }
        .pricing button, .pricing .btn { display: block; width: 100%; text-align: center;
          background: #191713; color: #F6F3EC; border: none; font: 500 13.5px 'Inter', sans-serif;
          padding: 11px; border-radius: 9px; cursor: pointer; text-decoration: none; }
        .pricing button:disabled { opacity: 0.6; cursor: default; }
        .pricing .state { font-size: 13px; color: #1D6B4F; text-align: center; padding: 11px; }
        .pricing .err { font-size: 12.5px; color: #A32D2D; margin-top: 9px; text-align: center; }
        .pricing .foot { font-size: 12px; color: #8B877F; margin-top: 26px; }
      `}</style>
    </main>
  )
}
