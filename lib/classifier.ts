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
}

const SECTOR_CONTEXT: Record<string, string> = {
  finance: 'finance and investment (banking, hedge funds, PE, asset management, quant, trading, credit, fintech)',
  tech: 'technology (software engineering, product, data, AI/ML, devops, infrastructure, startups)',
  legal: 'legal (law firms, in-house counsel, compliance, litigation, corporate law, paralegal)',
  marketing: 'marketing (growth, performance, content, brand, SEO, product marketing, CMO, digital)',
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
  }

  const sectorContext = SECTOR_CONTEXT[sector] || sector

  const prompt = `You are classifying LinkedIn posts to find job openings in ${sectorContext}.

Cast a WIDE net — include any post where someone is hiring for a specific open role, including.
- Core ${sector} roles
- Support roles at ${sector} firms (ops, EA, HR, legal, tech, finance)
- Recruiter posts listing specific open positions with requirements
- "HOT JOBS" style lists — extract the most senior/interesting one
- Reposts sharing a job opportunity

Only exclude:
- General career advice with no specific opening
- Thought leadership / articles
- Posts asking for job lists or resources
- Self-promotion with no specific open role

Author headline: ${authorHeadline || 'Unknown'}

Post:
---
${rawText.slice(0, 2500)}
---

Reply ONLY with JSON, no markdown, no backticks:
{"isJob":true,"title":"job title","company":"company or null","location":"primary city only (e.g. London, New York, Remote) — do NOT list multiple cities","seniority":"one of: Intern/Junior/Mid/Senior/VP/Director/MD/Partner/C-Suite/Unknown","salary":"range or null","apply_method":"DM/email/link/etc or null","summary":"1-2 sentences about the role","tags":["tag1","tag2"]}

Or if not a job: {"isJob":false,"title":"","company":null,"location":null,"seniority":"Unknown","salary":null,"apply_method":null,"summary":"","tags":[]}`

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
        model: 'claude-sonnet-4-20250514',
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
    console.log(`[classifier] [${sector}] isJob=${parsed.isJob} title="${parsed.title}"`)
    return parsed

  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      console.error('[classifier] Timed out')
    } else {
      console.error('[classifier] Error:', e)
    }
    return FALLBACK
  }
}
