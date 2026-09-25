'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const send = async () => {
    if (!email.trim() || !email.includes('@')) {
      setStatus('error'); setMessage('Enter a valid email address')
      return
    }
    setStatus('sending')
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) { setStatus('error'); setMessage(error.message) }
    else { setStatus('sent'); setMessage('') }
  }

  return (
    <main style={{ maxWidth: 380, margin: '80px auto', padding: '0 20px', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 8 }}>Sign in</h1>
      <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 24 }}>
        We&apos;ll email you a link. No password needed.
      </p>

      {status === 'sent' ? (
        <p style={{ fontSize: 14 }}>Check your inbox for a sign-in link.</p>
      ) : (
        <>
          <input
            type="email"
            value={email}
            placeholder="you@email.com"
            onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8, border: '1px solid #D8D2C4', marginBottom: 10 }}
          />
          <button
            onClick={send}
            disabled={status === 'sending'}
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8, border: 'none', background: '#1A1A1A', color: '#F5F0E8', cursor: 'pointer' }}
          >
            {status === 'sending' ? 'Sending…' : 'Email me a link'}
          </button>
          {status === 'error' && (
            <p style={{ fontSize: 13, color: '#A32D2D', marginTop: 10 }}>{message}</p>
          )}
        </>
      )}
    </main>
  )
}
