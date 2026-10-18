// Rules that run before the classifier. Everything here is a pattern we have
// watched the model reject, or rate 'low', hundreds of times: job boards
// re-syndicating job boards, influencer repost templates, and roles in markets
// we don't serve. None of it needs a language model to recognise, and every
// post stopped here is one we don't pay for.
//
// Each rule returns a reason starting with "prefilter:" so classifier_log and
// classified_posts show exactly which rule fired and how much it saved.

export type PrefilterVerdict = { label: 'bad' | 'off-market'; reason: string }

// Account slugs (the part after /in/ or /company/) that are aggregators, not people.
const AGGREGATOR_SLUGS: RegExp[] = [
  /(^|-)jobs?(-|$)/,          // fully-remote-jobs-usa, cheltenham-jobs-gloucestershire, ontario-jobs-canada
  /job-?board/,               // cybersec-job-board
  /hiring-?updates?/,         // daily-hiring-updatess
  /^remote(wlb|yeah|-jobs|-work|-ok|ive)/,
  /jobsrmine|openjobshq|himalayasapp|hireincrypto|kickstart-remote|hireme-cm|openaibuzz|jobleads|jobgether|jobot/,
  /freelance-translators-and-interpreters/, // "Caught in a LinkedIn hiring post" account
]

// Whole-post templates that only aggregators produce.
const AGGREGATOR_TEXT: RegExp[] = [
  /^\s*#hiring\b[^\n]{0,160}apply here:\s*https?:\/\/lnkd\.in/i,   // "#hiring X Apply here: lnkd.in/…"
  /jobsrmine\.com/i,
  /\[hiring\]\s*new\s*#remote\s*jobs/i,                              // remotewlb template
  /follow me\b[^.]{0,80}(job alert|every new opening|fresh openings|openings at)/i,
  /daily job alert/i,
  /caught in a linkedin hiring post/i,
  /repost to help a job ?seeker/i,
  /job card details:\s*title:/i,                                      // careers-page syndication
  /^\s*(remote job alert!|work from anywhere!)\s/i,                   // remoteyeah template
]

// Market signals the location field misses: currency, hours, residency rules.
const OFF_MARKET_TEXT: Array<[RegExp, string]> = [
  [/[₹₦]\s?\d/u, 'currency'],
  [/\b\d+(\.\d+)?\s*(lpa|lakhs?)\b/i, 'salary in lakhs'],
  [/\b(pkr|inr|ngn|kes|egp)\s?\d/i, 'currency'],
  [/\b\d{1,2}(:\d{2})?\s*(am|pm)?\s*[–-]\s*\d{1,2}(:\d{2})?\s*(am|pm)?\s*ist\b/i, 'IST hours'],
  [/\b(india|pakistan|bangladesh|sri lanka|nigeria|kenya|ghana|egypt|philippines|indonesia|vietnam)[- ]based\b/i, 'country-based'],
  [/\b(pan[- ]india|work from home.*\bfreshers?\b|\bfreshers?\b.*work from home)/i, 'freshers / pan-India'],
  [/\b(candidates?|applicants?)\s+(from|in|based in|located in)\s+(india|pakistan|nigeria|kenya|egypt|philippines)\b/i, 'residency rule'],
  [/\b(c2c|corp[- ]to[- ]corp|bench sales|h1b transfer|opt\/cpt)\b/i, 'US contract-staffing (C2C)'],
]

// "50 openings, $80–150/hr, no experience needed, help train AI" gigs.
const AI_TRAINING_GIG = [
  /\b(train(ing)?|teach(ing)?|evaluat(e|ing))\b[^.]{0,60}\b(ai|llm)s?\b[^.]{0,40}\b(models?|systems?|outputs?)\b/i,
  /\bai training\b/i,
  /\b(micro1|mercor|outlier\.ai|dataannotation)\b/i,
]
const MANY_OPENINGS = /\b\d{2,}\s*openings?\b/i

// Author slug from a profile URL (/in/x, /company/x) or from the post URL itself
// (/posts/<slug>_<headline>-activity-…), whichever we have.
function slugOf(url: string | null | undefined): string {
  const u = url || ''
  const m = u.match(/linkedin\.com\/(?:in|company|school)\/([^/?#]+)/i) || u.match(/linkedin\.com\/posts\/([^_/?#]+)_/i)
  return (m?.[1] || '').toLowerCase()
}

export function prefilterPost(post: {
  text: string
  postUrl?: string
  authorLinkedinUrl: string | null
  authorName: string | null
  authorHeadline: string | null
}): PrefilterVerdict | null {
  const text = post.text || ''
  const slug = slugOf(post.authorLinkedinUrl) || slugOf(post.postUrl)

  if (slug && AGGREGATOR_SLUGS.some((r) => r.test(slug))) {
    return { label: 'bad', reason: `prefilter: aggregator author (${slug})` }
  }
  const tpl = AGGREGATOR_TEXT.find((r) => r.test(text))
  if (tpl) return { label: 'bad', reason: `prefilter: aggregator template (${tpl.source.slice(0, 40)})` }

  if (AI_TRAINING_GIG.some((r) => r.test(text)) && (MANY_OPENINGS.test(text) || /\$\d+\s*[–-]\s*\$?\d+\s*\/\s*h(ou)?r/i.test(text))) {
    return { label: 'bad', reason: 'prefilter: ai-training gig' }
  }

  const market = OFF_MARKET_TEXT.find(([r]) => r.test(text))
  if (market) return { label: 'off-market', reason: `prefilter: ${market[1]}` }

  return null
}
