-- Offer-page views by entry point, plus the same source on checkouts.
-- Run once (without RLS in the SQL editor prompt — service role writes these rows).

create table if not exists offer_views (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  visitor_id  text not null,
  user_id     uuid,
  src         text,          -- which link led here: recruiter_line, feed_top, locked_title, hero_plan, …
  fresh       integer,       -- roles inside the free delay at the time
  has_pass    boolean not null default false,
  referrer    text
);
create index if not exists offer_views_created_idx on offer_views (created_at desc);
create index if not exists offer_views_src_idx on offer_views (src);
alter table offer_views enable row level security;
revoke all on offer_views from anon, authenticated;

alter table checkout_events add column if not exists src text;

-- Baseline, before deploying: 14 days of CTA → offer → checkout → paid, all sources lumped.
-- (offer_views is empty until the deploy, so the "before" is cta clicks from GA4 plus checkouts here.)
-- select
--   count(*) filter (where created_at > now() - interval '14 days')                                as checkouts_14d,
--   count(*) filter (where created_at > now() - interval '14 days' and paid_at is not null)         as paid_14d
-- from checkout_events;

-- After: views, checkouts and paid by source, last 14 days.
-- with v as (
--   select coalesce(src, '(none)') as src, count(*) as views, count(distinct visitor_id) as visitors
--   from offer_views where created_at > now() - interval '14 days' and not has_pass group by 1),
-- c as (
--   select coalesce(src, '(none)') as src, count(*) as checkouts, count(*) filter (where paid_at is not null) as paid
--   from checkout_events where created_at > now() - interval '14 days' group by 1)
-- select v.src, v.views, v.visitors, coalesce(c.checkouts, 0) as checkouts, coalesce(c.paid, 0) as paid,
--        round(100.0 * coalesce(c.checkouts, 0) / nullif(v.visitors, 0), 1) as checkout_pct
-- from v left join c using (src) order by v.visitors desc;

-- Share of free sessions that reach /offer at all (the 18% number), by day.
-- select date_trunc('day', vi.created_at)::date as day,
--        count(distinct vi.visitor_id) as free_visitors,
--        count(distinct ov.visitor_id) as reached_offer,
--        round(100.0 * count(distinct ov.visitor_id) / nullif(count(distinct vi.visitor_id), 0), 1) as pct
-- from visits vi
-- left join offer_views ov on ov.visitor_id = vi.visitor_id and ov.created_at::date = vi.created_at::date and not ov.has_pass
-- where vi.created_at > now() - interval '14 days' and vi.user_id is null
-- group by 1 order by 1;
