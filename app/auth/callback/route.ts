import { NextRequest, NextResponse } from 'next/server'
import { getSessionClient } from '@/lib/supabase-session'

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code')
  if (code) {
    const db = await getSessionClient()
    await db.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/', req.url))
}
