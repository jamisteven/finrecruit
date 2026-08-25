import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'

export async function GET() {
  const fs = await import('fs')
  const path = await import('path')
  
  try {
    const fontBuffer = fs.readFileSync(path.join(process.cwd(), 'public/fraunces-700.ttf'))
    
    return new ImageResponse(
      <div style={{ width: '1200px', height: '630px', background: 'red', display: 'flex' }}>
        <span style={{ fontSize: 60, color: 'white', fontFamily: 'Fraunces' }}>Test</span>
      </div>,
      { width: 1200, height: 630, fonts: [{ name: 'Fraunces', data: fontBuffer, weight: 700 }] }
    )
  } catch (e) {
    return new Response(`ERROR: ${String(e)}`, { status: 200, headers: { 'content-type': 'text/plain' } })
  }
}
