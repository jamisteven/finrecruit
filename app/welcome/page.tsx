'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Row = { keyword: string; location: string }

function Welcome() {
  const sid = useSearchParams().get('session_id')
  const [stage, setStage] = useState<'signing-in' | 'form' | 'saving' | 'done' | 'manual'>('signing-in')
  const [msg, setMsg] = useState('')
  const [rows, setRows] = useState<Row[]>([
    { keyword: '', location: '' },
    { keyword: '', location: '' },
    { keyword: '', location: '' },
  ])
  const [error, setError] = useState('')

  useEffect(() => {
    // TEMP: ?preview=1 skips the Stripe gate so the form can be checked
    if (new URLSearchParams(window.location.search).get('preview') === '1') {
      setStage('form'); return
    }
    if (!sid) { setStage('manual'); setMsg('Missing checkout session.'); return }
    fetch('/api/stripe/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid }),
    })
      .then((r) => r.json())
      .then(async (d) => {
        if (d.token_hash) {
          const { createClient } = await import('@/lib/supabase-browser')
          const { error } = await createClient().auth.verifyOtp({
            token_hash: d.token_hash, type: 'magiclink',
          })
          if (error) {
            setStage('manual')
            setMsg(`Your pass is active. Sign in at /login with the email you paid with.`)
            return
          }
          setStage('form')
          return
        }
        setStage('manual')
        setMsg(d.error ? `Your pass is active, but we couldn't sign you in: ${d.error}` : 'Your pass is active.')
      })
      .catch(() => {
        setStage('manual')
        setMsg('Your pass is active. Sign in at /login with the email you paid with.')
      })
  }, [sid])

  const setRow = (i: number, patch: Partial<Row>) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
    if (error) setError('')
  }

  const save = async () => {
    const filled = rows.filter((r) => r.keyword.trim())
    if (filled.length === 0) {
      setError('Add at least one role before continuing')
      return
    }
    setStage('saving')
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs: filled }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not save'); setStage('form'); return }
      setStage('done')
    } catch {
      setError('Could not save')
      setStage('form')
    }
  }

  if (stage === 'signing-in') {
    return <Shell><p className="muted">Setting up your access…</p></Shell>
  }

  if (stage === 'manual') {
    return (
      <Shell>
        <h1>Thanks — your pass is active.</h1>
        <p className="muted">{msg}</p>
        <a className="btn" href="/login">Sign in</a>
      </Shell>
    )
  }

  if (stage === 'done') {
    return (
      <Shell>
        <h1>You&apos;re set.</h1>
        <p className="muted">
          We&apos;ll start looking for those roles on the next sweep. Anything we find
          lands in your feed within a few hours.
        </p>
        <a className="btn" href="/">Go to the feed</a>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1>What should we look for?</h1>
      <p className="muted">
        Recruiters post thousands of roles a day. Tell us which ones matter and we&apos;ll
        point the next sweeps at them — up to three, and you can leave the location blank
        for anywhere.
      </p>

      <div className="tip">
        <b>Be specific with the role.</b> &ldquo;Fixed income analyst&rdquo; finds four times
        as much as &ldquo;finance&rdquo;. Bare sector words pull in posts that mention them
        without being the job.
      </div>

      <div className="rows">
        {rows.map((r, i) => (
          <div className="row" key={i}>
            <input
              value={r.keyword}
              placeholder={i === 0 ? 'Product manager' : i === 1 ? 'Quantitative developer' : 'Role or job title'}
              onChange={(e) => setRow(i, { keyword: e.target.value })}
            />
            <input
              value={r.location}
              placeholder={i === 0 ? 'United States' : i === 1 ? 'New York' : 'Location (optional)'}
              onChange={(e) => setRow(i, { location: e.target.value })}
            />
          </div>
        ))}
      </div>

      {error && <p className="err">{error}</p>}

      <button className="btn" onClick={save} disabled={stage === 'saving'}>
        {stage === 'saving' ? 'Saving…' : 'Start my searches'}
      </button>
      <a className="skip" href="/">Skip for now</a>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="onb">
      <header className="onb-top">
        <a className="onb-wm" href="/"><span className="onb-mk">B</span><span>backchannel<em>.jobs</em></span></a>
      </header>
      <div className="onb-body">{children}</div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        html, body { background: #F5F2EB; margin: 0; }
        .onb { max-width: 540px; margin: 0 auto; padding: 0 22px 90px;
          font-family: 'Inter', system-ui, sans-serif; color: #191713; }
        .onb-top { padding: 26px 0 0; }
        .onb-wm { display: inline-flex; align-items: center; gap: 9px;
          font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 20px;
          color: #191713; text-decoration: none; }
        .onb-wm em { font-style: normal; font-weight: 400; opacity: .55; }
        .onb-mk { width: 28px; height: 28px; border-radius: 8px; background: #14213D;
          color: #F3F1EA; display: grid; place-items: center; font-size: 16px; }
        .onb-body { padding-top: 46px; }
        .onb h1 { font-family: 'Fraunces', Georgia, serif; font-size: 27px;
          font-weight: 500; line-height: 1.2; margin: 0 0 10px; }
        .onb .muted { font-size: 14.5px; line-height: 1.65; color: #57544E; margin: 0 0 22px; }
        .onb .tip { font-size: 13px; line-height: 1.6; color: #57544E; background: #EFEAE0;
          border-radius: 10px; padding: 13px 15px; margin-bottom: 20px; }
        .onb .tip b { color: #191713; font-weight: 500; }
        .onb .rows { display: flex; flex-direction: column; gap: 9px; margin-bottom: 18px; }
        .onb .row { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        .onb input { width: 100%; box-sizing: border-box; padding: 11px 13px; font-size: 14px;
          font-family: inherit; color: #191713; background: #FFF;
          border: 1px solid #DDD6C8; border-radius: 9px; }
        .onb input:focus { outline: none; border-color: #191713; }
        .onb .btn { display: block; width: 100%; text-align: center; background: #2F6BF2;
          color: #FFF; border: none; font: 500 14.5px 'Inter', sans-serif;
          padding: 13px; border-radius: 9px; cursor: pointer; text-decoration: none; }
        .onb .btn:disabled { opacity: 0.6; cursor: default; }
        .onb .skip { display: block; text-align: center; font-size: 13px; color: #8B877F;
          margin-top: 14px; text-decoration: none; }
        .onb .err { font-size: 13px; color: #A32D2D; margin: 0 0 12px; }
        @media (max-width: 520px) { .onb .row { grid-template-columns: 1fr; } }
      `}</style>
    </main>
  )
}

export default function Page() {
  return <Suspense><Welcome /></Suspense>
}
