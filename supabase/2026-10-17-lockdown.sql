-- Lock the Data API down to the server.
--
-- Every read and write in the app goes through API routes using the
-- service-role key, which bypasses RLS. The browser only uses the public
-- anon key to sign in. So nothing in the public schema needs to be
-- reachable by anon or authenticated clients at all — yet jobs had a
-- "public can read" policy, an insert policy open to everyone, and most
-- other tables were created without RLS, which left them wide open.
--
-- Run in the Supabase SQL editor. Safe to re-run.

-- 1. The two open policies on jobs
drop policy if exists "Public can read jobs" on public.jobs;
drop policy if exists "Service role can insert jobs" on public.jobs;

-- 2. RLS on every table in public, now and for anything created later.
--    With RLS on and no policies, anon/authenticated get nothing;
--    service_role is unaffected.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end $$;

-- 3. Belt and braces: take the grants away too, so even a future
--    "using (true)" policy added by mistake can't expose anything.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 4. Check: should list every public table with rls = true and no policies
select c.relname as "table", c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
