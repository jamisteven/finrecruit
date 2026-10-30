-- When each member was last on the site (any visit or search, signed in or not), for "since you last visited" email.
-- Same bridge as member_searches: a browser id seen with a signed-in user ties that browser's anonymous activity to the member.
-- Run once in the Supabase SQL editor.

create or replace function member_last_seen(p_ids uuid[])
returns table (user_id uuid, last_seen timestamptz)
language sql stable set search_path = public as $$
  with bridge as (
    select distinct v.visitor_id, v.user_id from visits v where v.user_id = any(p_ids) and v.visitor_id is not null
    union
    select distinct e.visitor_id, e.user_id from search_events e where e.user_id = any(p_ids) and e.visitor_id is not null
  ), seen as (
    select b.user_id, v.visited_at as t from bridge b join visits v on v.visitor_id = b.visitor_id
    union all
    select b.user_id, s.searched_at as t from bridge b join search_events s on s.visitor_id = b.visitor_id
  )
  select user_id, max(t) as last_seen from seen group by user_id
$$;
revoke all on function member_last_seen(uuid[]) from public, anon, authenticated;
