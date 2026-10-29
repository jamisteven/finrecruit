'use client'

import { useMemo, useState } from 'react'
import { Chart, ChartCard, COLORS, Tile, fmtUsd, type ChartRow } from './charts'
import { LIFE_WEEKS, measuredGrowth, memberValue, project, reaches, weeklyCohorts } from '@/lib/trajectory'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any

const short = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const long = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/**
 * Where acquisition is heading. The growth rate starts at what the last three weeks measured; the sliders let you ask
 * "what if it slows". No slider setting is a forecast: growth rates fade as numbers get bigger.
 */
export default function Trajectory({ G, asOf }: { G: Data; asOf: string }) {
  const daily: number[] = useMemo(() => G.days.map((r: Data) => Number(r.paid) || 0), [G])
  const cohorts = useMemo(() => weeklyCohorts(daily), [daily])
  const g0 = useMemo(() => measuredGrowth(cohorts), [cohorts])
  const value = useMemo(() => {
    const cut = new Date(asOf).getTime() - 28 * 86_400_000
    return memberValue(G.payments.filter((p: Data) => new Date(p.at).getTime() >= cut).map((p: Data) => p.plan))
  }, [G, asOf])

  const [g, setG] = useState(() => Math.round(Math.min(1.5, Math.max(1, g0)) * 100) / 100)
  const [fade, setFade] = useState(10)          // % of the growth edge lost each week
  const [target, setTarget] = useState(10000)

  const steps = useMemo(() => project(cohorts, g, fade / 100, value, 52), [cohorts, g, fade, value])
  const hit = reaches(steps, target)
  const now = new Date(asOf)
  const dateAt = (w: number) => new Date(now.getTime() + w * 7 * 86_400_000)

  // plot until the line is well past the target (an unfaded 1.5x a week explodes), at least half a year
  const stop = Math.max(26, (steps.findIndex((s) => s.mrr > 2 * target) + 1) || 53)
  const shown = steps.slice(0, Math.min(53, stop))
  const rows: ChartRow[] = shown.map((s) => ({ x: short(dateAt(s.week)), tip: `Week of ${long(dateAt(s.week))}`, v: { mrr: Math.round(s.mrr), target } }))
  const histRows: ChartRow[] = cohorts.slice(-8).map((n, i, a) => ({ x: short(dateAt(i - (a.length - 1))), tip: `7 days ending ${long(dateAt(i - (a.length - 1)))}`, v: { n, projected: 0 } }))
  const futRows: ChartRow[] = shown.slice(1, 13).map((s) => ({ x: short(dateAt(s.week)), tip: `Week of ${long(dateAt(s.week))} (projected)`, v: { n: 0, projected: Math.round(s.newPerWeek) } }))

  const c = cohorts
  const n = c.length
  const ceiling = cohorts[n - 1] * LIFE_WEEKS * value
  const needPerDay = Math.ceil(target / (value * LIFE_WEEKS * 7) * 10) / 10

  return (
    <>
      <h2 className="an-section">Trajectory</h2>
      <div className="an-card an-tj-controls">
        <label>Weekly growth <b>×{g.toFixed(2)}</b>
          <input type="range" min={1} max={1.8} step={0.01} value={g} onChange={(e) => setG(Number(e.target.value))} />
          <small>measured over the last 3 weeks: ×{g0.toFixed(2)} ({c[n - 3]} → {c[n - 2]} → {c[n - 1]} new members)</small>
        </label>
        <label>Growth fades by <b>{fade}%</b> a week
          <input type="range" min={0} max={40} step={1} value={fade} onChange={(e) => setFade(Number(e.target.value))} />
          <small>0% = the same growth rate forever, which is rarely true</small>
        </label>
        <label>Target a month <b>{fmtUsd(target)}</b>
          <input type="range" min={1000} max={50000} step={500} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
          <small>recurring-equivalent revenue</small>
        </label>
      </div>

      <div className="an-tiles">
        <Tile value={c[n - 1]} label={`new paying members, last 7 days · the 7 before: ${c[n - 2]}, and before that: ${c[n - 3]}`} />
        <Tile value={fmtUsd(steps[0].mrr)} label={`recurring-equivalent revenue now · every member in the last ${LIFE_WEEKS} weeks counted at ${fmtUsd(value)} a month`} />
        <Tile value={hit ? long(dateAt(hit.week)) : 'Not within a year'}
          label={hit ? `reaches ${fmtUsd(target)} a month at these settings, in ${hit.week} weeks` : `does not reach ${fmtUsd(target)} a month at these settings`} />
        <Tile value={hit ? `${(hit.newPerWeek / 7).toFixed(1)} a day` : `${needPerDay} a day`}
          label={hit ? 'new members a day by then (the pace the slider settings assume)' : `new members a day, held for ${LIFE_WEEKS} weeks, that ${fmtUsd(target)} would take`} />
        <Tile value={fmtUsd(ceiling)} label="where today's 7-day pace levels off if it just stays flat" />
      </div>

      <div className="an-cols">
        <ChartCard title="Projected monthly revenue" sub="Recurring-equivalent: each new member counts for 13 weeks, as a 90-day pass does. Renewals are not included."
          csv="trajectory-projection" rows={shown.map((s) => ({ week_of: dateAt(s.week).toISOString().slice(0, 10), new_members_that_week: Math.round(s.newPerWeek), monthly_revenue_equiv: Math.round(s.mrr), target }))}
          legend={[{ key: 'mrr', label: 'Projected', color: COLORS.blue }, { key: 'target', label: 'Target', color: COLORS.grey }]}>
          <Chart kind="line" label="Projected monthly revenue" rows={rows} valueFmt={fmtUsd}
            series={[{ key: 'mrr', label: 'Projected', color: COLORS.blue }, { key: 'target', label: 'Target', color: COLORS.grey }]} />
        </ChartCard>
        <ChartCard title="New paying members per week" sub="The last 8 weeks (rolling 7-day windows), then the next 12 at these settings."
          csv="trajectory-weekly-new" rows={[...histRows.map((r) => ({ week_ending: r.tip, new_members: r.v.n, projected: 0 })), ...futRows.map((r) => ({ week_ending: r.tip, new_members: 0, projected: r.v.projected }))]}
          legend={[{ key: 'n', label: 'Actual', color: COLORS.blue }, { key: 'projected', label: 'Projected', color: COLORS.pale }]}>
          <Chart kind="stacked" label="New paying members per week" rows={[...histRows, ...futRows]}
            series={[{ key: 'n', label: 'Actual', color: COLORS.blue }, { key: 'projected', label: 'Projected', color: COLORS.pale }]} />
        </ChartCard>
      </div>
      <p className="an-insight">
        This is a what-if, not a forecast. Three weeks is a short base, the growth rate almost always slows as the numbers get bigger (that is what the fade slider is for),
        and the current week is counted as the last 7 days, not the calendar week. Revenue per member is {fmtUsd(value)} a month, from the plan mix of the last 28 days
        ($39 for 90 days counts as $13, a subscription as $15). Subscribers who renew are worth more than this; nobody has reached a renewal date yet.
      </p>
    </>
  )
}
