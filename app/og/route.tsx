import { ImageResponse } from 'next/og'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function GET() {
  try {
    console.log('[og] cwd:', process.cwd())
    const fontPath = join(process.cwd(), 'public/fraunces-700.woff2')
    console.log('[og] font path:', fontPath)
    const fontData = readFileSync(fontPath)
    console.log('[og] font loaded, size:', fontData.length)
    const fontBuffer = fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength)
    console.log('[og] font buffer size:', fontBuffer.byteLength)

    return new ImageResponse(
      <div style={{ width: '1200px', height: '630px', background: '#F5F0E8', display: 'flex', padding: '60px', fontFamily: 'Fraunces' }}>
        <span style={{ fontSize: 60, fontWeight: 700, color: '#1A1A1A' }}>The jobs LinkedIn</span>
      </div>,
      {
        width: 1200, height: 630,
        fonts: [{ name: 'Fraunces', data: fontBuffer, weight: 700, style: 'normal' }],
      }
    )
  } catch (e) {
    console.error('[og] error:', e)
    return new Response(`Error: ${e}`, { status: 500 })
  }
}
