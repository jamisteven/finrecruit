import { renderPostSnapshot } from '../lib/postSnapshot'
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
const raw = `We're hiring!\n\nNorthwind Capital Partners is growing our Fund Accounting team in Chicago, and I'm looking for a Senior Financial Analyst. You'll report to Marcus Thompson, our CFO.\n\nWhat you'll do:\n• Own monthly close and reporting for 3 private equity funds\n• Partner directly with the CFO on investor reporting\n• Build and maintain our variance analysis models\n\nWhat we're looking for:\n• 5+ years in fund accounting or FP&A\n\nTo apply, send your resume to jalvarez@northwindcap.com`
;(async () => {
  const photo = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#c9a58b' } }).composite([{ input: Buffer.from('<svg width="200" height="200"><circle cx="100" cy="80" r="40" fill="#e6c3a6"/><rect x="40" y="130" width="120" height="70" fill="#35506b"/></svg>'), top: 0, left: 0 }]).jpeg().toBuffer()
  const tiny = await sharp(photo).resize(10, 10, { fit: 'cover' }).toBuffer()
  const out = await sharp(tiny).resize(184, 184, { kernel: 'cubic' }).jpeg({ quality: 80 }).toBuffer()
  const t = performance.now()
  const res = renderPostSnapshot({ raw_text: raw, author_name: 'Jennifer Alvarez', author_headline: 'Head of Talent Acquisition · Northwind Capital Partners', posted_at: new Date(Date.now() - 3 * 86400000).toISOString() }, Date.now(), `data:image/jpeg;base64,${out.toString('base64')}`)
  writeFileSync('_to_delete/snap.tmp.png', Buffer.from(await res!.arrayBuffer()))
  console.log('ms', Math.round(performance.now() - t))
})()
