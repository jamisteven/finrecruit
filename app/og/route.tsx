import { ImageResponse } from 'next/og'

export async function GET() {
  const fontUrl = 'https://fonts.gstatic.com/s/fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIcUByTCf7T.woff2'
  const fraunces = await fetch(fontUrl).then(r => r.arrayBuffer())

  return new ImageResponse(
    <div style={{
      width: '1200px', height: '630px', background: '#F5F0E8',
      display: 'flex', flexDirection: 'column', padding: '60px',
      fontFamily: 'sans-serif',
    }}>
      <div style={{ fontSize: 28, color: '#1A1A1A', display: 'flex' }}>
        backchannel.jobs
      </div>
      <div style={{
        fontSize: 76, fontWeight: 700, color: '#1A1A1A',
        fontFamily: 'Fraunces', marginTop: 60, lineHeight: 1.1,
        display: 'flex', flexDirection: 'column',
      }}>
        <span>The jobs LinkedIn</span>
        <span style={{ fontStyle: 'italic' }}>{"doesn't show you."}</span>
      </div>
      <div style={{ fontSize: 22, color: '#6B6560', marginTop: 28, display: 'flex' }}>
        Roles recruiters post in the feed — classified by AI, refreshed twice a day.
      </div>
      <div style={{ display: 'flex', gap: '80px', marginTop: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 52, fontWeight: 700, fontFamily: 'Fraunces', color: '#1A1A1A' }}>2,300+</span>
          <span style={{ fontSize: 14, color: '#9A9490', marginTop: 4 }}>LIVE ROLES</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 52, fontWeight: 700, fontFamily: 'Fraunces', color: '#1A1A1A' }}>436</span>
          <span style={{ fontSize: 14, color: '#9A9490', marginTop: 4 }}>LOCATIONS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 20, color: '#9A9490' }}>New York · London · Toronto · Zurich</span>
        </div>
      </div>
    </div>,
    {
      width: 1200, height: 630,
      fonts: [{ name: 'Fraunces', data: fraunces, weight: 700, style: 'normal' }],
    }
  )
}
