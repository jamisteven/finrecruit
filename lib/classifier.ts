import { logClassification, type ClassifyContext } from './classifierLog'

export type ClassifiedJob = {
  isJob: boolean
  // why a post was turned down — stored so we can audit what we discard
  reason?: string
  title: string
  company: string | null
  location: string | null
  // ISO-3166 alpha-2 of where the candidate must be; for remote roles, the country
  // the role is restricted to. null when genuinely worldwide or unknowable.
  country?: string | null
  seniority: string
  salary: string | null
  apply_method: string | null
  summary: string
  tags: string[]
  // high = a named person or firm hiring for a role you could act on directly.
  // low = platform funnel, roundup, or a poster with no plausible link to the role.
  quality: 'high' | 'medium' | 'low'
  // direct = the company is hiring for itself (its own recruiter or hiring manager posting);
  // agency = a recruitment agency, staffing firm or consultancy placing someone at a client.
  employer?: 'direct' | 'agency' | null
  // Claude's own judgment of which sector the ROLE belongs to (may differ from
  // the query sector that found the post). 'other' = real job, but off-vertical.
  sector: string
}

const SECTOR_CONTEXT: Record<string, string> = {
  finance: 'finance and investment (banking, hedge funds, PE, asset management, quant, trading, credit, fintech)',
  tech: 'technology (software engineering, product, data, AI/ML, devops, infrastructure, startups)',
  legal: 'legal (law firms, in-house counsel, compliance, litigation, corporate law, paralegal)',
  marketing: 'marketing (growth, performance, content, brand, SEO, product marketing, CMO, digital)',
  realestate: 'real estate (property management, leasing, brokerage, real estate investment, facilities)',
  sales: 'sales (account executives, business development, sales leadership)',
  hr: 'HR and talent (recruiting, people operations, HR business partners)',
  biotech: 'biotech and pharma (R&D scientists, clinical operations and research, regulatory affairs, medical affairs and MSLs, drug discovery and development, CMC/GMP/quality, pharmacovigilance, market access, CROs and life-sciences tools)',
}

// Classify-and-extract on a short post is Haiku-grade work at roughly a third of
// Sonnet's price. CLASSIFIER_MODEL in Vercel flips it back without a deploy.
export const CLASSIFIER_MODEL = process.env.CLASSIFIER_MODEL || 'claude-haiku-4-5'

