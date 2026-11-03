-- A public bucket for finished post snapshots, so a picture is drawn once and then served as a stored file.
-- Run once in the Supabase SQL editor. Until it exists, snapshots are drawn on demand as before.
-- The pictures are the redacted posts the free feed already shows, named by role id.
insert into storage.buckets (id, name, public)
values ('snapshots', 'snapshots', true)
on conflict (id) do nothing;
