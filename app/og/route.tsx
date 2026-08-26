import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'

export const runtime = 'nodejs'

// Static instances cut from Fraunces' variable font at the same axis values the
// site resolves to (wght 500/600, opsz 40, SOFT/WONK at default). Regenerate with:
//   fonttools varLib.instancer "Fraunces-VariableFont_SOFT,WONK,opsz,wght.ttf" \
//     wght=500 opsz=40 SOFT=0 WONK=0 -o app/og/fraunces-500.ttf
// Must be real TrueType — satori rejects woff/woff2.
export async function GET() {
  const [w500, w600] = await Promise.all([
    readFile(new URL('./fraunces-500.ttf', import.meta.url)),
    readFile(new URL('./fraunces-600.ttf', import.meta.url)),
  ])

  const rendered = new ImageResponse(
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
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: '#1A1A1A',
              display: 'flex',
            }}
          >
            backchannel.jobs
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 500,
              color: '#1A1A1A',
              marginTop: 60,
              lineHeight: 1.1,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span style={{ display: 'flex' }}>The jobs LinkedIn</span>
            {/* Site slants the roman rather than using Fraunces' true italic.
                Once you've confirmed the angle in your CSS, mirror it here:
                style={{ display: 'flex', transform: 'skewX(-10deg)' }} */}
            <span style={{ display: 'flex' }}>{"doesn't show you."}</span>
          </div>
          <div
            style={{
              fontSize: 22,
              color: '#6B6560',
              marginTop: 28,
              display: 'flex',
            }}
          >
            Roles recruiters post in the feed — classified by AI, refreshed twice a day.
          </div>
        </div>

        {/* Bottom Bar */}
        <div style={{ display: 'flex', gap: '80px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 52,
                fontWeight: 500,
                color: '#1A1A1A',
                display: 'flex',
              }}
            >
              2,300+
            </span>
            <span
              style={{
                fontSize: 14,
                color: '#9A9490',
                marginTop: 4,
                display: 'flex',
              }}
            >
              LIVE ROLES
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 52,
                fontWeight: 500,
                color: '#1A1A1A',
                display: 'flex',
              }}
            >
              436
            </span>
            <span
              style={{
                fontSize: 14,
                color: '#9A9490',
                marginTop: 4,
                display: 'flex',
              }}
            >
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
        { name: 'Fraunces', data: w500, weight: 500, style: 'normal' },
        { name: 'Fraunces', data: w600, weight: 600, style: 'normal' },
      ],
    }
  )

  // Render eagerly instead of streaming: satori errors surface here rather than
  // crashing the function mid-response, where try/catch can never see them.
  const png = await rendered.arrayBuffer()

  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, immutable, no-transform, max-age=31536000',
    },
  })
}
