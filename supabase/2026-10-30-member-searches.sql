-- What each member has searched for on the site (logged in or not), for personalised campaign email.
-- A search made anonymously is tied to a member through the browser id: every table that records a browser id
-- together with a signed-in user (visits, search_events) bridges the two. Run once in the Supabase SQL editor.

create or replace function member_searches(p_ids uuid[], p_days int default 60)
returns table (user_id uuid, term text, locations jsonb, n bigint, last_at timestamptz)
language sql stable set search_path = public as $$
  with bridge as (
    select distinct v.visitor_id, v.user_id from visits v where v.user_id = any(p_ids) and v.visitor_id is not null
    union
    select distinct e.visitor_id, e.user_id from search_events e where e.user_id = any(p_ids) and e.visitor_id is not null
  )
  select b.user_id, lower(trim(s.term)) as term, to_jsonb(s.locations) as locations, count(*) as n, max(s.searched_at) as last_at
  from search_events s
  join bridge b on b.visitor_id = s.visitor_id
  where s.term is not null and length(trim(s.term)) > 3
    and s.searched_at > now() - make_interval(days => p_days)
  group by b.user_id, lower(trim(s.term)), to_jsonb(s.locations)
$$;
revoke all on function member_searches(uuid[], int) from public, anon, authenticated;
