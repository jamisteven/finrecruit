'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DEFAULT_QUERIES, DEFAULT_REPLY_PROMPT, type RadarPost, type Scored } from '@/lib/redditRadar'

type Row = RadarPost & { kind?: string; score?: number }
type Mark = 'replied' | 'skipped'

const LS_QUERIES = 'bcj_radar_queries', LS_MARKS = 'bcj_radar_marks', LS_SCORES = 'bcj_radar_scores', LS_PROMPT = 'bcj_radar_reply_prompt'
const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private window: fine */ } }

const KIND: Record<string, string> = {
  'asking-where-to-look': 'Asking where to look', 'stuck-applying': 'Stuck applying', 'market-vent': 'Market vent',
  'career-advice': 'Career advice', 'not-a-fit': 'Not a fit',
}

// Newer threads first among equals: a reply on a week-old thread is read, on a year-old thread is not.
const recency = (age: number | null) => (age === null ? 0.7 : age <= 3 ? 1 : age <= 7 ? 0.95 : age <= 30 ? 0.8 : age <= 90 ? 0.55 : 0.3)
const rankOf = (r: Row) => (r.score ?? 0) * recency(r.ageDays) + Math.min(r.queries - 1, 3) * 2
const ageLabel = (r: Row) => (r.ageDays === null ? (r.dateText ?? 'date unknown') : r.ageDays < 1 ? 'today' : r.ageDays < 2 ? '1 day ago' : r.ageDays < 60 ? `${Math.round(r.ageDays)} days ago` : r.ageDays < 700 ? `${Math.round(r.ageDays / 30)} months ago` : `${(r.ageDays / 365).toFixed(1)} years ago`)

