-- Were simon120 and L_R_Jones the same person / same device? Run each block separately.
-- (v2: matches on email instead of a time window; visits uses visited_at.)

-- 1) Both buyers' checkouts side by side (every checkout click, paid or not)
select email, plan, src, visitor_id, device, left(user_agent, 90) ua, referrer, landing_path, utm_source,
       created_at, paid_at
from checkout_events
where email ilike 'simon120%' or email ilike 'l\_r\_jones%' or email ilike 'lrjones%' or email ilike '%jonescpa%'
order by created_at;

-- 2) Every offer view and visit by those visitor_ids (shared visitor_id = same browser)
with v as (select distinct visitor_id from checkout_events
           where email ilike 'simon120%' or email ilike 'l\_r\_jones%' or email ilike '%jonescpa%')
select 'offer_view' as kind, visitor_id, created_at as at, src as detail, referrer from offer_views where visitor_id in (select visitor_id from v)
union all
select 'visit', visitor_id, visited_at, null, referrer from visits where visitor_id in (select visitor_id from v)
order by at;

-- 3) Anyone else with the same user agent checking out within 2 hours of either buyer (weak signal)
with b as (select user_agent, created_at from checkout_events
           where email ilike 'simon120%' or email ilike 'l\_r\_jones%' or email ilike '%jonescpa%')
select c.visitor_id, c.email, c.plan, c.paid_at, left(c.user_agent, 90) ua
from checkout_events c join b on c.user_agent = b.user_agent and c.created_at between b.created_at - interval '2 hours' and b.created_at + interval '2 hours'
group by 1,2,3,4,5 order by c.paid_at;
