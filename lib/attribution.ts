// Client-side helpers: who is this visitor, what device are they on, and how did they arrive?
// First-touch attribution is stored once in localStorage and sent with the checkout request.

export type Attribution = {
  referrer: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  landing_path: string | null
  first_seen: string
}

const VID_KEY = 'bcj_vid'
const ATTR_KEY = 'bcj_attr'

export function getVisitorId(): string | null {
  try {
    let id = localStorage.getItem(VID_KEY)
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(VID_KEY, id) }
    return id
  } catch { return null }
}

export function deviceType(): 'mobile' | 'tablet' | 'desktop' {
  try {
    const ua = navigator.userAgent
    const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
    if (/iPad|Tablet/i.test(ua) || iPadOS || (/Android/i.test(ua) && !/Mobi/i.test(ua))) return 'tablet'
    if (/Mobi|iPhone|Android/i.test(ua) || window.innerWidth < 768) return 'mobile'
  } catch { /* fall through */ }
  return 'desktop'
}

// Call on every page load; only the first call per browser stores anything.
export function captureAttribution(): void {
  try {
    if (localStorage.getItem(ATTR_KEY)) return
    const q = new URLSearchParams(window.location.search)
    const ref = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : null
    const a: Attribution = {
      referrer: ref ? ref.slice(0, 300) : null,
      utm_source: q.get('utm_source'),
      utm_medium: q.get('utm_medium'),
      utm_campaign: q.get('utm_campaign'),
      landing_path: window.location.pathname,
      first_seen: new Date().toISOString(),
    }
    localStorage.setItem(ATTR_KEY, JSON.stringify(a))
  } catch { /* storage blocked: attribution is best-effort */ }
}

export function getAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem(ATTR_KEY)
    return raw ? (JSON.parse(raw) as Attribution) : null
  } catch { return null }
}
