// The one list of job sectors. The classifier may answer any of these; anything else is 'other'.
// Add a sector here, in the classifier prompt (lib/classifier.ts) and in the sidebar colours
// (app/page.tsx --sec-<id>), then backfill existing rows (supabase/…-sector-backfill.sql).
export const JOB_SECTORS = ['finance', 'tech', 'legal', 'marketing', 'realestate', 'sales', 'hr', 'biotech'] as const
export type JobSector = typeof JOB_SECTORS[number]

export const SECTOR_LABELS: Record<string, string> = {
  finance: 'Finance', tech: 'Tech', legal: 'Legal', marketing: 'Marketing',
  realestate: 'Real Estate', sales: 'Sales', hr: 'HR & Talent', biotech: 'Biotech & Pharma',
}
export const sectorLabel = (s?: string | null) => (s && SECTOR_LABELS[s]) || 'Other'

// The classifier's answer, kept when it is one of ours; 'other' is a real job outside our verticals.
export const normalizeSector = (s: unknown): string =>
  typeof s === 'string' && (JOB_SECTORS as readonly string[]).includes(s) ? s : 'other'
