-- A log of what happens to each monthly subscription: it starts, someone schedules a cancel (or changes their mind),
-- it renews, it ends. The Stripe webhook writes one row per event, so weekly churn can be worked out exactly.
-- Run once in the Supabase SQL editor. Until it exists the webhook simply skips logging (payments are unaffected).

create table if not exists subscription_events (
  id                     bigint generated always as identity primary key,
  stripe_event_id        text unique,               -- a retried Stripe event never makes a second row
  stripe_subscription_id text not null,
  user_id                uuid,
  email                  text,
  kind                   text not null check (kind in ('started', 'renewed', 'cancel_scheduled', 'cancel_undone', 'ended')),
  occurred_at            timestamptz not null,      -- when it happened (Stripe's time, not ours)
  period_end             timestamptz,               -- the date access runs to / the cancel takes effect
  reason                 text,                      -- the member's reason if the cancel flow asked, or Stripe's (payment_failed, ...)
  comment                text,
  created_at             timestamptz not null default now()
);
create index if not exists subscription_events_sub_idx on subscription_events (stripe_subscription_id, occurred_at);
create index if not exists subscription_events_kind_idx on subscription_events (kind, occurred_at);
alter table subscription_events enable row level security;
alter table subscription_events force row level security;
revoke all on subscription_events from anon, authenticated;

-- Weekly churn: members who left (ended) as a share of the members active at the start of the week.
-- "cancels_scheduled" is the earlier signal: people who clicked cancel that week, whatever date it takes effect.
-- (Paste this on its own whenever you want the numbers.)
--
-- with weeks as (
--   select generate_series(date_trunc('week', (select min(occurred_at) from subscription_events))::date,
--                          date_trunc('week', now())::date, interval '1 week')::date as week_start
-- )
-- select w.week_start,
--        (select count(*) from subscription_events e where e.kind = 'started' and e.occurred_at < w.week_start)
--      - (select count(*) from subscription_events e where e.kind = 'ended'   and e.occurred_at < w.week_start) as active_at_start,
--        (select count(*) from subscription_events e where e.kind = 'cancel_scheduled' and e.occurred_at >= w.week_start and e.occurred_at < w.week_start + 7) as cancels_scheduled,
--        (select count(*) from subscription_events e where e.kind = 'cancel_undone'    and e.occurred_at >= w.week_start and e.occurred_at < w.week_start + 7) as changed_mind,
--        (select count(*) from subscription_events e where e.kind = 'ended'            and e.occurred_at >= w.week_start and e.occurred_at < w.week_start + 7) as ended,
--        (select count(*) from subscription_events e where e.kind = 'renewed'          and e.occurred_at >= w.week_start and e.occurred_at < w.week_start + 7) as renewed
-- from weeks w
-- order by w.week_start;
