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
  const prompt = `You are an expert at reading LinkedIn posts from finance recruiters and identifying job postings.

Analyze this LinkedIn post and determine if it is advertising one or more job openings.

Finance recruiters often use informal language like:
- "We're looking for...", "Exciting seat available", "Mandate to fill", 
- "My client is hiring", "Reach out if interested", "DM me", 
- "Now recruiting for...", "Brilliant opportunity at..."

Author's LinkedIn headline: ${authorHeadline || 'Unknown'}

Post text:
---
${rawText.slice(0, 2000)}
---

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "isJob": true or false,
  "title": "job title or null if not a job",
  "company": "company name or null",
  "location": "city/country or 'Remote' or null",
  "seniority": one of: "Intern", "Junior", "Mid", "Senior", "VP", "Director", "MD", "Partner", "C-Suite", "Unknown",
  "salary": "salary range as string or null",
  "apply_method": "how to apply: DM, email, link, etc. or null",
  "summary": "1-2 sentence plain English summary of the role",
  "tags": ["array", "of", "relevant", "tags", "e.g.", "hedge-fund", "equities", "london", "quant"]
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`)

  const data = await res.json()
  const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text || '{}'

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
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
