import { ImageResponse } from 'next/og'

export async function GET(req: Request) {
  const host = new URL(req.url).origin
  const fraunces = await fetch(`${host}/fraunces.woff2`).then(r => r.arrayBuffer())

  return new ImageResponse(
    <div style={{ display: 'flex', width: '1200px', height: '630px', background: '#F5F0E8' }}>
      <span>Test</span>
    </div>,
    { width: 1200, height: 630 }
  )
}
