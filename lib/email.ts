// Transactional email to members, via Resend's REST API. No SDK, no templates
// engine: a couple of plain, short messages. Silent no-op until RESEND_API_KEY
// and EMAIL_FROM are set in Vercel, so the code can ship before the account exists.

import type { MemberStatus } from './targetStatus'

const SITE = 'https://www.backchanneljobs.com'

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) { console.log(`[email] skipped (no RESEND_API_KEY/EMAIL_FROM): "${subject}" -> ${to}`); return false }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text, reply_to: process.env.EMAIL_REPLY_TO || undefined }),
    })
    if (!res.ok) { console.error('[email] resend error', res.status, await res.text()); return false }
    return true
  } catch (e) { console.error('[email] failed', e); return false }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const place = (l: string | null) => (l ? cap(l) : 'anywhere')

/**
 * Sent once, shortly after a member saves their targets and the searches have run.
 * Says what landed, and what happens from here.
 */
export function searchesReadyEmail(status: MemberStatus): { subject: string; html: string; text: string } {
  const total = status.exactTotal
  const subject = total > 0
    ? `${total} role${total === 1 ? '' : 's'} matched your searches`
    : 'Your searches are running'

  const lines = status.targets.map((t) => {
    const n = t.exact
    const extra = n === 0 && t.nearby > 0 ? ` (${t.nearby} ${t.nearby === 1 ? 'role' : 'roles'} with that title elsewhere)` : ''
    return { label: `${cap(t.keyword)} · ${place(t.location)}`, value: `${n} ${n === 1 ? 'role' : 'roles'}${extra}` }
  })

  const fromHere = [
    'From here on, nothing to do. Recruiter posts that match your searches land in your feed automatically, as we find them, around the clock. We check each of your searches at least twice a day.',
    'Your feed shows exact matches first, then the same roles in nearby places, then the rest. Every listing names the person who posted it, so you can message them directly.',
    'If a search is quiet for a few days, that\'s the market, not us: we\'ll have checked it and found nothing new.',
  ]

  const text = [
    total > 0 ? `${total} roles matched the searches you set up.` : 'Your searches are set up and running; nothing has matched yet, which is normal for the first hour.',
    '',
    ...lines.map((l) => `${l.label}: ${l.value}`),
    '',
    `See them: ${SITE}/?mine=1`,
    '',
    ...fromHere,
    '',
    'Reply to this email if anything looks wrong; a person reads it.',
  ].join('\n')

  const html = `<!doctype html><html><body style="margin:0;background:#F5F2EB;font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#191713">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:20px;font-weight:600">backchannel<span style="color:#5C574D;font-weight:400;font-style:italic">.jobs</span></p>
    <h1 style="margin:0 0 10px;font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.2">${total > 0 ? `${total} role${total === 1 ? '' : 's'} matched your searches.` : 'Your searches are running.'}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#5C574D">${total > 0 ? 'Here is what landed for each search you set up.' : 'Nothing has matched yet, which is normal for the first hour. Here is what we are watching for you.'}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 22px">
      ${lines.map((l) => `<tr><td style="padding:10px 0;border-bottom:1px solid #E4DED1;font-size:14.5px">${esc(l.label)}</td><td style="padding:10px 0;border-bottom:1px solid #E4DED1;font-size:14.5px;text-align:right;font-weight:600;white-space:nowrap">${esc(l.value)}</td></tr>`).join('')}
    </table>
    <p style="margin:0 0 26px"><a href="${SITE}/?mine=1" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#24468f;color:#fff;text-decoration:none;font-weight:600;font-size:15px">See your matches</a></p>
    <h2 style="margin:0 0 8px;font-family:Georgia,serif;font-weight:500;font-size:18px">What happens from here</h2>
    ${fromHere.map((p) => `<p style="margin:0 0 12px;font-size:14.5px;line-height:1.55;color:#191713">${esc(p)}</p>`).join('')}
    <p style="margin:22px 0 0;font-size:13px;color:#8A8378;line-height:1.5">Reply to this email if anything looks wrong; a person reads it.</p>
  </div></body></html>`

  return { subject, html, text }
}
