-- Same-text fingerprint for mass-posted roles.
-- First 400 letters/digits of the post, lower-cased, hashed. Two posts with the same key are the same text,
-- whoever posted them. Stored (generated) so it is computed once and costs nothing at read time.
-- Run once in the Supabase SQL editor. Safe to re-run.
alter table jobs
  add column if not exists text_key text
  generated always as (
    left(md5(lower(regexp_replace(left(coalesce(raw_text, ''), 400), '[^a-zA-Z0-9]+', '', 'g'))), 12)
  ) stored;

create index if not exists jobs_text_key_idx on jobs (text_key);
