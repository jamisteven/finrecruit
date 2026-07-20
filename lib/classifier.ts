export type ClassifiedJob = {
  isJob: boolean
  title: string
  company: string | null
  location: string | null
  seniority: string
  salary: string | null
  apply_method: string | null
  summary: string
  tags: string[]
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
}

export async function classifyPost(
  rawText: string,
  authorHeadline: string | null,
  sector = 'finance'
): Promise<ClassifiedJob> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const FALLBACK: ClassifiedJob = {
    isJob: false, title: '', company: null, location: null,
    seniority: 'Unknown', salary: null, apply_method: null, summary: '', tags: [],
    sector: 'other',
  }

  const sectorContext = SECTOR_CONTEXT[sector] || sector

  const prompt = `You are classifying LinkedIn posts to find job openings in ${sectorContext}.

Cast a WIDE net — include any post where someone is hiring for a specific open role, including.
Posts may be in English OR German (including Swiss German). For German posts, key hiring phrases include: 'wir suchen', 'gesucht', 'Stelle frei', 'Stellenangebot', 'einstellen', 'wir stellen ein', 'jetzt bewerben', 'zur Verstärkung'. Extract all fields in English regardless of the post language.
- Core ${sector} roles
- Recruiter posts listing specific open positions with requirements
- "HOT JOBS" style lists — extract the most senior/interesting one
- Reposts sharing a job opportunity

Only exclude:
- General career advice with no specific opening
- Thought leadership / articles
- Posts asking for job lists or resources
- Self-promotion with no specific open role

INDEPENDENTLY of whether it is a job, decide which sector the ROLE itself belongs to,
judged by the role's function — NOT the employer's industry:
- A software engineer at a bank is "tech". An accountant at a tech startup is "finance".
- A medical coder, nurse, travel sales manager, or charity program officer is "other".
- Use "other" whenever the role does not clearly fit finance, tech, legal, marketing, or realestate.

Author headline: ${authorHeadline || 'Unknown'}

Post:
---
${rawText.slice(0, 2500)}
---

Reply ONLY with JSON, no markdown, no backticks:
{"isJob":true,"title":"job title","company":"company or null","location":"primary city only (e.g. London, New York, Remote) — do NOT list multiple cities","seniority":"one of: Intern/Junior/Mid/Senior/VP/Director/MD/Partner/C-Suite/Unknown","salary":"range or null","apply_method":"DM/email/link/etc or null","summary":"1-2 sentences about the role","tags":["tag1","tag2"],"sector":"one of: finance/tech/legal/marketing/realestate/other"}

Or if not a job: {"isJob":false,"title":"","company":null,"location":null,"seniority":"Unknown","salary":null,"apply_method":null,"summary":"","tags":[],"sector":"other"}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      console.error(`[classifier] Anthropic API error ${res.status}`)
      return FALLBACK
    }

    const data = await res.json()
    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text || '{}'
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    const out: ClassifiedJob = {
      ...FALLBACK,
      ...parsed,
      // Normalize; fall back to the query's sector if the model omitted it
      sector: typeof parsed.sector === 'string' && parsed.sector ? parsed.sector.toLowerCase().trim() : sector,
    }
    console.log(`[classifier] [query:${sector}] isJob=${out.isJob} sector=${out.sector} title="${out.title}"`)
    return out

  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      console.error('[classifier] Timed out')
    } else {
      console.error('[classifier] Error:', e)
    }
    return FALLBACK
  }
}
