import { ImageResponse } from 'next/og'
import { redactPost, shortAge, type Run } from '@/lib/redactPost'

const W = 1120            // drawn at 2x, shown at 560px
const BODY_H = 590
const HEAD_H = 190

// Draws the redacted post. Returns null when there is nothing worth showing.
export function renderPostSnapshot(
  job: { raw_text: string; author_name: string | null; author_headline: string | null; posted_at: string | null },
  now = Date.now(),
  avatar: string | null = null,   // a data: URI of the poster's profile photo, if we could fetch one
): ImageResponse | null {
  // Emoji would be fetched from a CDN on every render, so they are left out; the words are what matters.
  const plain = (v: string) => v.replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, '').replace(/[ \t]{2,}/g, ' ')
  const lines = redactPost(plain(job.raw_text).replace(/\n*Job card details:[^\n]*$/i, ''), job.author_name)
  if (!lines.length) return null
  const headline = redactPost(plain(job.author_headline ?? ''), job.author_name)[0] ?? []
  const age = shortAge(job.posted_at, now)

  const word = (w: string, k: string) => (
    <div key={k} style={{ display: 'flex', marginRight: 9 }}>{w}</div>
  )
  const renderRuns = (runs: Run[], key: string) => runs.flatMap((run, ri) => {
    if (run.r) {
      const w = Math.min(380, Math.max(70, run.t.trim().length * 13))
      return [<div key={`${key}-${ri}`} style={{ display: 'flex', width: w, height: 28, background: '#1d1d1d', borderRadius: 5, marginRight: 9, marginTop: 5 }} />]
    }
    return run.t.split(/\s+/).filter(Boolean).map((w, wi) => word(w, `${key}-${ri}-${wi}`))
  })

  const res = new ImageResponse(
    (
      <div style={{ width: W, height: '100%', display: 'flex', flexDirection: 'column', background: '#ffffff', border: '2px solid #D8D2C2', borderRadius: 24, overflow: 'hidden', fontSize: 28, color: '#1d1d1d' }}>
        <div style={{ display: 'flex', padding: '28px 32px 8px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', width: 92, height: 92, borderRadius: 46, background: 'linear-gradient(135deg, #c3cbdb, #7d8aa3)', marginRight: 22, flexShrink: 0, overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {avatar ? <img src={avatar} width={92} height={92} alt="" style={{ width: 92, height: 92, borderRadius: 46 }} /> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', width: 300, height: 30, borderRadius: 15, background: '#d4d7de', marginTop: 4 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 25, color: '#5b5b5b', marginTop: 10, maxHeight: 64, overflow: 'hidden' }}>
              {renderRuns(headline.length ? headline : [{ t: 'Recruiter', r: false }], 'h')}
            </div>
            <div style={{ display: 'flex', fontSize: 23, color: '#7a7a7a', marginTop: 4 }}>{age ? `${age} · Public post` : 'Public post'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', position: 'relative', height: BODY_H, padding: '8px 32px 0', overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', lineHeight: 1.45 }}>
            {lines.map((runs, li) => runs.length === 0 || !runs.some((r) => r.t.trim())
              ? <div key={li} style={{ display: 'flex', height: 20, flexShrink: 0 }} />
              : runs.every((r) => !r.r)
                // no redaction on this line: one text node is far cheaper to lay out than one per word
                ? <div key={li} style={{ display: 'flex', flexShrink: 0 }}>{runs.map((r) => r.t).join('')}</div>
                : <div key={li} style={{ display: 'flex', flexWrap: 'wrap', flexShrink: 0 }}>{renderRuns(runs, `l${li}`)}</div>)}
          </div>
          <div style={{ display: 'flex', position: 'absolute', left: 0, right: 0, bottom: 0, height: 300, background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,1) 70%)', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 26 }}>
            <div style={{ display: 'flex', fontSize: 24, color: '#5b5b5b', background: '#fff', border: '2px solid #D8D2C2', borderRadius: 40, padding: '10px 26px' }}>
              …see more · unlock the full post & recruiter
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: HEAD_H + BODY_H,
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
    },
  )
  return res
}
