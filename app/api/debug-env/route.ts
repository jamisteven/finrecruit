import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
export async function GET() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  let role = 'unparseable', ref = ''
  try {
    const p = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString())
    role = p.role ?? 'none'; ref = p.ref ?? ''
  } catch {}
  return NextResponse.json({ role, ref })
}
