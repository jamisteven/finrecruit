import { ImageResponse } from 'next/og'

export async function GET(req: Request) {
  console.log('[og] route hit')
  
  try {
    const host = new URL(req.url).origin
    console.log('[og] host:', host)
    
    const fontRes = await fetch(`${host}/fraunces.woff2`)
    console.log('[og] font status:', fontRes.status)
    
    const fraunces = await fontRes.arrayBuffer()
    console.log('[og] font size:', fraunces.byteLength)

    return new ImageResponse(
      <div style={{ width: '1200px', height: '630px', background: '#F5F0E8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 60, fontFamily: 'Fraunces', fontWeight: 700 }}>Test</span>
      </div>,
      { width: 1200, height: 630, fonts: [{ name: 'Fraunces', data: fraunces, weight: 700 }] }
    )
  } catch (e) {
    console.error('[og] error:', e)
    return new Response(`Error: ${e}`, { status: 500 })
  }
}
