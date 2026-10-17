// Recognisable employers for the home-page strip, keyed by the names recruiters
// actually write in their posts. Only names on this list are shown, so staffing
// agencies and one-off shops never dilute it, and the strip is always built
// from what is really in the feed (the API intersects this with live counts).
//
// `domain` is what the logo service is asked for; the name is the fallback.

export type Employer = { name: string; domain: string; aliases?: string[] }

export const EMPLOYERS: Employer[] = [
  { name: 'Amazon', domain: 'amazon.com', aliases: ['amazon web services (aws)', 'amazon web services', 'aws'] },
  { name: 'Apple', domain: 'apple.com' },
  { name: 'Microsoft', domain: 'microsoft.com' },
  { name: 'Google', domain: 'google.com', aliases: ['alphabet'] },
  { name: 'Meta', domain: 'meta.com' },
  { name: 'Nvidia', domain: 'nvidia.com' },
  { name: 'Salesforce', domain: 'salesforce.com' },
  { name: 'Tesla', domain: 'tesla.com' },
  { name: 'Anthropic', domain: 'anthropic.com' },
  { name: 'Applied Materials', domain: 'appliedmaterials.com' },
  { name: 'Oracle', domain: 'oracle.com' },
  { name: 'IBM', domain: 'ibm.com' },
  { name: 'Intel', domain: 'intel.com' },
  { name: 'SAP', domain: 'sap.com' },
  { name: 'Siemens', domain: 'siemens.com' },
  { name: 'Stripe', domain: 'stripe.com' },
  { name: 'Spotify', domain: 'spotify.com' },
  { name: 'CDW', domain: 'cdw.com' },
  { name: 'Santander', domain: 'santander.com' },
  { name: 'JPMorgan Chase', domain: 'jpmorganchase.com', aliases: ['jpmorganchase', 'jpmorgan', 'j.p. morgan', 'jp morgan'] },
  { name: 'Goldman Sachs', domain: 'goldmansachs.com' },
  { name: 'Morgan Stanley', domain: 'morganstanley.com' },
  { name: 'BNY', domain: 'bny.com', aliases: ['bny mellon'] },
  { name: 'Wells Fargo', domain: 'wellsfargo.com' },
  { name: 'Citi', domain: 'citi.com', aliases: ['citigroup', 'citibank'] },
  { name: 'HSBC', domain: 'hsbc.com' },
  { name: 'Barclays', domain: 'barclays.com' },
  { name: 'UBS', domain: 'ubs.com' },
  { name: 'Zurich', domain: 'zurich.com', aliases: ['zurich insurance'] },
  { name: 'Allianz', domain: 'allianz.com' },
  { name: 'AXA', domain: 'axa.com' },
  { name: 'USAA', domain: 'usaa.com' },
  { name: 'Capital One', domain: 'capitalone.com' },
  { name: 'BlackRock', domain: 'blackrock.com' },
  { name: 'Fidelity', domain: 'fidelity.com', aliases: ['fidelity investments'] },
  { name: 'Northern Trust', domain: 'northerntrust.com' },
  { name: 'State Street', domain: 'statestreet.com' },
  { name: 'Visa', domain: 'visa.com' },
  { name: 'Mastercard', domain: 'mastercard.com' },
  { name: 'American Express', domain: 'americanexpress.com', aliases: ['amex'] },
  { name: 'PayPal', domain: 'paypal.com' },
  { name: 'Bloomberg', domain: 'bloomberg.com' },
  { name: 'KPMG', domain: 'kpmg.com' },
  { name: 'EY', domain: 'ey.com', aliases: ['ernst & young'] },
  { name: 'Deloitte', domain: 'deloitte.com' },
  { name: 'PwC', domain: 'pwc.com' },
  { name: 'Forvis Mazars', domain: 'forvismazars.com' },
  { name: 'Eide Bailly', domain: 'eidebailly.com' },
  { name: 'McKinsey', domain: 'mckinsey.com', aliases: ['mckinsey & company'] },
  { name: 'BCG', domain: 'bcg.com', aliases: ['boston consulting group'] },
  { name: 'Bain', domain: 'bain.com', aliases: ['bain & company'] },
  { name: 'Accenture', domain: 'accenture.com', aliases: ['accenture federal services'] },
  { name: 'BAE Systems', domain: 'baesystems.com' },
  { name: 'Northrop Grumman', domain: 'northropgrumman.com' },
  { name: 'Boeing', domain: 'boeing.com' },
  { name: 'CERN', domain: 'home.cern' },
  { name: 'Roche', domain: 'roche.com' },
  { name: 'Novartis', domain: 'novartis.com' },
  { name: 'Nestlé', domain: 'nestle.com', aliases: ['nestle'] },
  { name: 'Springer Nature', domain: 'springernature.com' },
  { name: 'Cushman & Wakefield', domain: 'cushmanwakefield.com' },
  { name: 'Marriott', domain: 'marriott.com', aliases: ['marriott international'] },
  { name: 'Four Seasons', domain: 'fourseasons.com' },
  { name: 'Intuit', domain: 'intuit.com' },
  { name: 'Truist', domain: 'truist.com' },
]

const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()

const INDEX: Map<string, Employer> = new Map()
for (const e of EMPLOYERS) {
  INDEX.set(norm(e.name), e)
  for (const a of e.aliases ?? []) INDEX.set(norm(a), e)
}

/** The employer a recruiter's company string refers to, if it is one we show. */
export function matchEmployer(company: string | null | undefined): Employer | null {
  if (!company) return null
  return INDEX.get(norm(company)) ?? null
}
