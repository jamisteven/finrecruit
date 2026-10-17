-- Undo 2026-10-17-lockdown.sql, restoring the previous (open) state.
-- Only for emergencies: this re-exposes every table to the public key.

grant usage on schema public to anon, authenticated;
grant all on all tables    in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I no force row level security', t.tablename);
    -- jobs keeps RLS on, with its old policies; everything else had RLS off
    if t.tablename <> 'jobs' and t.tablename <> 'profiles' and t.tablename <> 'checkout_events' then
      execute format('alter table public.%I disable row level security', t.tablename);
    end if;
  end loop;
end $$;

create policy "Public can read jobs" on public.jobs for select using (true);
create policy "Service role can insert jobs" on public.jobs for insert with check (true);
