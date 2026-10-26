-- Posts that have a LinkedIn job listing attached are now kept, labelled "Also on LinkedIn Jobs".
-- (Before, every post with a listing attached was dropped by the prefilter.) Run this BEFORE deploying: the
-- ingest routes now write this column, and an insert into a table without it fails.
-- Safe to re-run.

alter table jobs add column if not exists on_linkedin_jobs boolean not null default false;

-- jobs saved before today whose stored text still carries the appended listing line
update jobs set on_linkedin_jobs = true
where on_linkedin_jobs = false and coalesce(raw_text, '') ~* 'job card details:\s*title:';

-- PREVIEW: posts the old rule discarded that are NOT LinkedIn's auto-generated template (these come back)
select count(*) as will_be_reread
from classified_posts
where reason like '%job card details%'
  and coalesce(raw_text, '') !~* 'apply today or share this post with your network';

-- Forget those discards so the next run reads them again (a post marked as seen is never re-read)
delete from classified_posts
where reason like '%job card details%'
  and coalesce(raw_text, '') !~* 'apply today or share this post with your network';
