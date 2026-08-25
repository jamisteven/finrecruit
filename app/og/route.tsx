import { ImageResponse } from 'next/og'

export async function GET() {
  console.log('[og] start')
  try {
    const fs = require('fs')
    const path = require('path')
    console.log('[og] modules loaded')
    const fontData = fs.readFileSync(path.join(process.cwd(), 'public/fraunces-700.woff2'))
    console.log('[og] font loaded:', fontData.length)
    const fontBuffer = fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength)

    return new ImageResponse(
      <div style={{ width: '1200px', height: '630px', background: '#F5F0E8', display: 'flex', padding: '60px', fontFamily: 'Fraunces' }}>
        <span style={{ fontSize: 60, fontWeight: 700, color: '#1A1A1A' }}>The jobs LinkedIn</span>
      </div>,
      { width: 1200, height: 630, fonts: [{ name: 'Fraunces', data: fontBuffer, weight: 700, style: 'normal' }] }
    )
  } catch (e) {
    console.error('[og] error:', String(e))
    return new Response(`Error: ${String(e)}`, { status: 200 })
  }
}
