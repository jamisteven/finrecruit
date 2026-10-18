// Scores scripts/gate/parity.json through lib/gate.ts and compares with the Python
// numbers written by train_gate.py. Any mismatch means the two featurizers diverged.
//   npx tsx scripts/gate/check_parity.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gateScore } from '../../lib/gate'

type Row = { text: string; author_headline: string | null; author_linkedin_url: string | null; post_url: string | null; expected: number }
const rows: Row[] = JSON.parse(readFileSync(resolve(__dirname, 'parity.json'), 'utf8'))
let bad = 0
for (const r of rows) {
  const got = gateScore({ text: r.text, authorHeadline: r.author_headline, authorLinkedinUrl: r.author_linkedin_url, postUrl: r.post_url })
  const ok = got !== null && Math.abs(got - r.expected) < 1e-5
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} expected ${r.expected.toFixed(6)} got ${got === null ? 'null' : got.toFixed(6)}  ${r.text.slice(0, 60).replace(/\s+/g, ' ')}`)
}
if (bad) { console.error(`${bad} mismatches — featurizers have diverged; do not ship these weights`); process.exit(1) }
console.log('parity ok')
