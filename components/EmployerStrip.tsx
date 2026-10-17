'use client'

import { useState } from 'react'

export type StripCompany = { name: string; domain: string; count: number }

// Logo images come from logo.dev by domain (NEXT_PUBLIC_LOGO_DEV_TOKEN in Vercel).
// Without a token, or when a logo fails to load, the mark falls back to the
// company's name, so the strip never shows a broken image.
const TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN
const logoUrl = (domain: string) =>
  TOKEN ? `https://img.logo.dev/${domain}?token=${TOKEN}&size=80&format=png&retina=true` : null

function Mark({ c, onPick }: { c: StripCompany; onPick: (name: string) => void }) {
  const [broken, setBroken] = useState(false)
  const src = logoUrl(c.domain)
  const label = `${c.count} ${c.count === 1 ? 'role' : 'roles'} at ${c.name} in the last 30 days`
  return (
    <button type="button" className="es-mark" title={label} aria-label={`${label} — show them`} onClick={() => onPick(c.name)}>
      {src && !broken
        // 28px icons from a logo CDN: next/image would add a loader hop for no gain
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt="" width={28} height={28} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        : <span className="es-dot" aria-hidden="true">{c.name.slice(0, 1)}</span>}
      <span className="es-name">{c.name}</span>
    </button>
  )
}

/**
 * Employers whose recruiters posted roles recently, as a slow marquee.
 * Fixed height so it never moves the page; the track is rendered twice and
 * translated by half, which loops seamlessly; it pauses on hover and becomes a
 * plain scrollable row when the visitor prefers reduced motion.
 */
export default function EmployerStrip({ companies, onPick }: { companies: StripCompany[]; onPick: (name: string) => void }) {
  if (companies.length < 6) return null
  // enough marks to fill wide screens before the loop repeats
  const base = companies.length < 12 ? [...companies, ...companies] : companies
  const seconds = Math.max(30, base.length * 3.2)
  return (
    <section className="es" aria-label="Employers whose recruiters posted roles recently">
      <p className="es-label">Recruiters posted roles at these companies in the last 30 days</p>
      <div className="es-viewport">
        <div className="es-track" style={{ animationDuration: `${seconds}s` }}>
          {[0, 1].map((copy) => (
            <div className="es-row" key={copy} aria-hidden={copy === 1}>
              {base.map((c, i) => <Mark key={`${copy}-${c.domain}-${i}`} c={c} onPick={onPick} />)}
            </div>
          ))}
        </div>
      </div>
      <style>{`
        .es { height: 96px; box-sizing: border-box; border-top: 1px solid var(--hairline, #E4DED1); border-bottom: 1px solid var(--hairline, #E4DED1);
          background: var(--surface-2, #FAF8F3); display: flex; flex-direction: column; justify-content: center; gap: 12px; overflow: hidden; }
        .es-label { margin: 0 auto; width: 100%; max-width: 1200px; box-sizing: border-box; padding: 0 28px;
          font: 500 11px 'Spline Sans Mono', ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3, #8A8378); }
        .es-viewport { position: relative; height: 36px; overflow: hidden;
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent);
                  mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent); }
        .es-track { display: flex; width: max-content; animation: es-scroll linear infinite; will-change: transform; }
        .es:hover .es-track, .es:focus-within .es-track { animation-play-state: paused; }
        .es-row { display: flex; align-items: center; gap: 44px; padding-right: 44px; }
        @keyframes es-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .es-mark { display: inline-flex; align-items: center; gap: 9px; height: 36px; padding: 0 4px; border: 0; background: none; cursor: pointer;
          font: 700 16px 'Inter', system-ui, sans-serif; letter-spacing: -.02em; color: var(--ink-2, #5C574D); white-space: nowrap;
          opacity: .72; filter: grayscale(1); transition: opacity .2s, filter .2s; }
        .es-mark:hover, .es-mark:focus-visible { opacity: 1; filter: none; color: var(--ink, #191713); outline: none; }
        .es-mark img { width: 28px; height: 28px; border-radius: 7px; object-fit: contain; background: #fff; }
        .es-dot { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; background: #DED8CC; color: #5C574D; font: 700 13px 'Inter', sans-serif; }
        @media (prefers-reduced-motion: reduce) {
          .es-track { animation: none; width: auto; }
          .es-viewport { overflow-x: auto; -webkit-mask-image: none; mask-image: none; scrollbar-width: none; }
          .es-row[aria-hidden="true"] { display: none; }
          .es-row { padding: 0 28px; }
        }
        @media (max-width: 720px) {
          .es { height: 88px; gap: 10px; }
          .es-label { padding: 0 16px; font-size: 10.5px; }
          .es-row { gap: 30px; padding-right: 30px; }
          .es-mark { font-size: 15px; }
        }
      `}</style>
    </section>
  )
}
