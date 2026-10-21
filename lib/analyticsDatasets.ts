// Names and one-line descriptions of the downloadable datasets. Kept in its own file with no imports so
// both the export route (server) and the /analytics page (browser) can use it.
export const DATASETS: Record<string, string> = {
  members: 'One row per paying member: plan, expiry, last visit, matches in the last 7 days',
  member_targets: 'One row per saved target per member, with match counts and when its query last ran',
  accounts: 'Every account (free and paying) with created time, plan, device and first payment time',
  checkouts: 'Every checkout started (paid or not): plan, entry point (src), device, UTM, landing page',
  growth_daily: 'Per day, 90 days: visitors, /offer viewers, checkouts, signups, first payments, revenue estimate',
  visit_heatmap_utc: 'Page loads by weekday and UTC hour, 90 days',
  offer_sources: 'Which link sent people to /offer and how many started checkout, 30 days',
  searches: 'Every search in the last 90 days: when, term, locations, result count',
  demand_terms: 'Top terms, locations and zero-result searches for 7/30/90 days, split all / members / free',
  demand_daily: 'Searches per day (30 days): searches, no-result searches, people',
  engagement_daily: 'Visitors, searchers and job-clickers per day, 30 days',
  engagement_summary: 'Funnel and active-time summary, 30 days',
  referrers: 'Where visits came from, 30 days',
  supply_daily: 'Posts bought, kept, repeats, rejected and cost per day, 30 days',
  job_mix_daily: 'Roles added per day split direct vs agency, 30 days',
  sectors: 'Roles added by sector, 30 days',
  ingest_runs: 'Every scrape run in the last 30 days',
  query_yield_14d: 'Per-query yield over the last 14 days',
  classifier_outcomes: 'What happened to posts, 14 days',
}
