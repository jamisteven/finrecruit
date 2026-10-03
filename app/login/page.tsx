'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

const RESEND_SECONDS = 30

// Turn Supabase errors into something a person can act on
const friendlyError = (err: { message?: string; status?: number }) => {
  const msg = (err.message ?? '').toLowerCase()
  if (err.status === 429 || msg.includes('rate limit') || msg.includes('too many') || msg.includes('seconds')) {
    return 'Too many attempts. Please wait a minute and try again.'
  }
  if (msg.includes('invalid') && msg.includes('email')) return 'That email address doesn’t look right. Please check it.'
  return 'We couldn’t send the link just now. Please try again.'
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(0)

  // Resend countdown
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const send = async () => {
    const addr = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setStatus('error'); setMessage('Enter a valid email address.')
      return
    }
    setStatus('sending'); setMessage('')
    try {
      const { error } = await createClient().auth.signInWithOtp({
        email: addr,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) { setStatus('error'); setMessage(friendlyError(error)); return }
      setEmail(addr)
      setStatus('sent')
      setCooldown(RESEND_SECONDS)
    } catch {
      setStatus('error'); setMessage('We couldn’t send the link just now. Please try again.')
    }
  }

  const resend = () => { if (cooldown <= 0 && status !== 'sending') send() }
  const changeEmail = () => { setStatus('idle'); setMessage(''); setCooldown(0) }

  const sent = status === 'sent' || (status === 'sending' && cooldown > 0)
  const mmss = `0:${String(cooldown).padStart(2, '0')}`

  return (
    <div className="lg">
      {/* ── Brand panel ── */}
      <aside className="lg-brand">
        <a className="lg-wm" href="/"><span className="lg-mk">B</span><span>backchannel<em>.jobs</em></span></a>
        <h2>The jobs LinkedIn <em>doesn&apos;t show you.</em></h2>
      </aside>

      {/* ── Form ── */}
      <main className="lg-side">
        <a className="lg-back" href="/">← Back to roles</a>

        <div className="lg-card">
          {sent ? (
            <>
              <div className="lg-sent-ic" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
              </div>
              <h1>Check your inbox</h1>
              <p className="lg-sub lg-sub-tight">We sent a sign-in link to:</p>
              <div className="lg-sent-box" role="status">
                <b>{email}</b>
                <span>Open it on this device to sign in. It can take a minute to arrive, and may land in spam or promotions.</span>
              </div>
              <div className="lg-links">
                {cooldown > 0
                  ? <span className="lg-dim">Resend in {mmss}</span>
                  : <button type="button" onClick={resend} disabled={status === 'sending'}>{status === 'sending' ? 'Sending…' : 'Resend link'}</button>}
                <button type="button" onClick={changeEmail}>Use a different email</button>
              </div>
            </>
          ) : (
            <>
              <h1>Sign in or sign up</h1>
              <p className="lg-sub">
                <span className="lg-d">Enter your email and we&apos;ll send you a secure link. New here? The same link creates your free account.</span>
                <span className="lg-m">We&apos;ll email you a secure link. New here? It creates your free account.</span>
              </p>

              <form onSubmit={(e) => { e.preventDefault(); send() }} noValidate>
                <label htmlFor="lg-email">Email address</label>
                <input
                  id="lg-email"
                  className={`lg-input${status === 'error' ? ' bad' : ''}`}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                  value={email}
                  placeholder="you@email.com"
                  aria-invalid={status === 'error'}
                  aria-describedby={status === 'error' ? 'lg-err' : undefined}
                  onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
                />
                <button type="submit" className="lg-btn" disabled={status === 'sending'}>
                  {status === 'sending' ? 'Sending link…' : (
                    <>Email me a sign-in link <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></>
                  )}
                </button>
                {status === 'error' && <p id="lg-err" className="lg-err" role="alert">{message}</p>}
              </form>

              <p className="lg-fine">
                <span className="lg-d">No password to remember. The link works once and expires after a short time.</span>
                <span className="lg-m">No password, no card needed.</span>
              </p>
              <div className="lg-div" />
              <p className="lg-alt lg-d">Want every new role the moment it&apos;s posted? <a href="/offer">See Premium →</a></p>
              <p className="lg-alt lg-m"><a href="/">← Back to roles</a></p>
            </>
          )}
        </div>
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        /* This page is always light, whatever the browser theme */
        html, body { background: #F5F2EB; }
        .lg { --page:#F5F2EB; --surface:#FDFCFA; --ink:#191713; --ink-2:#5C574D; --ink-3:#97907E; --hair:#E4DFD2; --hair-2:#D8D2C2;
          --navy:#14213D; --cta:#2F6BF2; --cta-h:#2458D4; --accent:#24468f; --accent-soft:#E4EAF6; --bad:#B3402A;
          color-scheme: light; min-height: 100vh; min-height: 100dvh; display: grid; grid-template-columns: 1fr 1fr;
          background: var(--page); color: var(--ink); font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .lg *, .lg *::before, .lg *::after { box-sizing: border-box; }

        /* Brand panel */
        .lg-brand { position: relative; overflow: hidden; background: var(--navy); color: #F3F1EA; padding: 40px 48px; display: flex; flex-direction: column; }
        .lg-brand::after { content: ''; position: absolute; right: -140px; bottom: -140px; width: 420px; height: 420px; border-radius: 50%; background: radial-gradient(circle, rgba(47,107,242,.35), transparent 70%); pointer-events: none; }
        .lg-wm { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 9px; font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 20px; color: inherit; text-decoration: none; }
        .lg-wm em { font-style: normal; font-weight: 400; opacity: .6; }
        .lg-mk { width: 28px; height: 28px; border-radius: 8px; background: #F3F1EA; color: var(--navy); display: grid; place-items: center; font-size: 16px; }
        .lg-brand h2 { position: relative; z-index: 1; font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: clamp(36px, 3.6vw, 48px); line-height: 1.06; letter-spacing: -.02em; margin: auto 0; max-width: 460px; }
        .lg-brand h2 em { font-style: italic; font-weight: 400; color: #9FB8F5; }

        /* Form side */
        .lg-side { display: flex; flex-direction: column; padding: 32px 40px; }
        .lg-back { align-self: flex-end; font-size: 14px; color: var(--ink-2); text-decoration: none; }
        .lg-back:hover { color: var(--ink); }
        .lg-card { margin: auto; width: 100%; max-width: 380px; padding: 24px 0; }
        .lg h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 32px; letter-spacing: -.02em; margin: 0 0 8px; }
        .lg-sub { color: var(--ink-2); font-size: 15px; line-height: 1.5; margin: 0 0 24px; }
        .lg-sub-tight { margin-bottom: 12px; }
        .lg label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
        .lg-input { width: 100%; height: 48px; padding: 0 14px; font: inherit; font-size: 16px; color: var(--ink); background: var(--surface); border: 1px solid var(--hair-2); border-radius: 12px; outline: none; transition: border-color .15s, box-shadow .15s; }
        .lg-input::placeholder { color: var(--ink-3); }
        .lg-input:focus { border-color: var(--cta); box-shadow: 0 0 0 4px rgba(47,107,242,.15); }
        .lg-input.bad { border-color: var(--bad); box-shadow: 0 0 0 4px rgba(179,64,42,.12); }
        .lg-btn { margin-top: 12px; width: 100%; height: 48px; border: 0; border-radius: 12px; background: var(--cta); color: #fff; font: inherit; font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; box-shadow: 0 8px 20px -8px rgba(47,107,242,.6); transition: background .15s; }
        .lg-btn:hover:not(:disabled) { background: var(--cta-h); }
        .lg-btn:disabled { opacity: .75; cursor: default; }
        .lg-err { margin: 10px 0 0; font-size: 13px; color: var(--bad); }
        .lg-fine { margin: 14px 0 0; font-size: 13px; line-height: 1.5; color: var(--ink-2); }
        .lg-div { height: 1px; background: var(--hair); margin: 24px 0 16px; }
        .lg-alt { margin: 0; font-size: 13.5px; color: var(--ink-2); }
        .lg-alt a { color: var(--cta); font-weight: 600; text-decoration: none; white-space: nowrap; }
        .lg-alt a:hover { text-decoration: underline; }
        .lg-m { display: none; }

        /* Sent state */
        .lg-sent-ic { width: 52px; height: 52px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; margin-bottom: 16px; }
        .lg-sent-box { display: grid; gap: 2px; background: var(--surface); border: 1px solid var(--hair); border-radius: 12px; padding: 12px 14px; font-size: 14px; line-height: 1.45; color: var(--ink-2); margin: 4px 0 16px; }
        .lg-sent-box b { color: var(--ink); font-weight: 600; word-break: break-all; }
        .lg-links { display: flex; flex-wrap: wrap; gap: 10px 18px; font-size: 14px; }
        .lg-links button { background: none; border: 0; padding: 0; font: inherit; font-weight: 600; color: var(--cta); cursor: pointer; }
        .lg-links button:hover:not(:disabled) { text-decoration: underline; }
        .lg-links button:disabled { color: var(--ink-3); cursor: default; }
        .lg-dim { color: var(--ink-3); font-variant-numeric: tabular-nums; }

        .lg a:focus-visible, .lg button:focus-visible { outline: 2px solid var(--cta); outline-offset: 2px; border-radius: 4px; }

        /* Mobile: brand collapses to a header */
        @media (max-width: 820px) {
          .lg { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
          .lg-brand { padding: 18px 20px 22px; }
          .lg-brand::after { width: 240px; height: 240px; right: -100px; bottom: -100px; }
          .lg-brand h2 { font-size: 24px; margin: 18px 0 0; }
          .lg-side { padding: 22px 20px 32px; }
          .lg-back { display: none; }
          .lg-card { margin: 0; padding: 0; max-width: none; }
          .lg h1 { font-size: 26px; }
          .lg-d { display: none; }
          .lg-m { display: inline; }
          p.lg-m { display: block; }
        }
        @media (prefers-reduced-motion: reduce) { .lg-input, .lg-btn { transition: none; } }
      `}</style>
    </div>
  )
}
