'use client'

import { useEffect, useMemo, useState } from 'react'

type Suggest = { locations: string[]; titles: string[] }

function Targets() {
  const [stage, setStage] = useState<'signing-in' | 'roles' | 'location' | 'saving' | 'done' | 'manual'>('signing-in')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const [roles, setRoles] = useState<string[]>(['', ''])
  const [showThird, setShowThird] = useState(false)
  const [locations, setLocations] = useState<string[]>([])
  const [locInput, setLocInput] = useState('')
  const [remoteOk, setRemoteOk] = useState(true)
  const [sug, setSug] = useState<Suggest>({ locations: [], titles: [] })

  useEffect(() => {
    fetch('/api/suggest').then((r) => r.json()).then(setSug).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/targets')
      .then((r) => r.json())
      .then((d) => {
        const t: { keyword: string; location: string | null }[] = d.targets ?? []
        if (t.length) {
          const ks = [...new Set(t.map((x) => x.keyword))].slice(0, 3)
          const ls = [...new Set(t.map((x) => x.location).filter(Boolean))] as string[]
          setRoles(ks.length >= 2 ? ks : [...ks, ''])
          if (ks.length > 2) setShowThird(true)
          setLocations(ls.filter((l) => l !== 'remote').slice(0, 3))
          setRemoteOk(ls.includes('remote'))
        }
      })
      .catch(() => {})
      .finally(() => setStage('roles'))
  }, [])

  const filledRoles = roles.map((r) => r.trim()).filter(Boolean)

  // Roles sharing a word with role 1, drawn from titles we actually carry
  const related = useMemo(() => {
    const first = roles[0]?.trim().toLowerCase()
    if (!first || first.length < 4) return []
    const words = first.split(/\s+/).filter((w) => w.length > 3)
    if (!words.length) return []
    return sug.titles
      .filter((t) => t !== first && words.some((w) => t.includes(w)))
      .filter((t) => !filledRoles.map((r) => r.toLowerCase()).includes(t))
      .slice(0, 4)
  }, [roles, sug.titles, filledRoles])

  const locMatches = useMemo(() => {
    const q = locInput.trim().toLowerCase()
    if (q.length < 2) return []
    return sug.locations
      .filter((l) => l.toLowerCase().includes(q) && !locations.includes(l))
      .slice(0, 6)
  }, [locInput, sug.locations, locations])

  const addRole = (v: string) => {
    const i = roles.findIndex((r) => !r.trim())
    if (i === -1) {
      if (!showThird) { setShowThird(true); setRoles([...roles, v]) }
      return
    }
    setRoles(roles.map((r, idx) => (idx === i ? v : r)))
  }

  const addLocation = (v: string) => {
    const t = v.trim()
    if (!t || locations.includes(t) || locations.length >= 3) return
    setLocations([...locations, t]); setLocInput('')
  }

  const finish = async () => {
    if (filledRoles.length === 0) { setError('Add at least one role'); return }
    setStage('saving'); setError('')
    const pairs = filledRoles.flatMap((k) =>
      locations.length ? locations.map((l) => ({ keyword: k, location: l }))
                       : [{ keyword: k, location: remoteOk ? 'remote' : '' }]
    ).slice(0, 3)
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not save'); setStage('location'); return }
      setStage('done')
    } catch {
      setError('Could not save'); setStage('location')
    }
  }

  if (stage === 'signing-in') return <Frame step={0}><p className="lede">Setting up your access…</p></Frame>

  if (stage === 'manual') return (
    <Frame step={0}>
      <h1>Thanks — your pass is active.</h1>
      <p className="lede">{msg}</p>
      <a className="btn" href="/login">Sign in</a>
    </Frame>
  )

  if (stage === 'done') return (
    <Frame step={0}>
      <span className="ok-badge">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </span>
      <h1>Updated.</h1>
      <p className="lede">
        We&apos;re searching now. Give us about five minutes, then check your feed — new
        matches land there as we find them, and we sweep again eight times a day.
      </p>
      <div className="pills">
        {filledRoles.map((r) => <span className="pill" key={r}>{r}</span>)}
        {locations.map((l) => <span className="pill" key={l}>{l}</span>)}
        <a className="pill pill-link" href="/targets">Edit</a>
      </div>
      <a className="btn" href="/">Go to the feed</a>
    </Frame>
  )

  if (stage === 'roles') return (
    <Frame step={1} roles={filledRoles} locations={locations}>
      <p className="eyebrow">Your queries · step 1 of 2</p>
      <h1>Which roles should we watch for?</h1>
      <p className="lede">
        Recruiters post thousands of jobs every day. Tell us the titles that fit you and we&apos;ll
        point our sweeps at them — these posts never reach the job boards.
      </p>

      <div className="fields">
        {roles.map((r, i) => (
          <div key={i}>
            <label className="lbl">Role {i + 1}{i > 0 && <span className="opt"> (optional)</span>}</label>
            <input
              className="field"
              value={r}
              list="sug-titles"
              placeholder={i === 0 ? 'Fixed income analyst' : 'e.g. Quantitative developer'}
              onChange={(e) => { setRoles(roles.map((x, idx) => (idx === i ? e.target.value : x))); setError('') }}
            />
          </div>
        ))}
        {!showThird && roles.length < 3 && (
          <button type="button" className="link-btn" onClick={() => { setShowThird(true); setRoles([...roles, '']) }}>
            + Add a third role
          </button>
        )}
      </div>

      {related.length > 0 && (
        <div className="chips-wrap">
          <p className="chips-label">Roles we also carry that look close:</p>
          <div className="chips">
            {related.map((t) => (
              <button type="button" className="chip" key={t} onClick={() => addRole(t)}>+ {t}</button>
            ))}
          </div>
        </div>
      )}

      <div className="tip">
        <b>Specific beats broad.</b> &ldquo;Fixed income analyst&rdquo; finds roughly four times
        as many real matches as &ldquo;finance&rdquo;. Broad words catch posts that only mention
        them in passing.
      </div>

      {error && <p className="err">{error}</p>}

      <div className="foot">
        <span className="fine">You can change these any time.</span>
        <button className="btn" onClick={() => {
          if (filledRoles.length === 0) { setError('Add at least one role'); return }
          setStage('location')
        }}>Continue to location →</button>
      </div>

      <datalist id="sug-titles">{sug.titles.map((t) => <option key={t} value={t} />)}</datalist>
    </Frame>
  )

  return (
    <Frame step={2} roles={filledRoles} locations={locations}>
      <p className="eyebrow">Step 2 of 2</p>
      <h1>Where would you take a job?</h1>
      <p className="lede">
        Add the cities, regions or countries you&apos;d work in. Recruiters usually name one
        place per post, so precise locations give cleaner matches.
      </p>

      <div className="fields">
        <div>
          <label className="lbl">Locations <span className="opt">(up to three)</span></label>
          {locations.length > 0 && (
            <div className="tags">
              {locations.map((l) => (
                <span className="tag" key={l}>
                  {l}
                  <button type="button" onClick={() => setLocations(locations.filter((x) => x !== l))} aria-label={`Remove ${l}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <input
            className="field"
            value={locInput}
            placeholder="Start typing a city, state or country"
            onChange={(e) => setLocInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addLocation(locMatches[0] ?? locInput) }
            }}
          />
          {locMatches.length > 0 && (
            <ul className="opts">
              {locMatches.map((l) => (
                <li key={l}><button type="button" onClick={() => addLocation(l)}>{l}</button></li>
              ))}
            </ul>
          )}
          <p className="help">These are places we already carry roles for. Press enter to pick the first.</p>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={remoteOk} onChange={(e) => setRemoteOk(e.target.checked)} />
          <span><b>Include remote roles</b><em>Remote posts open to your country count as a match.</em></span>
        </label>
      </div>

      {error && <p className="err">{error}</p>}

      <div className="foot">
        <button className="ghost" onClick={() => setStage('roles')}>← Back</button>
        <button className="btn" onClick={finish} disabled={stage === 'saving'}>
          {stage === 'saving' ? 'Saving…' : 'Start watching for roles'}
        </button>
      </div>
    </Frame>
  )
}

function Frame({ step, roles = [], locations = [], children }: {
  step: number; roles?: string[]; locations?: string[]; children: React.ReactNode
}) {
  return (
    <div className="ob">
      <header className="ob-head">
        <a className="ob-wm" href="/">
          <span className="ob-mk">B</span>
          <span>backchannel<span className="ob-tld">.jobs</span></span>
        </a>
        {step > 0 && (
          <nav className="ob-steps" aria-label="Setup progress">
            <span className={`st${step === 1 ? ' on' : ' done'}`}><b>1</b> Roles</span>
            <span className="st-rule" />
            <span className={`st${step === 2 ? ' on' : ''}`}><b>2</b> Location</span>
          </nav>
        )}
        <a className="ob-skip" href="/">Back to roles</a>
      </header>

      <main className="ob-body">
        <section className="ob-form">{children}</section>

        {step > 0 && (
          <aside className="ob-aside">
            <div className="ob-card">
              <p className="ob-card-title">Your search so far</p>
              <dl>
                <div>
                  <dt>Roles</dt>
                  <dd className={roles.length ? '' : 'dim'}>{roles.length ? roles.join(', ') : 'Nothing yet'}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd className={locations.length ? '' : 'dim'}>
                    {locations.length ? locations.join(', ') : step === 1 ? 'Next step' : 'Anywhere'}
                  </dd>
                </div>
              </dl>
            </div>
            <p className="ob-fine">We only read public recruiter posts. We never contact anyone on your behalf.</p>
          </aside>
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&family=Instrument+Sans:wght@400;500;600&display=swap');
        html, body { margin: 0; background: #F6F2EA; }
        .ob { min-height: 100vh; display: flex; flex-direction: column;
          background: #F6F2EA; color: #1C1B19;
          font-family: 'Instrument Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }

        .ob-head { display: flex; align-items: center; justify-content: space-between; gap: 24px;
          padding: 20px 40px; border-bottom: 1px solid #E6DFD3; flex-wrap: wrap; }
        .ob-wm { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #1C1B19;
          font-family: 'Source Serif 4', Georgia, serif; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
        .ob-mk { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
          border-radius: 7px; background: #1F2A44; color: #fff; font-size: 18px; }
        .ob-tld { color: #8A8378; }
        .ob-steps { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
        .st { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #8A8378; }
        .st b { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
          border-radius: 50%; border: 1px solid #D9D2C5; font-weight: 600; font-size: 12px; }
        .st.on { color: #1C1B19; font-weight: 600; }
        .st.on b { background: #1C1B19; color: #fff; border-color: #1C1B19; }
        .st.done b { background: #2F55D4; color: #fff; border-color: #2F55D4; }
        .st-rule { width: 32px; height: 1px; background: #D9D2C5; }
        .ob-skip { font-size: 14px; color: #514C43; text-decoration: none; }

        .ob-body { flex: 1; display: flex; flex-wrap: wrap; gap: 64px; max-width: 1120px; width: 100%;
          margin: 0 auto; padding: 56px 40px 80px; box-sizing: border-box; }
        .ob-form { flex: 999 1 520px; min-width: 0; max-width: 620px; display: flex; flex-direction: column; gap: 24px; }

        .eyebrow { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: #2F55D4; }
        .ob h1 { margin: 0; font-family: 'Source Serif 4', Georgia, serif; font-size: 40px;
          line-height: 1.1; font-weight: 600; letter-spacing: -.015em; }
        .lede { margin: 0; font-size: 17px; line-height: 1.55; color: #514C43; }

        .fields { display: flex; flex-direction: column; gap: 18px; }
        .lbl { display: block; font-size: 13px; font-weight: 600; color: #514C43; margin-bottom: 6px; }
        .opt { font-weight: 400; color: #8A8378; }
        .field { width: 100%; box-sizing: border-box; height: 52px; padding: 0 16px;
          border: 1px solid #D9D2C5; border-radius: 10px; background: #fff;
          font: inherit; font-size: 16px; color: #1C1B19; outline: none; }
        .field:focus { border-color: #2F55D4; box-shadow: 0 0 0 3px rgba(47,85,212,.18); }
        .field::placeholder { color: #8A8378; }
        .help { font-size: 13px; color: #605A50; margin: 6px 0 0; }

        .link-btn { align-self: flex-start; background: none; border: 0; padding: 0;
          font: inherit; font-size: 15px; font-weight: 600; color: #2F55D4; cursor: pointer; }

        .chips-wrap { display: flex; flex-direction: column; gap: 10px; }
        .chips-label { margin: 0; font-size: 13px; color: #605A50; }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .chip { display: inline-flex; align-items: center; height: 36px; padding: 0 14px;
          border-radius: 999px; border: 1px solid #D9D2C5; background: #fff;
          font: inherit; font-size: 14px; color: #1C1B19; cursor: pointer; }
        .chip:hover { border-color: #1C1B19; }

        .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
        .tag { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 8px 0 13px;
          border-radius: 999px; background: #1F2A44; color: #fff; font-size: 14px; }
        .tag button { background: none; border: 0; color: #fff; opacity: .7;
          font-size: 17px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .tag button:hover { opacity: 1; }

        .opts { list-style: none; margin: 8px 0 0; padding: 6px; background: #fff;
          border: 1px solid #D9D2C5; border-radius: 10px; }
        .opts button { display: block; width: 100%; text-align: left; background: none; border: 0;
          padding: 9px 11px; border-radius: 7px; font: inherit; font-size: 15px; color: #1C1B19; cursor: pointer; }
        .opts button:hover { background: #F6F2EA; }

        .toggle { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
        .toggle input { margin-top: 3px; width: 17px; height: 17px; accent-color: #2F55D4; }
        .toggle b { display: block; font-size: 15px; font-weight: 600; }
        .toggle em { display: block; font-style: normal; font-size: 13px; color: #605A50; margin-top: 2px; }

        .tip { display: flex; gap: 12px; padding: 14px 16px; border-radius: 10px;
          background: #fff; border: 1px solid #E6DFD3; font-size: 14px; line-height: 1.5; color: #514C43; }
        .tip b { color: #1C1B19; font-weight: 600; }

        .foot { display: flex; align-items: center; justify-content: space-between; gap: 16px;
          flex-wrap: wrap; padding-top: 8px; }
        .fine { font-size: 13px; color: #8A8378; }
        .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          height: 52px; padding: 0 28px; border-radius: 10px; border: 0; background: #2F55D4;
          color: #fff; font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none; }
        .btn:hover { background: #1E3EA8; }
        .btn:disabled { opacity: .65; cursor: default; }
        .ghost { background: none; border: 0; padding: 0 8px; height: 52px;
          font: inherit; font-size: 15px; color: #514C43; cursor: pointer; }
        .err { margin: 0; font-size: 14px; color: #B3402A; }

        .ok-badge { display: inline-flex; align-items: center; justify-content: center;
          width: 46px; height: 46px; border-radius: 14px; background: #E3F2E8; color: #1E7A4C; }
        .pills { display: flex; flex-wrap: wrap; gap: 8px; }
        .pill { display: inline-flex; align-items: center; height: 32px; padding: 0 13px;
          border-radius: 999px; background: #fff; border: 1px solid #E6DFD3; font-size: 14px; }
        .pill-link { color: #2F55D4; font-weight: 600; text-decoration: none; }

        .ob-aside { flex: 1 1 300px; max-width: 360px; display: flex; flex-direction: column; gap: 16px; }
        .ob-card { background: #fff; border: 1px solid #E6DFD3; border-radius: 14px; padding: 24px;
          display: flex; flex-direction: column; gap: 18px; }
        .ob-card-title { margin: 0; font-family: 'Source Serif 4', Georgia, serif; font-size: 20px; font-weight: 600; }
        .ob-card dl { margin: 0; display: flex; flex-direction: column; gap: 14px; }
        .ob-card dt { font-size: 12px; font-weight: 600; letter-spacing: .06em;
          text-transform: uppercase; color: #8A8378; margin-bottom: 4px; }
        .ob-card dd { margin: 0; font-size: 15px; }
        .ob-card dd.dim { color: #8A8378; }
        .ob-fine { margin: 0; font-size: 13px; line-height: 1.5; color: #8A8378; padding: 0 4px; }

        @media (max-width: 760px) {
          .ob-head { padding: 16px 20px; gap: 14px; }
          .ob-body { padding: 32px 20px 64px; gap: 32px; }
          .ob h1 { font-size: 30px; }
          .ob-aside { order: -1; max-width: none; }
          .foot .btn { width: 100%; }
        }
      `}</style>
    </div>
  )
}

export default function Page() {
  return <Targets />
}
