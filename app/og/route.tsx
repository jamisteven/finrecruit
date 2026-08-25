import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'

export async function GET() {
  return new ImageResponse(
    <div style={{ width: '1200px', height: '630px', background: '#F5F0E8', display: 'flex', padding: '60px' }}>
      <span style={{ fontSize: 60, color: '#1A1A1A' }}>The jobs LinkedIn</span>
    </div>,
    { width: 1200, height: 630 }
  )
}
