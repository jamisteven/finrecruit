'use client'

import { useEffect, useState } from 'react'

type Row = { keyword: string; location: string }
type Saved = { keyword: string; location: string | null }

export default function TargetsPage() {
  const [saved, setSaved] = useState<Saved[]>([])
  const [rows, setRows] = useState<Row[]>([
    { keyword: '', location: '' },
    { keyword: '', location: '' },
    { keyword: '', location: '' },
  ])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sug, setSug] = useState<{ locations: string[]; titles: string[] }>({ locations: [], titles: [] })
  const [note, setNote] = useState('')

  useEffect(() => {
    fetch('/api/suggest').then((r) => r.json()).then(setSug).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/targets')
      .then((r) => r.json())
      .then((d) => {
        const t: Saved[] = d.targets ?? []
        setSaved(t)
        if (t.length) {
          setRows([0, 1, 2].map((i) => ({
            keyword: t[i]?.keyword ?? '',
            location: t[i]?.location ?? '',
          })))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const setRow = (i: number, patch: Partial<Row>) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
    if (error) setError('')
    if (note) setNote('')
  }

  const save = async () => {
    const filled = rows.filter((r) => r.keyword.trim())
    if (filled.length === 0) { setError('Add at least one role'); return }
    setBusy(true); setError(''); setNote('')
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs: filled }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not save'); return }
      const added = (d.added ?? []).length
      const covered = (d.covered ?? []).length
      setNote(
        added > 0
          ? `Saved. We'll start searching for ${added === 1 ? 'that role' : `those ${added} roles`} on the next sweep.`
          : covered > 0
            ? "Saved. We already carry plenty of those — they're in your feed now."
            : 'Saved.'
      )
      setSaved(filled.map((r) => ({ keyword: r.keyword, location: r.location || null })))
    } catch {
      setError('Could not save')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true); setError(''); setNote('')
    try {
      await fetch('/api/targets', { method: 'DELETE' })
      setSaved([])
      setRows([{ keyword: '', location: '' }, { keyword: '', location: '' }, { keyword: '', location: '' }])
      setNote('Cleared.')
    } catch {
      setError('Could not clear')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="tg">
      <header className="tg-top">
        <a className="tg-wm" href="/"><span className="tg-mk">B</span><span>backchannel<em>.jobs</em></span></a>
        <a className="tg-back" href="/">← Back to roles</a>
      </header>

      <h1>What we&apos;re looking for</h1>
      <p className="muted">
        We point our sweeps at these. Name the role as precisely as you&apos;d see it in a
        job title and add where you&apos;d work — the more specific, the more we find.
      </p>

      <div className="tip">
        <b>Be specific.</b> &ldquo;Fixed income analyst&rdquo; finds four times as much as
        &ldquo;finance&rdquo;. Bare sector words pull in posts that mention them without being the job.
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="rows">
            {rows.map((r, i) => (
              <div className="row" key={i}>
                <input
                  value={r.keyword}
                  list="sug-titles"
                  placeholder={i === 0 ? 'Product manager' : i === 1 ? 'Quantitative developer' : 'Role or job title'}
                  onChange={(e) => setRow(i, { keyword: e.target.value })}
                />
                <input
                  value={r.location}
                  list="sug-locations"
                  placeholder={i === 0 ? 'United States' : i === 1 ? 'New York' : 'City, state or country'}
                  onChange={(e) => setRow(i, { location: e.target.value })}
                />
              </div>
            ))}
          </div>

          {error && <p className="err">{error}</p>}
          {note && <p className="note">{note}</p>}

          <button className="btn" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {saved.length > 0 && (
            <button className="clear" onClick={clear} disabled={busy}>Clear all</button>
          )}
        </>
      )}

      <datalist id="sug-titles">{sug.titles.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="sug-locations">{sug.locations.map((l) => <option key={l} value={l} />)}</datalist>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        html, body { background: #F5F2EB; margin: 0; }
        .tg { max-width: 540px; margin: 0 auto; padding: 26px 22px 90px;
          font-family: 'Inter', system-ui, sans-serif; color: #191713; }
        .tg-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 46px; }
        .tg-wm { display: inline-flex; align-items: center; gap: 9px;
          font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 20px;
          color: #191713; text-decoration: none; }
        .tg-wm em { font-style: normal; font-weight: 400; opacity: .55; }
        .tg-mk { width: 28px; height: 28px; border-radius: 8px; background: #14213D;
          color: #F3F1EA; display: grid; place-items: center; font-size: 16px; }
        .tg-back { font-size: 13.5px; color: #57544E; text-decoration: none; }
        .tg h1 { font-family: 'Fraunces', Georgia, serif; font-size: 27px; font-weight: 500;
          line-height: 1.2; margin: 0 0 10px; }
        .tg .muted { font-size: 14.5px; line-height: 1.65; color: #57544E; margin: 0 0 22px; }
        .tg .tip { font-size: 13px; line-height: 1.6; color: #57544E; background: #EFEAE0;
          border-radius: 10px; padding: 13px 15px; margin-bottom: 20px; }
        .tg .tip b { color: #191713; font-weight: 500; }
        .tg .rows { display: flex; flex-direction: column; gap: 9px; margin-bottom: 18px; }
        .tg .row { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        .tg input { width: 100%; box-sizing: border-box; padding: 11px 13px; font-size: 14px;
          font-family: inherit; color: #191713; background: #FDFCFA;
          border: 1px solid #DDD6C8; border-radius: 10px; }
        .tg input:focus { outline: none; border-color: #2F6BF2; box-shadow: 0 0 0 3px rgba(47,107,242,.14); }
        .tg .btn { display: block; width: 100%; text-align: center; background: #2F6BF2;
          color: #FFF; border: none; font: 500 14.5px 'Inter', sans-serif;
          padding: 13px; border-radius: 10px; cursor: pointer; }
        .tg .btn:disabled { opacity: .65; cursor: default; }
        .tg .clear { display: block; margin: 14px auto 0; background: none; border: none;
          font: 400 13px 'Inter', sans-serif; color: #8B877F; cursor: pointer; text-decoration: underline; }
        .tg .err { font-size: 13px; color: #A32D2D; margin: 0 0 12px; }
        .tg .note { font-size: 13px; color: #1D6B4F; margin: 0 0 12px; }
        @media (max-width: 520px) { .tg .row { grid-template-columns: 1fr; } }
      `}</style>
    </main>
  )
}
