-- Salted IP hash + coarse geo on offer views and checkouts (answers "same network?" questions).
-- Run BEFORE deploying: the inserts include these columns and fail without them.
alter table offer_views     add column if not exists ip_hash text, add column if not exists ip_country text, add column if not exists ip_city text;
alter table checkout_events add column if not exists ip_hash text, add column if not exists ip_country text, add column if not exists ip_city text;
create index if not exists checkout_events_ip_idx on checkout_events (ip_hash) where ip_hash is not null;
create index if not exists offer_views_ip_idx     on offer_views (ip_hash)     where ip_hash is not null;

-- Later: buyers who share a network (paid checkouts only)
-- select ip_hash, count(*) n, array_agg(email order by paid_at) emails, array_agg(plan order by paid_at) plans
-- from checkout_events where paid_at is not null and ip_hash is not null
-- group by 1 having count(*) > 1;
