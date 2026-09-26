import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const token = url.searchParams.get('token_hash')
  const res = NextResponse.redirect(new URL('/', req.url))

  console.log('[auth] callback params:', url.search || '(none)')
  if (!code && !token) {
    console.error('[auth] no code or token_hash in callback')
    return res
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        // write onto the response so the browser actually receives them
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    }
  )

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) console.error('[auth] exchange failed:', error.message)
    else console.log('[auth] session established')
  } else if (token) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'magiclink' })
    if (error) console.error('[auth] verifyOtp failed:', error.message)
    else console.log('[auth] session established via otp')
  }

  return res
}
