-- Exact average Apify spend per paid user (member searches only, pipeline = 'priority'), at $0.002/post.
-- Accounts are created at payment time, so every member searching is a paid user.

-- 1) All-time and last-30-days: total spend / distinct paying users
with paid as (select count(distinct user_id) n from checkout_events where paid_at is not null and user_id is not null),
runs as (
  select posts_returned p, run_at,
         row_number() over (partition by lower(query) order by run_at) = 1 as first_run
  from ingest_runs where pipeline = 'priority'
)
select
  (select n from paid) as paying_users,
  round(sum(p) * 0.002, 2)                                              as total_usd_all_time,
  round(sum(p) * 0.002 / nullif((select n from paid), 0), 2)            as usd_per_paid_user_all_time,
  round(sum(p) filter (where run_at > now() - interval '30 days') * 0.002, 2)                                  as usd_30d,
  round(sum(p) filter (where run_at > now() - interval '30 days') * 0.002 / nullif((select n from paid), 0), 2) as usd_30d_per_paid_user,
  round(sum(p) filter (where first_run) * 0.002, 2)                     as usd_first_runs_only,
  round(sum(p) filter (where not first_run) * 0.002, 2)                 as usd_repeat_runs,
  min(run_at)::date as first_run_day
from runs;

-- 2) Weekly spend next to new paid users that week (v2: fixed the ungrouped-column error)
with w as (select date_trunc('week', run_at)::date wk, sum(posts_returned) * 0.002 usd
           from ingest_runs where pipeline = 'priority' group by 1),
n as (select date_trunc('week', min_paid)::date wk, count(*) new_paid_users
      from (select user_id, min(paid_at) min_paid from checkout_events
            where paid_at is not null and user_id is not null group by 1) f group by 1)
select coalesce(w.wk, n.wk) week, round(w.usd::numeric, 2) usd, n.new_paid_users
from w full join n on n.wk = w.wk order by 1;

-- 3) Steady-state monthly cost per member: repeat-run spend per member-day x 30.
-- Members are young, so the all-time average understates what a long-lived member costs.
with first_paid as (select user_id, min(paid_at) fp from checkout_events
                    where paid_at is not null and user_id is not null group by 1),
md as (select sum(extract(epoch from now() - greatest(fp, timestamptz '2026-10-06')) / 86400) member_days,
              count(*) members from first_paid),
runs as (select posts_returned p,
                row_number() over (partition by lower(query) order by run_at) = 1 as first_run
         from ingest_runs where pipeline = 'priority')
select md.members,
       round(md.member_days::numeric, 0) member_days,
       round((sum(p) filter (where first_run) * 0.002 / md.members)::numeric, 2)              as first_run_usd_per_member,
       round((sum(p) filter (where not first_run) * 0.002 / md.member_days * 30)::numeric, 2) as ongoing_usd_per_member_month
from runs, md group by md.members, md.member_days;
