// Turns a recruiter's original post into lines of runs, with everything that would identify or reach
// the person marked redacted. The snapshot image draws redacted runs as solid bars, so the hidden
// text never leaves the server. This is pattern matching only: no model, no cost.
//
// Redacted: email addresses (plain and "name at domain dot com"), links and bare domains, phone
// numbers, @mentions, the author's name and first name, and the tail of any "contact / email / DM /
// send your resume / to apply" line (that is where posts say how to reach the recruiter).

export type Run = { t: string; r: boolean }

const MAX_LINES = 24

export function redactPost(raw: string, authorName?: string | null): Run[][] {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) return []

  const mask: boolean[] = new Array(text.length).fill(false)
  const mark = (from: number, to: number) => { for (let i = from; i < to && i < mask.length; i++) mask[i] = true }
  const markAll = (re: RegExp, ok?: (m: string) => boolean) => {
    for (const m of text.matchAll(re)) {
      if (ok && !ok(m[0])) continue
      mark(m.index ?? 0, (m.index ?? 0) + m[0].length)
    }
  }

  // emails, plain and spelled out
  markAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)
  markAll(/[\w.+-]+\s*[[(]\s*at\s*[\])]\s*[\w.-]+/gi)
  markAll(/[\w.+-]+\s+at\s+[\w-]+\s+(?:dot|\[dot\]|\(dot\))\s+[a-z]{2,}/gi)
  // links and bare domains
  markAll(/(?:https?:\/\/|www\.)\S+/gi)
  markAll(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|ai|app|dev|jobs|careers|us|uk|ly|gl)\b(?:\/\S*)?/gi)
  // phone numbers: a digit-ish run holding at least 9 digits (so "135-155" and years survive)
  markAll(/\+?\(?\d[\d\s().-]{7,}\d/g, (m) => m.replace(/\D/g, '').length >= 9)
  // @mentions
  markAll(/@[\w.-]+/g)

  // the author's name, whole and in parts
  const parts = (authorName ?? '')
    .split(/[\s,]+/)
    .map((p) => p.replace(/[^\p{L}'-]/gu, ''))
    .filter((p) => p.length >= 3 && !/^(jr|sr|phd|mba|cpa|cfa|ii|iii)$/i.test(p))
  if (parts.length) {
    const esc = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    markAll(new RegExp(`(?<![\\p{L}])(?:${esc.join('|')})(?![\\p{L}])`, 'giu'))
  }

  // a named person after a cue ("reporting to Marcus Thompson", "ask for Dana Lee"); job titles stay
  const NOT_NAMES = /^(chief|head|senior|sr|vp|vice|director|managing|the|our|ceo|cfo|cto|coo|cro|cmo|president|manager|principal|partner|team|global|regional|general|executive)$/i
  markAll(
    /(?<=\b(?:[Rr]eport(?:s|ing)? to|[Ll]ed by|[Hh]iring [Mm]anager(?: is)?|[Aa]sk for|[Ss]peak (?:to|with)|[Cc]ontact)\s+(?:the\s+)?)[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'.-]+){1,2}/gu,
    (m) => !NOT_NAMES.test(m.split(/\s+/)[0]),
  )

  // lines that tell people how to reach the recruiter: hide everything after the cue
  const cue = /^[\s\-•*>▪►➡✉📧📩📞☎️✅👉]*(?:please\s+)?(?:contact|reach out|e-?mail|dm\b|send (?:your |an? )?(?:updated )?(?:resume|cv)|share (?:your )?(?:resume|cv)|to apply|apply (?:via|at|here|by|to|now|directly)|interested\??|connect with)/i
  let offset = 0
  for (const line of text.split('\n')) {
    const m = cue.exec(line)
    if (m) mark(offset + m[0].length, offset + line.length)
    offset += line.length + 1
  }

  // back to lines of runs
  const lines: Run[][] = []
  let pos = 0
  for (const line of text.split('\n').slice(0, MAX_LINES)) {
    const runs: Run[] = []
    let i = 0
    while (i < line.length) {
      const r = mask[pos + i]
      let j = i
      while (j < line.length && mask[pos + j] === r) j++
      runs.push({ t: line.slice(i, j), r })
      i = j
    }
    lines.push(runs)
    pos += line.length + 1
  }
  return lines
}

// "3d", "5h", "now" for the post header
export function shortAge(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (isNaN(t)) return ''
  const h = Math.max(0, Math.floor((now - t) / 3600_000))
  if (h < 1) return 'now'
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`
}
