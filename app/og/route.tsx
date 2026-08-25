import { ImageResponse } from 'next/og'

export async function GET() {
  const fraunces = await fetch(
    'https://fonts.gstatic.com/s/fraunces/v31/6NUu8FyLNQOQZAnv9ZwNjucMHVn85Ni7emAe.woff2'
  ).then(res => res.arrayBuffer())

  return new ImageResponse(
    (
      <div style={{
        width: '1200px', height: '630px',
        background: '#F5F0E8',
        display: 'flex', flexDirection: 'column',
        padding: '60px',
      }}>
        <div style={{ fontSize: 28, color: '#1A1A1A', fontFamily: 'sans-serif' }}>
          backchannel.<span style={{ fontStyle: 'italic' }}>jobs</span>
        </div>
        <div style={{ fontSize: 80, fontWeight: 700, color: '#1A1A1A', fontFamily: 'Fraunces', marginTop: 80, lineHeight: 1.1 }}>
          The jobs LinkedIn
          <br />
          <span style={{ fontStyle: 'italic' }}>doesn't show you.</span>
        </div>
        <div style={{ fontSize: 24, color: '#6B6560', marginTop: 24, fontFamily: 'sans-serif' }}>
          Roles recruiters post in the feed and never list — pulled from public posts, classified by AI, refreshed twice a day.
        </div>
        <div style={{ display: 'flex', gap: '80px', marginTop: 'auto' }}>
          {[['2300', 'LIVE ROLES'], ['436', 'LOCATIONS'], ['75', 'ADDED TODAY']].map(([num, label]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 52, fontWeight: 700, color: '#1A1A1A', fontFamily: 'Fraunces' }}>{num}</span>
              <span style={{ fontSize: 14, color: '#9A9490', letterSpacing: '0.08em', fontFamily: 'sans-serif' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [{ name: 'Fraunces', data: fraunces, weight: 700 }],
    }
  )
}