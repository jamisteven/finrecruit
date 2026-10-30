import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { validUnsubToken } from '@/lib/winback'

export const dynamic = 'force-dynamic'

// Unsubscribe from marketing email. GET shows a confirm button (so mail scanners that pre-open links do not
// unsubscribe people); POST does it. The List-Unsubscribe-Post one-click header from the mail app POSTs here too.

const page = (title: string, body: string) => new NextResponse(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#F5F2EB;font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#191713"><div style="max-width:440px;margin:15vh auto;padding:0 20px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:600;margin:0 0 18px">backchannel<span style="color:#5C574D;font-weight:400;font-style:italic">.jobs</span></p>${body}</div></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

const params = (req: NextRequest) => {
  const u = req.nextUrl.searchParams.get('u') ?? ''
  const t = req.nextUrl.searchParams.get('t') ?? ''
  return { u, t, ok: /^[0-9a-f-]{36}$/i.test(u) && validUnsubToken(u, t) }
}

export async function GET(req: NextRequest) {
  const { u, t, ok } = params(req)
  if (!ok) return page('Link problem', '<p>This unsubscribe link is not valid. Reply to any of our emails and we will remove you by hand.</p>')
  return page('Unsubscribe', `<p style="font-size:16px;line-height:1.5">Stop marketing emails from Backchannel?</p>
<form method="post" action="/api/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}"><button style="padding:12px 18px;border-radius:10px;border:0;background:#1B4F82;color:#fff;font-weight:600;font-size:15px;cursor:pointer">Unsubscribe</button></form>
<p style="font-size:13px;color:#5C574D">You will still get account emails, like receipts and login links.</p>`)
}

export async function POST(req: NextRequest) {
  const { u, ok } = params(req)
  if (!ok) return page('Link problem', '<p>This unsubscribe link is not valid.</p>')
  const { error } = await createServerClient().from('profiles').update({ email_unsubscribed_at: new Date().toISOString() }).eq('id', u)
  if (error) return page('Something went wrong', '<p>We could not save that. Reply to any of our emails and we will remove you by hand.</p>')
  return page('Unsubscribed', '<p style="font-size:16px;line-height:1.5">You are unsubscribed. We will not send you marketing email again.</p>')
}
