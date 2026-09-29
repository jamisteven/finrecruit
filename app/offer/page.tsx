'use client'

import { useEffect, useState } from 'react'

type Job = {
  id: string
  title: string
  company: string | null
  location: string | null
  sector: string
  seniority: string | null
  posted_at: string | null
  summary: string | null
  post_url: string
  author_name: string | null
  author_headline: string | null
}

const SECTOR_LABEL: Record<string, string> = {
  finance: 'Finance', tech: 'Tech', legal: 'Legal',
  marketing: 'Marketing', realestate: 'Real Estate',
}

function ago(iso: string | null) {
  if (!iso) return ''
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function Cta({ busy, onClick, label = 'Get my 14-day pass — $9' }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <div className="cta-wrap">
      <button className="cta" onClick={onClick} disabled={busy}>
        {busy ? 'Opening checkout…' : label}
      </button>
      <p className="cta-sub">No subscription · Expires on its own · Refund if you find nothing</p>
    </div>
  )
}

export default function OfferPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [withheld, setWithheld] = useState(0)
  const [today, setToday] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [hasPass, setHasPass] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/jobs?limit=4&sortBy=newest')
      .then((r) => r.json())
      .then((d) => {
        setJobs((d.jobs ?? []).slice(0, 6))
        setWithheld(d.withheld ?? 0)
        setToday((d.previewCount ?? 0) + (d.withheld ?? 0))
        setHasPass(!!d.hasPass)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const buy = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const d = await res.json()
      if (d.url) window.location.href = d.url
      else { setErr(d.error ?? 'Could not start checkout'); setBusy(false) }
    } catch { setErr('Could not start checkout'); setBusy(false) }
  }

  return (
    <main className="offer">
      <a className="back" href="/">← Back to the feed</a>

      <section className="hero">
        {today > 0 && (
          <div className="pill"><i /> {today} roles landed today</div>
        )}
        <h1>The jobs LinkedIn doesn&apos;t show you — for the next 14 days</h1>
        <p className="lede">
          Recruiters, hiring managers and internal talent teams post openings straight into
          their LinkedIn feed. Those posts never become listings, so nobody can search
          them. We read them eight times a day.
        </p>
        <Cta busy={busy} onClick={buy} />
        {err && <p className="err">{err}</p>}
      </section>

      <section className="proof">
        <div className="sec-label">Landed today</div>
        <div className="proof-list">
          {!loaded && [0, 1, 2].map((i) => (
            <div key={`sk${i}`} className="proof-row skel">
              <div className="skel-line w30" />
              <div className="skel-line w70 tall" />
              <div className="skel-line w45" />
            </div>
          ))}
          {loaded && jobs.slice(0, 3).map((j, i) => (
            <div key={j.id} className="proof-row">
              <div className="proof-meta">
                {SECTOR_LABEL[j.sector] ?? j.sector}
                {j.location && <> · {j.location}</>}
              </div>
              <div className="proof-title">
                {i > 2 ? j.title : <a href={j.post_url} target="_blank" rel="noopener noreferrer">{j.title}</a>}
              </div>
              <div className="proof-co">
                {j.company}
                {j.seniority && j.seniority !== 'Unknown' && <> · {j.seniority}</>}
              </div>
              {j.summary && <p className="proof-sum">{j.summary}</p>}
              {j.author_name && (
                <div className="proof-by">
                  {j.author_name}{j.author_headline && <> · {j.author_headline}</>}
                </div>
              )}
              <span className="proof-ago">{ago(j.posted_at)}</span>
            </div>
          ))}
          {withheld > 0 && jobs[3] && (
            <div className="proof-row teaser">
              <div className="teaser-peek">
                <div className="proof-meta">{SECTOR_LABEL[jobs[3].sector] ?? jobs[3].sector}{jobs[3].location && <> · {jobs[3].location}</>}</div>
                <div className="proof-title">{jobs[3].title}</div>
                <div className="proof-co">{jobs[3].company}</div>
              </div>
              <div className="teaser-veil">
                <span>{withheld} more landed today</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="pain">
        <h2>By the time a role reaches a job board, 400 people have applied</h2>
        <p>
          The ones that never reach a board are different. A recruiter, a hiring manager or
          someone on an internal talent team writes a post, their network sees it, a
          handful of people reply, and it&apos;s filled. Most
          roles are gone inside 48 hours — usually before anyone outside that network
          knew they existed.
        </p>
      </section>

      <section className="steps">
        <div className="sec-label">How it works</div>
        <ol>
          <li><b>Someone hiring posts to their feed</b><span>Not the jobs section. No listing, no search index, no queue.</span></li>
          <li><b>We read the feed eight times a day</b><span>Every post, classified and filed by sector and city within the hour.</span></li>
          <li><b>You reply while the list is short</b><span>Straight to the person hiring, before it becomes a numbers game.</span></li>
        </ol>
      </section>

      <Cta busy={busy} onClick={buy} />

      <section className="compare">
        <div className="sec-label">How it compares</div>
        <div className="compare-grid">
          <div className="col">
            <div className="col-name">LinkedIn Jobs</div>
            <ul><li>Hundreds of applicants</li><li>Screened by filters first</li><li>No one to talk to</li></ul>
          </div>
          <div className="col">
            <div className="col-name">Indeed &amp; aggregators</div>
            <ul><li>Reposted from elsewhere</li><li>Often already filled</li><li>Apply into a void</li></ul>
          </div>
          <div className="col highlight">
            <div className="col-name">BackchannelJobs</div>
            <ul><li>A named person, same day</li><li>Posted hours ago, not weeks</li><li>Reply to a person</li></ul>
          </div>
        </div>
      </section>

      <section className="guarantee">
        <h2>Nothing worth applying to? Tell us and we&apos;ll refund you.</h2>
        <p>
          Fourteen days is long enough to know. If the feed doesn&apos;t surface a single
          role you want to go after, email us and we&apos;ll send the $9 back.
        </p>
        <Cta busy={busy} onClick={buy} />
      </section>

      <section className="pricing">
        <div className="sec-label">What it costs</div>
        <div className="price-grid">
          <div className="price">
            <div className="price-name">Free</div>
            <div className="price-fig">$0</div>
            <ul><li>10 fresh roles a day</li><li>Everything else after 24 hours</li></ul>
          </div>
          <div className="price featured">
            <div className="price-name">14-day pass</div>
            <div className="price-fig">$9</div>
            <ul><li>Every role as it lands</li><li>Full archive</li><li>Expires on its own</li></ul>
          </div>
          <div className="price muted">
            <div className="price-name">A recruiter&apos;s fee</div>
            <div className="price-fig">15–25%</div>
            <ul><li>Of your first-year salary</li><li>Paid by the employer, priced into the offer</li></ul>
          </div>
        </div>
      </section>

      <section className="faq">
        <div className="sec-label">Before you buy</div>
        <div className="q"><b>Are these real openings?</b><span>Every card links to the original LinkedIn post. You can read it yourself and message the person who wrote it.</span></div>
        <div className="q"><b>What if I find something on day one?</b><span>Then it did its job. The pass expires by itself either way — there&apos;s nothing to cancel.</span></div>
        <div className="q"><b>Why don&apos;t some roles name the company?</b><span>Because the recruiter chose not to. They want candidates to come through them rather than apply direct — which is exactly why these roles never reach a job board. Message the person who posted it.</span></div>
        <div className="q"><b>Does it renew?</b><span>No. It&apos;s a single $9 charge for 14 days. We can&apos;t charge you again without you buying again.</span></div>
        <div className="q"><b>Which sectors?</b><span>Finance, tech, legal, marketing and real estate, across {jobs.length > 0 ? 'every major market' : 'the US, UK, Europe, Canada and the Gulf'}.</span></div>
      </section>

      <section className="closing">
        <h2>The jobs LinkedIn doesn&apos;t show you</h2>
        <p>{today > 0 ? `${today} landed today. A pass shows you all of them.` : 'A pass shows you every role the moment it lands.'}</p>
        <Cta busy={busy} onClick={buy} />
      </section>

      <style>{`
        html, body { background: #F5F2EB; margin: 0; }
        .offer { max-width: 980px; margin: 0 auto; padding: 34px 26px 90px;
          font-family: 'Inter', system-ui, sans-serif; color: #191713; }
        .offer .back { font-size: 13px; color: #6B6862; text-decoration: none; }
        .offer section { padding: 46px 0; border-bottom: 1px solid #E2DCD0; }
        .offer section:last-of-type { border-bottom: none; }
        .offer h1 { font-family: 'Fraunces', Georgia, serif; font-size: 34px; font-weight: 500;
          line-height: 1.16; margin: 16px 0 12px; letter-spacing: -0.01em; }
        .offer h2 { font-family: 'Fraunces', Georgia, serif; font-size: 23px; font-weight: 500;
          line-height: 1.25; margin: 0 0 10px; }
        .offer p { font-size: 14.5px; line-height: 1.7; color: #57544E; margin: 0; max-width: 68ch; }
        .offer .hero, .offer .guarantee, .offer .closing { text-align: center; }
        .offer .hero p, .offer .guarantee p, .offer .closing p { margin-left: auto; margin-right: auto; }
        .offer .lede { margin-bottom: 26px; max-width: 56ch; margin-left: auto; margin-right: auto; }
        .offer .sec-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
          color: #8B877F; margin-bottom: 16px; }
        .offer .pill { display: inline-flex; align-items: center; gap: 7px; background: #EDE8DF;
          border: 1px solid #DDD6C8; border-radius: 20px; padding: 4px 12px; font-size: 12px; color: #57544E; }
        .offer .pill i { width: 6px; height: 6px; border-radius: 50%; background: #1D9E75; }
        .offer .cta-wrap { margin: 26px 0 0; }
        .offer .cta { display: block; width: 100%; max-width: 420px; margin: 0 auto; background: #191713; color: #F5F2EB;
          border: none; font: 500 15px 'Inter', sans-serif; padding: 15px; border-radius: 10px; cursor: pointer; }
        .offer .cta:disabled { opacity: 0.6; cursor: default; }
        .offer .cta-sub { font-size: 12px; color: #8B877F; text-align: center; margin: 9px auto 0; max-width: none; }
        .offer .err { font-size: 13px; color: #A32D2D; text-align: center; margin-top: 10px; }

        .offer .proof-list { display: flex; flex-direction: column; gap: 8px; }
        .offer .proof-row { position: relative; background: #FDFCFA; border: 1px solid #E2DCD0;
          border-radius: 11px; padding: 13px 15px; }
        .offer .proof-row.veiled { filter: blur(4px); user-select: none; pointer-events: none; }
        .offer .proof-meta { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #8B877F; }
        .offer .proof-title { font-family: 'Fraunces', Georgia, serif; font-size: 17px; margin-top: 3px; }
        .offer .proof-co { font-size: 12.5px; color: #57544E; margin-top: 2px; }
        .offer .proof-title a { color: inherit; text-decoration: none; }
        .offer .proof-title a:hover { text-decoration: underline; text-underline-offset: 3px; }
        .offer .proof-sum { font-size: 13px; color: #57544E; line-height: 1.6; margin: 7px 0 0; }
        .offer .proof-by { font-size: 11.5px; color: #8B877F; margin-top: 8px; }
        .offer .proof-ago { position: absolute; top: 13px; right: 15px; font-size: 11px; color: #8B877F; }
        .offer .proof-row.skel { display: flex; flex-direction: column; gap: 9px; }
        .offer .skel-line { height: 11px; border-radius: 5px; background: #EDE8DF;
          animation: skelpulse 1.4s ease-in-out infinite; }
        .offer .skel-line.tall { height: 17px; }
        .offer .skel-line.w30 { width: 30%; }
        .offer .skel-line.w45 { width: 45%; }
        .offer .skel-line.w70 { width: 70%; }
        @keyframes skelpulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.45 } }
        .offer .proof-row.teaser { position: relative; overflow: hidden; min-height: 92px; }
        .offer .teaser-peek { filter: blur(4.5px); user-select: none; pointer-events: none; }
        .offer .teaser-veil { position: absolute; inset: 0; display: flex; align-items: center;
          justify-content: center; background: rgba(245,242,235,0.78); }
        .offer .teaser-veil span { font-family: 'Fraunces', Georgia, serif; font-size: 18px; color: #191713; }
        .offer .proof-more { text-align: center; font-size: 13px; color: #57544E; padding: 6px 0 0; }

        .offer .steps ol { list-style: none; counter-reset: s; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 18px; }
        .offer .steps li { counter-increment: s; padding-left: 40px; position: relative; }
        .offer .steps li::before { content: counter(s); position: absolute; left: 0; top: 0;
          width: 27px; height: 27px; border-radius: 50%; background: #EDE8DF; color: #57544E;
          font-size: 12px; display: flex; align-items: center; justify-content: center; }
        .offer .steps b { display: block; font-size: 15px; font-weight: 500; }
        .offer .steps span { display: block; font-size: 13.5px; color: #57544E; margin-top: 3px; line-height: 1.6; }

        .offer .compare-grid, .offer .price-grid { display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .offer .col, .offer .price { background: #FDFCFA; border: 1px solid #E2DCD0;
          border-radius: 12px; padding: 15px; }
        .offer .col.highlight, .offer .price.featured { border: 2px solid #191713; }
        .offer .price.muted { background: transparent; }
        .offer .col-name, .offer .price-name { font-size: 13px; }
        .offer .price-fig { font-family: 'Fraunces', Georgia, serif; font-size: 25px; margin: 3px 0 11px; }
        .offer .col ul, .offer .price ul { list-style: none; padding: 0; margin: 9px 0 0; }
        .offer .col li, .offer .price li { font-size: 12px; color: #57544E; padding: 4px 0 4px 12px;
          position: relative; line-height: 1.5; }
        .offer .col li::before, .offer .price li::before { content: '·'; position: absolute; left: 2px; color: #A8A49B; }

        .offer .q { padding: 13px 0; border-top: 1px solid #EDE8DF; }
        .offer .q:first-of-type { border-top: none; }
        .offer .q b { display: block; font-size: 14px; font-weight: 500; }
        .offer .q span { display: block; font-size: 13.5px; color: #57544E; margin-top: 4px; line-height: 1.65; }

        .offer .closing { text-align: center; }
        .offer .closing p { margin-bottom: 4px; }

        @media (max-width: 560px) {
          .offer h1 { font-size: 27px; }
          .offer .compare-grid, .offer .price-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  )
}
