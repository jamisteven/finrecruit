import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'

export async function GET() {
  // Fetch Fraunces TTF direct from Google Fonts CDN
  const fontData = await fetch(
    'https://fonts.gstatic.com/s/fraunces/v32/6NUv81yM7341izC2p_9_s956w30t12zO0OflXbgqI0_A2A.ttf'
  ).then((res) => res.arrayBuffer())

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: '#F5F0E8',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px',
          fontFamily: 'Fraunces',
        }}
      >
        {/* Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 28, color: '#1A1A1A', display: 'flex' }}>
            backchannel.jobs
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              color: '#1A1A1A',
              marginTop: 60,
              lineHeight: 1.1,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span style={{ display: 'flex' }}>The jobs LinkedIn</span>
            <span style={{ display: 'flex', fontStyle: 'italic' }}>
              {"doesn't show you."}
            </span>
          </div>
          <div
            style={{ fontSize: 22, color: '#6B6560', marginTop: 28, display: 'flex' }}
          >
            Roles recruiters post in the feed — classified by AI, refreshed twice a day.
          </div>
        </div>

        {/* Bottom Bar */}
        <div style={{ display: 'flex', gap: '80px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 52, fontWeight: 700, color: '#1A1A1A', display: 'flex' }}>
              2,300+
            </span>
            <span style={{ fontSize: 14, color: '#9A9490', marginTop: 4, display: 'flex' }}>
              LIVE ROLES
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 52, fontWeight: 700, color: '#1A1A1A', display: 'flex' }}>
              436
            </span>
            <span style={{ fontSize: 14, color: '#9A9490', marginTop: 4, display: 'flex' }}>
              LOCATIONS
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <span style={{ fontSize: 20, color: '#9A9490', display: 'flex' }}>
              New York · London · Toronto · Zurich
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Fraunces',
          data: fontData,
          weight: 700,
          style: 'normal',
        },
      ],
    }
  )
}