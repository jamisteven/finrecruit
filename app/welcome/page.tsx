'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function Welcome() {
  const sid = useSearchParams().get('session_id')
  const [msg, setMsg] = useState('Setting up your access…')

  useEffect(() => {
    if (!sid) { setMsg('Missing checkout session.'); return }
    fetch('/api/stripe/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid }),
    })
      .then((r) => r.json())
      .then(async (d) => {
        if (d.token_hash) {
          const { createClient } = await import('@/lib/supabase-browser')
          const { error } = await createClient().auth.verifyOtp({
            token_hash: d.token_hash, type: 'magiclink',
          })
          if (error) { setMsg(`Sign-in failed: ${error.message}. Your pass is active — sign in at /login.`); return }
          window.location.href = '/'
          return
        }
        if (d.url) window.location.href = d.url
        else setMsg(`Could not sign you in automatically: ${d.error ?? 'unknown'}. Your pass is active — sign in at /login with the email you paid with.`)
      })
      .catch((e) => setMsg(`Could not reach the sign-in service: ${String(e)}`))
  }, [sid])

  return (
    <main style={{ maxWidth: 420, margin: '110px auto', padding: '0 22px',
      fontFamily: 'Inter, system-ui, sans-serif', textAlign: 'center', color: '#191713' }}>
      <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 500, marginBottom: 10 }}>
        Thanks — your pass is active.
      </h1>
      <p style={{ fontSize: 14, color: '#57544E' }}>{msg}</p>
    </main>
  )
}

export default function Page() {
  return <Suspense><Welcome /></Suspense>
}
