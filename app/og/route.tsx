import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'

export const runtime = 'nodejs'

export async function GET() {
  // Static Fraunces TTFs live in this folder, next to route.tsx.
  // They MUST be real TrueType (magic bytes 00 01 00 00) — satori rejects woff/woff2.
  const [regular, bold, boldItalic] = await Promise.all([
    readFile(new URL('./Fraunces_72pt-Regular.ttf', import.meta.url)),
    readFile(new URL('./Fraunces_72pt-Bold.ttf', import.meta.url)),
    readFile(new URL('./Fraunces_72pt-BoldItalic.ttf', import.meta.url)),
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
                fontWeight: 700,
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
                fontWeight: 700,
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
        { name: 'Fraunces', data: regular, weight: 400, style: 'normal' },
        { name: 'Fraunces', data: bold, weight: 700, style: 'normal' },
        { name: 'Fraunces', data: boldItalic, weight: 700, style: 'italic' },
      ],
    }
  )

  // Render eagerly instead of streaming: satori errors surface here, where they can
  // be seen and handled, rather than crashing the function mid-response.
  const png = await rendered.arrayBuffer()

  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, immutable, no-transform, max-age=31536000',
    },
  })
}