export async function classifyPost(
  rawText: string,
  authorHeadline: string | null,
  sector = 'finance',
  // When given, the call is written to classifier_log with the full post and the
  // full verdict — the training set for doing this without an API call.
  ctx?: ClassifyContext,
): Promise<ClassifiedJob> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  const started = Date.now()
  let rawResponse: string | null = null
  const log = (out: ClassifiedJob) => {
    if (ctx) logClassification(ctx, rawText, sector, CLASSIFIER_MODEL, out, Date.now() - started, rawResponse)
    return out
  }

  const FALLBACK: ClassifiedJob = {
    isJob: false, reason: 'classifier failed', title: '', company: null, location: null, country: null,
    seniority: 'Unknown', salary: null, apply_method: null, summary: '', tags: [],
    sector: 'other', quality: 'low',
  }

  const sectorContext = SECTOR_CONTEXT[sector] || sector

  const prompt = `You are classifying LinkedIn posts to find job openings. The search that found this post was aimed at ${sectorContext}, but that is only a hint about where it came from.

IMPORTANT: isJob is about whether this is ONE specific open role that a person could apply for — in ANY sector, ANY industry, ANY country. Never set isJob false because the role is outside ${sector}; record the fit in the "sector" field instead (use "other" if it fits none of ours). Location and country are also recorded, never used to reject.

Cast a WIDE net — include any post where someone is hiring for a specific open role, including.
Posts may be in English OR German (including Swiss German). For German posts, key hiring phrases include: 'wir suchen', 'gesucht', 'Stelle frei', 'Stellenangebot', 'einstellen', 'wir stellen ein', 'jetzt bewerben', 'zur Verstärkung'. Extract all fields in English regardless of the post language.
- Core ${sector} roles
- Recruiter posts listing specific open positions with requirements
- Reposts sharing a job opportunity

Only exclude:
- General career advice with no specific opening
- Thought leadership / articles
- Posts asking for job lists or resources
- Self-promotion with no specific open role
- Roundup posts listing several different roles (set isJob false — one post, many jobs, cannot be stored correctly)
- Posts whose main purpose is driving signups to a jobs platform or talent network

Also decide who the employer is: "direct" when the company named is hiring for itself (an in-house recruiter, a hiring manager, a founder), "agency" when the poster is a recruitment agency, staffing firm, IT consultancy or body shop placing someone at a client — signs are "our client", "end client", "implementation partner", W2/C2C/corp-to-corp, a fixed-length contract ("6-month contract", "contract to hire"), "must be local", a resume sent to a personal email, or a poster whose headline is recruiter/staffing with no employer named. A retained search firm hiring for a named company is still "agency".

Also rate quality, judged on whether a jobseeker could act on this directly:
- "high": a named individual or identifiable firm hiring for a specific role, with a
  direct way to reach them (their DM, their company email, their own careers link).
- "medium": a real opening but thin — no company named, vague detail, or an
  agency posting without naming the client.
- "low": the post funnels to a third-party jobs platform rather than the employer;
  the poster has no evident connection to the role's market or employer; the post is
  template-generated filler; or the named "company" is really the posting platform.

INDEPENDENTLY of whether it is a job, decide which sector the ROLE itself belongs to,
judged by the role's function — NOT the employer's industry:
- A software engineer at a bank is "tech". An accountant at a tech startup is "finance".
- A medical coder, nurse, travel sales manager, or charity program officer is "other".
- "biotech" is the life-sciences industry's own functions: scientists and R&D, clinical operations/research/data, regulatory and medical affairs, MSLs, drug discovery and development, CMC/GMP/quality, pharmacovigilance, market access, and sales or BD of drugs, devices, diagnostics or lab tools. A software engineer or accountant at a pharma company is still "tech" or "finance"; a hospital nurse or physician is "other".
- Use "other" whenever the role does not clearly fit finance, tech, legal, marketing, realestate, sales, hr, or biotech.

Author headline: ${authorHeadline || 'Unknown'}

Post:
---
${rawText.slice(0, 2500)}
---

Reply ONLY with JSON, no markdown, no backticks:
{"isJob":true,"title":"job title","company":"company or null","location":"primary city only (e.g. London, New York, Mumbai, Remote) — do NOT list multiple cities. Always name the real city, including Indian ones. Infer from the post, company or context where possible; null only if genuinely unknowable","country":"ISO-3166 alpha-2 code (US, GB, CH, DE, IN …) of where the candidate must be located. For remote roles, the country the role is restricted to (e.g. 'Remote, India-based' → IN; 'Egypt-based candidates only' → EG; IST working hours → IN); null only if genuinely open worldwide","seniority":"one of: Intern/Junior/Mid/Senior/VP/Director/MD/Partner/C-Suite/Unknown","salary":"range or null","apply_method":"DM/email/link/etc or null","summary":"1-2 sentences about the role","tags":["tag1","tag2"],"sector":"one of: finance/tech/legal/marketing/realestate/sales/hr/biotech/other","quality":"one of: high/medium/low","employer":"direct or agency"}

Or if not a job: {"isJob":false,"reason":"a short phrase saying why — e.g. 'candidate seeking work', 'career advice', 'roundup of several roles', 'company promo', 'already filled' (NEVER 'wrong sector' or 'wrong location' — those are not reasons)","title":"","company":null,"location":null,"country":null,"seniority":"Unknown","salary":null,"apply_method":null,"summary":"","tags":[],"sector":"other","quality":"low"}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      console.error(`[classifier] Anthropic API error ${res.status}`)
      return log({ ...FALLBACK, reason: `classifier failed: HTTP ${res.status}` })
    }

    const data = await res.json()
    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text || '{}'
    rawResponse = text
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    const out: ClassifiedJob = {
      ...FALLBACK,
      ...parsed,
      // Normalize; fall back to the query's sector if the model omitted it
      sector: typeof parsed.sector === 'string' && parsed.sector ? parsed.sector.toLowerCase().trim() : sector,
    }
    console.log(`[classifier] [query:${sector}] isJob=${out.isJob}${out.isJob ? '' : ` (${out.reason ?? 'no reason'})`} quality=${out.quality} sector=${out.sector} title="${out.title}"`)
    return log(out)

  } catch (e) {
    const timedOut = (e as Error).name === 'AbortError'
    if (timedOut) console.error('[classifier] Timed out')
    else console.error('[classifier] Error:', e)
    return log({ ...FALLBACK, reason: timedOut ? 'classifier failed: timeout' : 'classifier failed: error' })
  }
}
