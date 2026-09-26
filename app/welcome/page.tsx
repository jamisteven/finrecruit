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
      .then((d) => {
        if (d.url) window.location.href = d.url
        else setMsg('Payment received. Check your email for a sign-in link.')
      })
      .catch(() => setMsg('Payment received. Check your email for a sign-in link.'))
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
