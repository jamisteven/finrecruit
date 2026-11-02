-- Keeps the /analytics page from pulling raw event rows into the app just to count them.
-- Run once in the Supabase SQL editor. The page still works without it (it falls back to the old reads), just with more egress.

-- 1. Finished panels, shared by every server instance, so a reload does not re-read the tables.
create table if not exists analytics_cache (
  key        text primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
alter table analytics_cache enable row level security;
alter table analytics_cache force row level security;
revoke all on analytics_cache from anon, authenticated;

-- 2. Visits: distinct visitors per UTC day, and the weekday x hour grid (a few hundred numbers instead of 90 days of rows).
create or replace function analytics_visit_rollup(p_days int)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'n', c))
      from (select (visited_at at time zone 'utc')::date as d, count(distinct visitor_id) as c
            from visits where visited_at >= now() - make_interval(days => p_days) group by 1) x), '[]'::jsonb),
    'matrix', coalesce((
      select jsonb_agg(jsonb_build_object('dow', w, 'hr', h, 'n', c))
      from (select extract(dow from visited_at at time zone 'utc')::int as w,
                   extract(hour from visited_at at time zone 'utc')::int as h, count(*) as c
            from visits where visited_at >= now() - make_interval(days => p_days) group by 1, 2) y), '[]'::jsonb)
  )
$$;
revoke all on function analytics_visit_rollup(int) from public, anon, authenticated;

-- 3. Roles added per day (direct vs agency) and per sector, low quality left out.
create or replace function analytics_jobs_rollup(p_days int)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'agency', a, 'direct', t - a))
      from (select (extracted_at at time zone 'utc')::date as d, count(*) as t, count(*) filter (where employer_type = 'agency') as a
            from jobs where extracted_at >= now() - make_interval(days => p_days) and (quality is null or quality <> 'low') group by 1) x), '[]'::jsonb),
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object('sector', s, 'n', c))
      from (select coalesce(sector, 'other') as s, count(*) as c
            from jobs where extracted_at >= now() - make_interval(days => p_days) and (quality is null or quality <> 'low') group by 1) y), '[]'::jsonb)
  )
$$;
revoke all on function analytics_jobs_rollup(int) from public, anon, authenticated;

-- 4. What the classifier did with posts: counts by kind, decision and day (the log has a row per post).
create or replace function analytics_classifier_rollup(p_days int)
returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'decision', decision, 'day', d, 'n', c)), '[]'::jsonb)
  from (select case when model = 'prefilter' then 'prefilter' when model = 'gate' then 'gate' else 'model' end as k,
               decision, (created_at at time zone 'utc')::date as d, count(*) as c
        from classifier_log
        where created_at >= now() - make_interval(days => p_days) and model not like '%backfill%'
        group by 1, 2, 3) z
$$;
revoke all on function analytics_classifier_rollup(int) from public, anon, authenticated;
