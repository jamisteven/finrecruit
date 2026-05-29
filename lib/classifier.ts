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

  const prompt = `You are an expert at reading LinkedIn posts from finance recruiters and identifying job postings.

Analyze this LinkedIn post and determine if it is advertising one or more job openings in finance/investment.

Finance recruiters often use informal language like:
- "We're looking for...", "Exciting seat available", "Mandate to fill"
- "My client is hiring", "Reach out if interested", "DM me"
- "Now recruiting for...", "HOT JOBS", "actively recruiting"
- Lists of roles with salaries and requirements

Author's LinkedIn headline: ${authorHeadline || 'Unknown'}

Post text:
---
${rawText.slice(0, 2500)}
---

If the post contains MULTIPLE job listings, extract the FIRST/PRIMARY one.

Respond ONLY with a valid JSON object, no markdown, no backticks, no explanation:
{"isJob":true,"title":"exact job title","company":"company name or null","location":"city or Remote or null","seniority":"Senior","salary":"salary range or null","apply_method":"how to apply or null","summary":"1-2 sentence summary of the role","tags":["relevant","tags"]}

If NOT a job post, respond ONLY with: {"isJob":false,"title":"","company":null,"location":null,"seniority":"Unknown","salary":null,"apply_method":null,"summary":"","tags":[]}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`[classifier] Anthropic API error ${res.status}: ${errText}`)
    throw new Error(`Anthropic API error: ${res.status}`)
  }

  const data = await res.json()
  const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text || '{}'

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch (e) {
    console.error('[classifier] JSON parse failed:', text, e)
    return {
      isJob: false,
      title: '',
      company: null,
      location: null,
      seniority: 'Unknown',
      salary: null,
      apply_method: null,
      summary: '',
      tags: [],
    }
  }
}
