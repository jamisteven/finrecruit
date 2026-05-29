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

export async function classifyPost(rawText: string, authorHeadline: string | null): Promise<ClassifiedJob> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const FALLBACK: ClassifiedJob = {
    isJob: false, title: '', company: null, location: null,
    seniority: 'Unknown', salary: null, apply_method: null, summary: '', tags: [],
  }

  const prompt = `You are classifying LinkedIn posts to find job openings. Cast a WIDE net — include any post where someone is hiring or recruiting for a specific open role.

Include these as jobs:
- Finance roles (analyst, trader, PM, quant, banker, etc.)
- Support roles at finance firms (EA, ops, compliance, legal, tech, HR)
- Any role where a recruiter mentions a specific open position
- Posts with salary ranges and requirements
- "HOT JOBS" style lists
- Reposts of job opportunities

Only exclude:
- General career advice with no specific opening
- Articles/thought leadership
- Posts asking for internship lists or resources
- Self-promotion with no specific job

Author headline: ${authorHeadline || 'Unknown'}

Post:
---
${rawText.slice(0, 2500)}
---

If multiple jobs listed, extract the most senior/interesting one.

Reply ONLY with JSON, no markdown:
{"isJob":true,"title":"job title","company":"company or null","location":"city or Remote or null","seniority":"one of: Intern/Junior/Mid/Senior/VP/Director/MD/Partner/C-Suite/Unknown","salary":"range or null","apply_method":"DM/email/link/etc or null","summary":"1-2 sentences about the role","tags":["tag1","tag2"]}

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
      const errText = await res.text()
      console.error(`[classifier] Anthropic API error ${res.status}: ${errText}`)
      return FALLBACK
    }

    const data = await res.json()
    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text || '{}'
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    console.log(`[classifier] isJob=${parsed.isJob} title="${parsed.title}"`)
    return parsed

  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      console.error('[classifier] Timed out after 15s')
    } else {
      console.error('[classifier] Error:', e)
    }
    return FALLBACK
  }
}
