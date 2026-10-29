// Revenue trajectory from weekly acquisition and its growth rate. Pure functions so the maths can be tested.
//
// Every paying member is counted as a fixed monthly value for 13 weeks (a 90-day pass is exactly that; a $15 subscriber
// who renews is worth more, so this is conservative). Renewals and rebuys are not modelled: none have happened yet.

export const LIFE_WEEKS = 13

/** Rolling 7-day totals ending on the last day of `daily`, oldest first (so the last entry is "the last 7 days"). */
export function weeklyCohorts(daily: number[], weeks = LIFE_WEEKS): number[] {
  const out: number[] = []
  for (let k = weeks - 1; k >= 0; k--) {
    const end = daily.length - 7 * k           // exclusive
    const start = Math.max(0, end - 7)
    out.push(end <= 0 ? 0 : daily.slice(start, end).reduce((s, v) => s + v, 0))
  }
  return out
}

/** Growth per week measured over the last three windows (geometric mean of the two ratios), clamped to something sane. */
export function measuredGrowth(cohorts: number[]): number {
  const n = cohorts.length
  const a = cohorts[n - 3] ?? 0, c = cohorts[n - 1] ?? 0
  if (c <= 0) return 1
  const g = Math.sqrt(c / Math.max(a, 1))
  return Math.min(2, Math.max(0.7, g))
}

export type Step = { week: number; newPerWeek: number; mrr: number }

/**
 * week 0 is now. Each later week's new members = last week's × (1 + (g - 1) × (1 - fade)^week), so `fade` is how fast
 * the growth rate itself fades (0 = the same rate forever, 0.3 = it loses 30% of its edge every week).
 */
export function project(cohorts: number[], g: number, fade: number, value: number, weeks = 52): Step[] {
  const live = cohorts.slice(-LIFE_WEEKS)
  const steps: Step[] = [{ week: 0, newPerWeek: live[live.length - 1] ?? 0, mrr: value * live.reduce((s, v) => s + v, 0) }]
  for (let t = 1; t <= weeks; t++) {
    const prev = live[live.length - 1] ?? 0
    const next = prev * (1 + (g - 1) * Math.pow(1 - fade, t))
    live.push(next)
    if (live.length > LIFE_WEEKS) live.shift()
    steps.push({ week: t, newPerWeek: next, mrr: value * live.reduce((s, v) => s + v, 0) })
  }
  return steps
}

export const reaches = (steps: Step[], target: number): Step | null => steps.find((s) => s.mrr >= target) ?? null

/** Average monthly value of a new member, from recent first payments: $39 for 90 days is $13/mo, a subscription is $15. */
export function memberValue(plans: (string | null | undefined)[]): number {
  if (!plans.length) return 14
  const v = plans.map((p) => (p === 'monthly' ? 15 : 13))
  return v.reduce((s, x) => s + x, 0) / v.length
}
