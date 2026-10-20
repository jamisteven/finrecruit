-- Before/after measurement for the October 2026 sweep changes.
-- 1) run the CREATE once; 2) run the INSERT with label 'before' NOW, before deploying;
-- 3) run it again with 'after-3d', 'after-7d' …; 4) the final SELECT lines the labels up.

create table if not exists metrics_snapshots (
  id bigserial primary key,
  label text not null,
  taken_at timestamptz not null default now(),
  payload jsonb not null
);

-- ---------------------------------------------------------------- snapshot
-- Change the label each time you run it.
with
member_queries as (
  select p.email, lower(q.query) as query
  from user_targets t
  join profiles p on p.id = t.user_id and p.pass_expires_at > now()
  join priority_queries q on q.keyword ilike t.keyword and q.location ilike coalesce(t.location, '')
),
days as (select generate_series(current_date - 6, current_date, interval '1 day')::date as d),
member_days as (
  select m.email, d.d, coalesce(sum(r.jobs_inserted), 0) as new_roles
  from (select distinct email, query from member_queries) m
  cross join days d
  left join ingest_runs r on r.pipeline = 'priority' and lower(r.query) = m.query and r.run_at::date = d.d
  group by 1, 2
),
per_member as (
  select email,
         count(*) filter (where new_roles = 0) as zero_days_of_7,
         sum(new_roles) as new_roles_7d
  from member_days group by 1
),
lag as (
  select percentile_cont(0.5) within group (order by extract(epoch from now() - last_run_at) / 3600) as median_h,
         percentile_cont(0.9) within group (order by extract(epoch from now() - last_run_at) / 3600) as p90_h,
         max(extract(epoch from now() - last_run_at) / 3600) as max_h,
         count(*) as active_queries,
         count(*) filter (where last_run_at > now() - interval '12 hours') as fresh_12h,
         count(*) filter (where last_run_at > now() - interval '24 hours') as fresh_24h
  from priority_queries where active
),
spend as (
  select pipeline,
         sum(posts_returned) as posts_7d,
         sum(jobs_inserted) as kept_7d,
         round(sum(posts_returned) * 0.002, 2) as usd_7d,
         round(sum(jobs_inserted)::numeric / nullif(sum(posts_returned) * 0.002, 0), 1) as kept_per_usd
  from ingest_runs where run_at > now() - interval '7 days' group by 1
)
insert into metrics_snapshots (label, payload)
select 'before',   -- <<< change per run: 'after-3d', 'after-7d'
  jsonb_build_object(
    'members', (select jsonb_agg(to_jsonb(per_member) order by email) from per_member),
    'members_with_zero_days', (select count(*) from per_member where zero_days_of_7 > 0),
    'avg_zero_days', (select round(avg(zero_days_of_7), 2) from per_member),
    'query_lag_hours', (select to_jsonb(lag) from lag),
    'spend_7d', (select jsonb_agg(to_jsonb(spend)) from spend),
    'apify_posts_per_day_7d', (select round(sum(posts_returned) / 7.0) from ingest_runs where run_at > now() - interval '7 days'),
    'haiku_calls_per_day_7d', (select round(count(*) / 7.0) from classifier_log where created_at > now() - interval '7 days' and model not in ('prefilter', 'gate') and model not like '%backfill%')
  );

-- ---------------------------------------------------------------- compare
select label, taken_at::date,
       payload->>'members_with_zero_days' as members_with_a_zero_day,
       payload->>'avg_zero_days' as avg_zero_days_per_member,
       round((payload->'query_lag_hours'->>'median_h')::numeric, 1) as median_lag_h,
       round((payload->'query_lag_hours'->>'p90_h')::numeric, 1) as p90_lag_h,
       payload->'query_lag_hours'->>'fresh_12h' as queries_fresh_12h,
       payload->'query_lag_hours'->>'active_queries' as active_queries,
       payload->>'apify_posts_per_day_7d' as apify_posts_per_day,
       payload->>'haiku_calls_per_day_7d' as haiku_calls_per_day,
       payload->'spend_7d' as spend_by_pipeline
from metrics_snapshots order by taken_at;