function DraftPanel({ row, prompt }: { row: Row; prompt: string }) {
  const [thread, setThread] = useState('')
  const [mention, setMention] = useState(true)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  async function draft() {
    setBusy(true); setErr(''); setCopied(false)
    try {
      const r = await fetch('/api/reddit-radar/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread, mention, prompt, subreddit: row.subreddit, title: row.title }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setReply(j.reply)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(reply); setCopied(true) } catch { setErr('Copy failed: select the text and copy it by hand') }
  }

  return (
    <div className="rr-draft">
      <label className="rr-label" htmlFor={`rr-t-${row.id}`}>Paste the thread text <span>(the post, plus any comments worth knowing about)</span></label>
      <textarea id={`rr-t-${row.id}`} className="rr-ta" rows={6} value={thread} onChange={(e) => setThread(e.target.value)} placeholder="Open the thread, select the post and comments, paste here" />
      <div className="rr-row">
        <label className="rr-check"><input type="checkbox" checked={mention} onChange={(e) => setMention(e.target.checked)} /> Mention Backchannel if it fits</label>
        <button className="rr-run" onClick={draft} disabled={busy || thread.trim().length < 20}>{busy ? 'Writing…' : reply ? 'Write again' : 'Write reply'}</button>
      </div>
      {err && <p className="rr-error" role="alert">{err}</p>}
      {reply && (
        <>
          <textarea className="rr-ta rr-reply" rows={8} value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Drafted reply, editable" />
          <div className="rr-row">
            <button className="rr-open" onClick={copy}>{copied ? 'Copied' : 'Copy reply'}</button>
            <a className="rr-ghost" href={row.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Open thread &#8599;</a>
            <span className="rr-muted" style={{ margin: 0 }}>Edit it, then post it yourself.</span>
          </div>
        </>
      )}
    </div>
  )
}

export default function RadarClient() {
  const [queries, setQueries] = useState(DEFAULT_QUERIES.join('\n'))
  const [period, setPeriod] = useState('m')
  const [minScore, setMinScore] = useState(50)
  const [showHidden, setShowHidden] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [phase, setPhase] = useState<'idle' | 'searching' | 'scoring'>('idle')
  const [progress, setProgress] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [credits, setCredits] = useState<number | null>(null)
  const [replyPrompt, setReplyPrompt] = useState(DEFAULT_REPLY_PROMPT)
  const [drafting, setDrafting] = useState<string | null>(null)   // id of the thread whose draft panel is open

  useEffect(() => {
    const q = read<string | null>(LS_QUERIES, null)
    if (q) setQueries(q)
    setMarks(read<Record<string, Mark>>(LS_MARKS, {}))
    const rp = read<string | null>(LS_PROMPT, null)
    if (rp) setReplyPrompt(rp)
  }, [])

  const mark = (id: string, m: Mark | null) => setMarks((cur) => {
    const next = { ...cur }
    if (m) next[id] = m; else delete next[id]
    write(LS_MARKS, next)
    return next
  })

  async function run() {
    setErrors([]); setRows([]); setCredits(null)
    write(LS_QUERIES, queries)
    setPhase('searching'); setProgress('Searching Google for Reddit threads…')
    try {
      const sr = await fetch('/api/reddit-radar/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: queries.split('\n'), period }),
      })
      const sj = await sr.json()
      if (!sr.ok) throw new Error(sj.error || `HTTP ${sr.status}`)
      const found: RadarPost[] = sj.posts
      setCredits(sj.credits); setErrors(sj.errors ?? [])

      // threads scored in an earlier run keep their score, so re-running costs nothing for them
      const cache = read<Record<string, Scored>>(LS_SCORES, {})
      const merged: Row[] = found.map((p) => ({ ...p, kind: cache[p.id]?.kind, score: cache[p.id]?.score }))
      setRows(merged)
      const todo = merged.filter((r) => r.score === undefined)

      setPhase('scoring')
      const batches: Row[][] = []
      for (let i = 0; i < todo.length; i += 15) batches.push(todo.slice(i, i + 15))
      let doneCount = 0
      for (let i = 0; i < batches.length; i += 3) {
        await Promise.all(batches.slice(i, i + 3).map(async (batch) => {
          const r = await fetch('/api/reddit-radar/score', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ posts: batch.map(({ id, subreddit, title, snippet }) => ({ id, subreddit, title, snippet })) }),
          })
          const j = await r.json()
          if (!r.ok) { setErrors((e) => [...e, `Scoring failed: ${j.error || r.status}`]); return }
          const scores: Scored[] = j.scores
          const byId = new Map(scores.map((s) => [s.id, s]))
          setRows((cur) => cur.map((row) => (byId.has(row.id) ? { ...row, kind: byId.get(row.id)!.kind, score: byId.get(row.id)!.score } : row)))
          const c = read<Record<string, Scored>>(LS_SCORES, {})
          for (const s of scores) c[s.id] = s
          const keys = Object.keys(c)
          if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete c[k]
          write(LS_SCORES, c)
          doneCount += batch.length
          setProgress(`Scoring… ${doneCount} of ${todo.length} threads`)
        }))
      }
    } catch (e) {
      setErrors((cur) => [...cur, (e as Error).message])
    } finally {
      setPhase('idle'); setProgress('')
    }
  }

  const ranked = useMemo(() => [...rows].sort((a, b) => rankOf(b) - rankOf(a)), [rows])
  const shown = ranked.filter((r) => (r.score ?? 0) >= minScore && (showHidden || !marks[r.id]))
  const hiddenCount = ranked.filter((r) => (r.score ?? 0) >= minScore && marks[r.id]).length
  const unscored = rows.filter((r) => r.score === undefined).length

  return (
    <div className="rr-page">
      <style>{CSS}</style>
      <div className="rr-mast">
        <div className="rr-mast-in">
          <Link className="rr-wordmark" href="/" aria-label="backchannel.jobs home"><span className="rr-mark">B</span><span>backchannel<em>.jobs</em></span></Link>
          <span className="rr-badge">Internal · Reddit radar</span>
          <Link className="rr-link" href="/analytics">Analytics &rarr;</Link>
        </div>
      </div>
      <div className="rr">
        <h1>Reddit radar</h1>
        <p className="rr-sub">Finds Reddit threads where people are stuck in a job search, ranks them, and leaves the replying to you. Nothing is posted anywhere.</p>

        <div className="rr-card">
          <label className="rr-label" htmlFor="rr-q">Searches, one per line <span>(site:reddit.com is added for you; lines starting with # are ignored)</span></label>
          <textarea id="rr-q" className="rr-ta" rows={8} value={queries} onChange={(e) => setQueries(e.target.value)} spellCheck={false} />
          <div className="rr-row">
            <div className="rr-seg" role="group" aria-label="How recent">
              {([['h', 'Past hour'], ['d', 'Past day'], ['w', 'Past week'], ['m', 'Past month'], ['y', 'Past year']] as const).map(([k, label]) => (
                <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{label}</button>
              ))}
            </div>
            <button className="rr-run" onClick={run} disabled={phase !== 'idle'}>{phase === 'idle' ? 'Find threads' : 'Working…'}</button>
            <button className="rr-ghost" onClick={() => setQueries(DEFAULT_QUERIES.join('\n'))} disabled={phase !== 'idle'}>Reset searches</button>
          </div>
          <p className="rr-muted">Each search uses one Serper credit ({queries.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length} per run, up to 40; lines starting with # are ignored). Scoring reads the title and Google snippet only, so open a thread to check it before replying.</p>
        </div>

        <details className="rr-card rr-prompt">
          <summary>Reply style <span>(the instructions Claude follows when it drafts a reply; saved in this browser)</span></summary>
          <textarea className="rr-ta" rows={14} value={replyPrompt} spellCheck onChange={(e) => { setReplyPrompt(e.target.value); write(LS_PROMPT, e.target.value) }} aria-label="Reply instructions" />
          <div className="rr-row"><button className="rr-ghost" onClick={() => { setReplyPrompt(DEFAULT_REPLY_PROMPT); write(LS_PROMPT, null) }}>Reset to default</button></div>
        </details>

        {progress && <p className="rr-progress" role="status">{progress}</p>}
        {errors.map((e, i) => <p key={i} className="rr-error" role="alert">{e}</p>)}

        {rows.length > 0 && (
          <>
            <div className="rr-bar">
              <span><b>{shown.length}</b> shown of {rows.length} found{credits !== null ? ` · ${credits} credits used` : ''}{unscored ? ` · ${unscored} unscored` : ''}</span>
              <label>Min score <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
                {[0, 30, 50, 65, 80].map((n) => <option key={n} value={n}>{n === 0 ? 'All' : `${n}+`}</option>)}
              </select></label>
              <label className="rr-check"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show replied / skipped ({hiddenCount})</label>
            </div>
            <ul className="rr-list">
              {shown.map((r) => (
                <li key={r.id} className={`rr-item${marks[r.id] ? ' off' : ''}`}>
                  <div className={`rr-score s${r.score === undefined ? 'x' : r.score >= 80 ? 'a' : r.score >= 65 ? 'b' : r.score >= 50 ? 'c' : 'd'}`} title="Fit score, 0-100">{r.score ?? '…'}</div>
                  <div className="rr-body">
                    <div className="rr-meta">
                      <b>r/{r.subreddit}</b> · {ageLabel(r)} · Google #{r.position}{r.queries > 1 ? ` · found by ${r.queries} searches` : ''}
                      {r.kind && <span className="rr-chip">{KIND[r.kind] ?? r.kind}</span>}
                      {marks[r.id] && <span className="rr-chip done">{marks[r.id] === 'replied' ? 'Replied' : 'Skipped'}</span>}
                    </div>
                    <a className="rr-title" href={r.url} target="_blank" rel="noopener noreferrer">{r.title || r.url}</a>
                    {r.snippet && <p className="rr-snip">{r.snippet}</p>}
                    <div className="rr-actions">
                      <a className="rr-open" href={r.url} target="_blank" rel="noopener noreferrer">Open thread &#8599;</a>
                      <button onClick={() => setDrafting(drafting === r.id ? null : r.id)}>{drafting === r.id ? 'Close draft' : 'Draft reply'}</button>
                      {marks[r.id]
                        ? <button onClick={() => mark(r.id, null)}>Undo</button>
                        : <><button onClick={() => mark(r.id, 'replied')}>Mark replied</button><button onClick={() => mark(r.id, 'skipped')}>Skip</button></>}
                    </div>
                    {drafting === r.id && <DraftPanel row={r} prompt={replyPrompt} />}
                  </div>
                </li>
              ))}
            </ul>
            {shown.length === 0 && <p className="rr-muted">Nothing at this score. Lower the minimum, widen the time range, or add searches.</p>}
          </>
        )}
        {rows.length === 0 && phase === 'idle' && errors.length === 0 && <p className="rr-muted">Press Find threads to run the searches above.</p>}
      </div>
    </div>
  )
}

const CSS = `
.rr-page { --bg:#F5F2EB; --surface:#FDFCFA; --hair:#D8D2C2; --ink:#191713; --ink-2:#5C574D; --ink-3:#6F695E; --accent:#24468f; --accent-soft:#E9EFFC;
  min-height: 100vh; background: var(--bg); color: var(--ink); font-family: var(--font-inter), system-ui, sans-serif; font-size: 14px; color-scheme: light; }
.rr-mast { background: var(--surface); border-bottom: 1px solid var(--hair); }
.rr-mast-in { max-width: 980px; margin: 0 auto; padding: 14px 16px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.rr-wordmark { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-fraunces), Georgia, serif; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; text-decoration: none; color: var(--ink); }
.rr-wordmark em { font-style: italic; font-weight: 400; color: var(--ink-2); }
.rr-mark { width: 30px; height: 30px; border-radius: 7px; background: #185FA5; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-fraunces), Georgia, serif; font-size: 18px; }
.rr-badge { padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.rr-link { margin-left: auto; font-size: 13px; font-weight: 600; color: var(--ink-2); text-decoration: none; }
.rr { max-width: 980px; margin: 0 auto; padding: 24px 16px 60px; }
.rr h1 { margin: 0; font-family: var(--font-fraunces), Georgia, serif; font-weight: 500; font-size: 30px; letter-spacing: -.01em; }
.rr-sub { margin: 4px 0 18px; color: var(--ink-2); max-width: 62ch; }
.rr-card { padding: 16px 18px; border: 1px solid var(--hair); border-radius: 14px; background: var(--surface); }
.rr-label { display: block; font-weight: 600; margin-bottom: 6px; }
.rr-label span { font-weight: 400; color: var(--ink-3); }
.rr-ta { width: 100%; box-sizing: border-box; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px; background: #fff; color: var(--ink); resize: vertical; }
.rr-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.rr-seg { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid var(--hair); border-radius: 10px; background: var(--surface); }
.rr-seg button { border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 600; color: var(--ink-2); padding: 7px 12px; border-radius: 8px; cursor: pointer; }
.rr-seg button.on { background: var(--ink); color: #fff; }
.rr-run { border: 0; background: var(--accent); color: #fff; font: inherit; font-weight: 700; padding: 9px 18px; border-radius: 10px; cursor: pointer; }
.rr-run:disabled { opacity: .6; cursor: default; }
.rr-ghost { border: 1px solid var(--hair); background: transparent; font: inherit; font-weight: 600; color: var(--ink-2); padding: 8px 12px; border-radius: 10px; cursor: pointer; }
.rr-muted { color: var(--ink-3); font-size: 12.5px; margin: 10px 0 0; }
.rr-progress { margin: 14px 0 0; color: var(--accent); font-weight: 600; }
.rr-error { margin: 10px 0 0; padding: 8px 12px; border-radius: 10px; background: #FDECEC; color: #8A1F1F; font-size: 13px; }
.rr-bar { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin: 20px 0 10px; color: var(--ink-2); }
.rr-bar select { font: inherit; margin-left: 4px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--hair); background: #fff; }
.rr-check { display: inline-flex; gap: 6px; align-items: center; }
.rr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.rr-item { display: flex; gap: 14px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 14px; background: var(--surface); }
.rr-item.off { opacity: .55; }
.rr-score { flex: none; width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-family: var(--font-fraunces), Georgia, serif; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.rr-score.sa { background: #DDF3E4; color: #14532D; } .rr-score.sb { background: #E9EFFC; color: #1B3A80; }
.rr-score.sc { background: #FFF4DB; color: #7A4B00; } .rr-score.sd, .rr-score.sx { background: #ECE8DD; color: var(--ink-3); }
.rr-body { min-width: 0; flex: 1; }
.rr-meta { font-size: 12.5px; color: var(--ink-3); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.rr-chip { padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 600; font-size: 11.5px; }
.rr-chip.done { background: #ECE8DD; color: var(--ink-2); }
.rr-title { display: block; margin-top: 4px; font-weight: 700; font-size: 15px; color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
.rr-title:hover { text-decoration: underline; }
.rr-snip { margin: 4px 0 0; color: var(--ink-2); overflow-wrap: anywhere; }
.rr-draft { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--hair); }
.rr-reply { margin-top: 12px; font: 14px/1.5 var(--font-inter), system-ui, sans-serif; }
.rr-prompt { margin-top: 12px; }
.rr-prompt summary { cursor: pointer; font-weight: 600; }
.rr-prompt summary span { font-weight: 400; color: var(--ink-3); }
.rr-prompt .rr-ta { margin-top: 10px; }
.rr-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.rr-actions button, .rr-open { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 11px; border-radius: 8px; border: 1px solid var(--hair); background: transparent; color: var(--ink-2); cursor: pointer; text-decoration: none; }
.rr-open { background: var(--ink); color: #fff; border-color: var(--ink); }
@media (max-width: 560px) { .rr-item { gap: 10px; padding: 12px; } .rr-score { width: 40px; height: 40px; font-size: 17px; } }
`
