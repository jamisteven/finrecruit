import { ImageResponse } from 'next/og'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const fontBuffer = readFileSync(join(process.cwd(), 'public/fraunces-700.ttf'))
    console.log('[og] font size:', fontBuffer.length)
    
    return new ImageResponse(
      <div style={{ width: '1200px', height: '630px', background: '#F5F0E8', display: 'flex', padding: '60px', fontFamily: 'Fraunces' }}>
        <span style={{ fontSize: 60, fontWeight: 700, color: '#1A1A1A' }}>Test Fraunces</span>
      </div>,
      { width: 1200, height: 630, fonts: [{ name: 'Fraunces', data: fontBuffer, weight: 700, style: 'normal' }] }
    )
  } catch (e) {
    return new Response(`ERROR: ${String(e)}`, { status: 200, headers: { 'content-type': 'text/plain' } })
  }
}
