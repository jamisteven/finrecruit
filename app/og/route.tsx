import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const skipFont = params.get('nofont') === '1'
  const debug = params.get('debug') === '1'

  const text = (body: string) =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })

  try {
    let fontData: Buffer | null = null
    let report = 'font: skipped (nofont=1)'

    if (!skipFont) {
      fontData = await readFile(new URL('./fraunces-700.ttf', import.meta.url))
      const magic = fontData.subarray(0, 4)
      const asAscii = magic.toString('latin1').replace(/[^\x20-\x7e]/g, '.')
      const asHex = magic.toString('hex').match(/../g)!.join(' ')
      report = [
        `bytes:  ${fontData.byteLength}`,
        `magic:  ${asHex}  (${asAscii})`,
        `verdict: ${
          asHex === '00 01 00 00'
            ? 'TrueType — satori should accept this'
            : asAscii === 'OTTO'
              ? 'CFF/OpenType — satori REJECTS this'
              : asAscii === 'wOFF'
                ? 'WOFF — satori REJECTS this'
                : asAscii === 'wOF2'
                  ? 'WOFF2 — satori REJECTS this (renamed woff2)'
                  : asAscii === 'true' || asAscii === 'ttcf'
                    ? 'TrueType variant — probably fine'
                    : 'NOT A FONT (HTML error page? truncated file?)'
        }`,
      ].join('\n')
    }

    if (debug) {
      return text(
        [
          'OG DEBUG',
          '',
          `cwd:      ${process.cwd()}`,
          `resolved: ${new URL('./fraunces-700.ttf', import.meta.url).href}`,
          '',
          report,
        ].join('\n')
      )
    }

    const options: Record<string, unknown> = { width: 1200, height: 630 }
    if (fontData) {
      options.fonts = [
        { name: 'Fraunces', data: fontData, weight: 400, style: 'normal' },
        { name: 'Fraunces', data: fontData, weight: 700, style: 'normal' },
      ]
    }

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
            fontFamily: skipFont ? 'sans-serif' : 'Fraunces',
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
              Roles recruiters post in the feed — classified by AI, refreshed twice a
              day.
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options as any
    )

    // Force rendering to happen HERE, inside the try, instead of during streaming.
    // Without this, satori errors escape the catch and kill the function.
    const png = await rendered.arrayBuffer()

    return new Response(png, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, immutable, no-transform, max-age=31536000',
      },
    })
  } catch (e) {
    // TEMPORARY: remove once the image renders.
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e)
    return text(`OG IMAGE FAILED\n\n${detail}`)
  }
}
