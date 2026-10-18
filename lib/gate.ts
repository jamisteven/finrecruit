// The job-post gate: a logistic-regression classifier over hashed text features,
// trained by scripts/gate/train_gate.py on classifier_log, run here with no
// dependencies and no API call.
//
// This featurizer MUST stay byte-for-byte equivalent to scripts/gate/features.py.
// Change one, change the other, bump the version, and run check_parity.ts.
//
// GATE_MODE (Vercel env):
//   off     – never scored (default)
//   shadow  – scored and written to classifier_log.gate_score; the LLM still decides
//   on      – posts scoring below the LOW threshold are discarded without an LLM call;
//             everything else still goes to the LLM for the verdict and the extraction

import weights from './gate-weights.json'

export const FEATURIZER_VERSION = 'v1'
const N_BUCKETS = 1 << 20
const MAX_TEXT_CHARS = 3000
const MAX_TOKEN_LEN = 30

const URL_RX = /https?:\/\/\S+/g
const TOKEN_RX = /[\p{L}\p{N}]+/gu
const SLUG_RX = /linkedin\.com\/(?:in|company|school)\/([^/?#]+)|linkedin\.com\/posts\/([^_/?#]+)_/i
const FOLLOWERS_RX = /^\s*[\d.,]+\s*followers?\s*$/i

export type GateInput = {
  text: string
  authorHeadline: string | null
  authorLinkedinUrl: string | null
  postUrl: string | null
}

type Weights = {
  featurizer: string
  n_buckets: number
  thresholds: { low: number; high: number }
  bias: number
  idx: number[]
  idf: number[]
  w: number[]
}

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  // UTF-8 bytes, same as Python's s.encode('utf-8')
  const bytes = new TextEncoder().encode(s)
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const bucket = (f: string) => fnv1a32(f) % N_BUCKETS

function logBucket(n: number): number {
  return n <= 0 ? 0 : Math.min(12, Math.floor(Math.log2(n)) + 1)
}

function emojiCount(text: string): number {
  let n = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if ((cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)) n++
  }
  return n
}

function slugOf(url: string | null): string {
  const m = (url || '').match(SLUG_RX)
  return ((m?.[1] || m?.[2]) ?? '').toLowerCase()
}

export function featureStrings(input: GateInput): string[] {
  const raw = input.text || ''
  const feats: string[] = []

  const links = (raw.match(URL_RX) || []).length
  const hashtags = (raw.match(/#/g) || []).length
  const lines = (raw.match(/\n/g) || []).length
  feats.push(`m:len:${logBucket(raw.length)}`)
  feats.push(`m:links:${Math.min(links, 5)}`)
  feats.push(`m:tags:${logBucket(hashtags)}`)
  feats.push(`m:lines:${logBucket(lines)}`)
  feats.push(`m:emoji:${logBucket(emojiCount(raw))}`)

  let t = raw.slice(0, MAX_TEXT_CHARS).normalize('NFKC').toLowerCase()
  t = t.replace(URL_RX, ' urltoken ')
  t = t.replace(/\s+/g, ' ').trim()

  const toks = (t.match(TOKEN_RX) || []).filter((w) => w.length <= MAX_TOKEN_LEN)
  for (const w of toks) feats.push('w:' + w)
  for (let i = 0; i + 1 < toks.length; i++) feats.push('b:' + toks[i] + '_' + toks[i + 1])

  // char n-grams over code points (Python indexes str by code point, not UTF-16 unit)
  const cps = Array.from(t)
  for (const n of [3, 4, 5]) {
    for (let i = 0; i + n <= cps.length; i++) feats.push('c:' + cps.slice(i, i + n).join(''))
  }

  const hl = (input.authorHeadline || '').normalize('NFKC').toLowerCase()
  if (FOLLOWERS_RX.test(hl)) feats.push('m:company_page')
  else for (const w of (hl.match(TOKEN_RX) || []).slice(0, 40)) feats.push('h:' + w)

  const slug = slugOf(input.authorLinkedinUrl) || slugOf(input.postUrl)
  if (slug) for (const p of slug.split('-')) if (p) feats.push('s:' + p)

  return feats
}

let table: { idf: Map<number, number>; w: Map<number, number> } | null = null
function load(): Weights | null {
  const W = weights as unknown as Weights
  if (!W || !Array.isArray(W.idx) || W.idx.length === 0) return null
  if (W.featurizer !== FEATURIZER_VERSION || W.n_buckets !== N_BUCKETS) {
    console.error(`[gate] weights are for featurizer ${W.featurizer}/${W.n_buckets}, code is ${FEATURIZER_VERSION}/${N_BUCKETS}; gate disabled`)
    return null
  }
  if (!table) {
    table = { idf: new Map(), w: new Map() }
    for (let i = 0; i < W.idx.length; i++) {
      table.idf.set(W.idx[i], W.idf[i])
      table.w.set(W.idx[i], W.w[i])
    }
  }
  return W
}

/** Probability that the post is a job we'd show, or null if no usable weights are shipped. */
export function gateScore(input: GateInput): number | null {
  const W = load()
  if (!W || !table) return null
  const counts = new Map<number, number>()
  for (const f of featureStrings(input)) {
    const b = bucket(f)
    counts.set(b, (counts.get(b) || 0) + 1)
  }
  if (counts.size === 0) return null
  const norm = Math.sqrt(counts.size)
  let z = W.bias
  for (const [b, n] of counts) {
    const idf = table.idf.get(b)
    if (idf === undefined) continue
    const w = table.w.get(b)
    if (w === undefined) continue
    z += ((1 + Math.log(n)) * idf / norm) * w
  }
  return 1 / (1 + Math.exp(-z))
}

export function gateThresholds(): { low: number; high: number } | null {
  return load()?.thresholds ?? null
}

export type GateMode = 'off' | 'shadow' | 'on'
export function gateMode(): GateMode {
  const m = (process.env.GATE_MODE || 'off').toLowerCase()
  return m === 'on' || m === 'shadow' ? m : 'off'
}

/**
 * Score a post under the current mode. `discard` is only ever true in mode 'on',
 * and only when the score is below the trained LOW threshold.
 */
export function runGate(input: GateInput): { score: number | null; discard: boolean } {
  const mode = gateMode()
  if (mode === 'off') return { score: null, discard: false }
  const score = gateScore(input)
  const th = gateThresholds()
  if (score === null || !th) return { score: null, discard: false }
  return { score, discard: mode === 'on' && score < th.low }
}
