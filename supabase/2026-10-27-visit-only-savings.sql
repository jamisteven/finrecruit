-- How much Apify repeat-run spend would "search only when the member visits" save?
-- Counts 12-hour windows per paid member over the last 14 days:
--   runs_now_approx = windows the cron would run them (visited in the last 3 days, ACTIVE_DAYS)
--   runs_on_visit   = windows where they actually visited (visit-triggered catch-up only)
-- saving = 1 - runs_on_visit / runs_now_approx. Approximate: the real staleness check is rolling, not bucketed.
with m as (select user_id, min(paid_at) fp from checkout_events
           where paid_at is not null and user_id is not null group by 1),
b as (select generate_series(date_trunc('hour', now() - interval '14 days'), now() - interval '12 hours', interval '12 hours') t),
mb as (select m.user_id, b.t from m join b on b.t + interval '12 hours' > m.fp),
v as (select user_id, visited_at from visits where visited_at > now() - interval '18 days' and user_id is not null)
select count(*) as member_windows,
  count(*) filter (where exists (select 1 from v where v.user_id = mb.user_id
        and v.visited_at >= mb.t - interval '3 days' and v.visited_at < mb.t + interval '12 hours')) as runs_now_approx,
  count(*) filter (where exists (select 1 from v where v.user_id = mb.user_id
        and v.visited_at >= mb.t and v.visited_at < mb.t + interval '12 hours')) as runs_on_visit
from mb;
