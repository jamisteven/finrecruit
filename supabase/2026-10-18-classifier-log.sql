-- One row per classifier call, kept or discarded, with the untruncated post and
-- the full model output. Training data for a server-side classifier.
create table if not exists classifier_log (
  id                  bigserial primary key,
  post_url            text not null,
  pipeline            text not null,          -- ingest | hashtag | recruiter | priority
  query               text,
  hint_sector         text,
  author_name         text,
  author_headline     text,
  author_linkedin_url text,
  posted_at           timestamptz,
  raw_text            text not null,          -- the whole post, nothing sliced
  model               text not null,          -- which model gave this verdict
  is_job              boolean not null,       -- the label
  reason              text,                   -- model's short phrase when is_job = false
  title               text,
  company             text,
  location            text,
  sector              text,
  quality             text,
  output              jsonb not null,         -- the complete parsed response
  raw_response        text,                   -- what the model actually sent back
  latency_ms          integer,
  human_label         boolean,                -- set by hand when the model was wrong
  human_note          text,
  created_at          timestamptz not null default now()
);

create index if not exists classifier_log_created_idx  on classifier_log (created_at desc);
create index if not exists classifier_log_is_job_idx   on classifier_log (is_job, created_at desc);
create index if not exists classifier_log_post_url_idx on classifier_log (post_url);

-- Same posture as the rest of the schema after the lockdown: service role only.
alter table classifier_log enable row level security;
revoke all on classifier_log from anon, authenticated;
revoke all on sequence classifier_log_id_seq from anon, authenticated;

-- Seed it with what Sonnet already decided, so training doesn't start from zero.
-- Kept posts have their full text in jobs; discards only have the first 600 chars.
insert into classifier_log (post_url, pipeline, query, hint_sector, author_name, author_headline,
  author_linkedin_url, posted_at, raw_text, model, is_job, reason, title, company, location,
  sector, quality, output, created_at)
select post_url, 'backfill', null, sector, author_name, author_headline, author_linkedin_url,
  posted_at, raw_text, 'claude-sonnet-4-6 (backfill)', true, null, title, company, location,
  sector, quality,
  jsonb_build_object('isJob', true, 'title', title, 'company', company, 'location', location,
    'seniority', seniority, 'salary', salary, 'apply_method', apply_method, 'summary', summary,
    'tags', tags, 'sector', sector, 'quality', quality),
  extracted_at
from jobs
where raw_text <> ''
on conflict do nothing;

insert into classifier_log (post_url, pipeline, query, hint_sector, author_headline, raw_text,
  model, is_job, reason, output)
select post_url, coalesce(pipeline, 'backfill'), query, hint_sector, author_headline, raw_text,
  'claude-sonnet-4-6 (backfill, 600 chars)', false, reason,
  jsonb_build_object('isJob', false, 'reason', reason, 'label', label)
from classified_posts
where label = 'bad' and raw_text <> '';

-- Added 2026-10-18 (later the same day): the route's final decision, distinct from the
-- model's verdict. Values: kept | discarded | off-market | duplicate | error | prefiltered | pending.
alter table classifier_log add column if not exists decision text;
update classifier_log set decision = case
  when model = 'prefilter' then 'prefiltered'
  when is_job then 'kept' else 'discarded' end
where decision is null;
create index if not exists classifier_log_decision_idx on classifier_log (decision, created_at desc);

-- The gate's probability for the post (GATE_MODE=shadow|on), null when the gate was off.
alter table classifier_log add column if not exists gate_score real;
