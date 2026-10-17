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
      <div className="es-inner">
        <div className="es-viewport">
        <div className="es-track" style={{ animationDuration: `${seconds}s` }}>
          {[0, 1].map((copy) => (
            <div className="es-row" key={copy} aria-hidden={copy === 1}>
              {base.map((c, i) => <Mark key={`${copy}-${c.domain}-${i}`} c={c} onPick={onPick} />)}
            </div>
          ))}
        </div>
        </div>
      </div>
      <style>{`
        /* Aligned to the page column (max-width + side padding match .hero/.layout), one
           compact row: a short label on the left, the marquee filling the rest. */
        /* .ulj .es rather than .es: the page resets margins with ".ulj *", which would
           otherwise zero the auto margins that centre this like .hero and .layout. */
        .ulj .es, .es { max-width: 1200px; margin: 0 auto; padding: 0 28px; box-sizing: border-box; }
        .es-inner { height: 48px; box-sizing: border-box; display: flex; align-items: center;
          border-top: 1px solid var(--hairline, #E4DED1); border-bottom: 1px solid var(--hairline, #E4DED1); }
        .es-viewport { position: relative; flex: 1; min-width: 0; height: 30px; overflow: hidden;
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
                  mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
        .es-track { display: flex; width: max-content; animation: es-scroll linear infinite; will-change: transform; }
        .es:hover .es-track, .es:focus-within .es-track { animation-play-state: paused; }
        .es-row { display: flex; align-items: center; gap: 34px; padding-right: 34px; }
        @keyframes es-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .es-mark { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 2px; border: 0; background: none; cursor: pointer;
          font: 600 13.5px 'Inter', system-ui, sans-serif; letter-spacing: -.01em; color: var(--ink-2, #5C574D); white-space: nowrap;
          opacity: .7; filter: grayscale(1); transition: opacity .2s, filter .2s; }
        .es-mark:hover, .es-mark:focus-visible { opacity: 1; filter: none; color: var(--ink, #191713); outline: none; }
        .es-mark img { width: 20px; height: 20px; border-radius: 5px; object-fit: contain; background: #fff; }
        .es-dot { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: #DED8CC; color: #5C574D; font: 700 11px 'Inter', sans-serif; }
        @media (prefers-reduced-motion: reduce) {
          .es-track { animation: none; width: auto; }
          .es-viewport { overflow-x: auto; -webkit-mask-image: none; mask-image: none; scrollbar-width: none; }
          .es-row[aria-hidden="true"] { display: none; }
          .es-row { padding-right: 0; }
        }
        @media (max-width: 760px) {
          /* The plan cards above end with 24px of padding, the feed below starts with 4px:
             pull up 6 and push down 14 so the strip sits 18px from each. */
          .ulj .es, .es { padding: 0 16px; margin: -6px auto 14px; }
          .es-inner { height: 44px; }
          .es-row { gap: 26px; padding-right: 26px; }
          .es-mark { font-size: 13px; }
        }
      `}</style>
    </section>
  )
}
