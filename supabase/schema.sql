-- =============================================
-- FinRecruitFeed — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor
-- =============================================

-- Jobs table
create table if not exists jobs (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  company         text,
  location        text,
  seniority       text not null default 'Unknown',
  salary          text,
  apply_method    text,
  summary         text not null default '',
  tags            text[] not null default '{}',
  post_url        text not null unique,   -- prevents duplicates
  author_name     text,
  author_headline text,
  author_linkedin_url text,
  raw_text        text not null default '',
  posted_at       timestamptz,
  extracted_at    timestamptz not null default now(),
  is_verified_job boolean not null default true
);

-- Indexes for common filter queries
create index if not exists jobs_seniority_idx     on jobs (seniority);
create index if not exists jobs_extracted_at_idx  on jobs (extracted_at desc);
create index if not exists jobs_location_idx      on jobs using gin (to_tsvector('english', coalesce(location, '')));

-- Full-text search index
create index if not exists jobs_fts_idx on jobs
  using gin (to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(company, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(raw_text, '')
  ));

-- Email subscriptions (for future email digest feature)
create table if not exists subscriptions (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  seniority_filter text default 'All',
  location_filter  text,
  frequency        text not null default 'daily',  -- 'instant' | 'daily' | 'weekly'
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- RLS: public read access on jobs (so the UI works without auth)
alter table jobs enable row level security;
create policy "Public can read jobs"
  on jobs for select
  using (true);

-- RLS: only service role can insert/update jobs (ingest API uses service role key)
create policy "Service role can insert jobs"
  on jobs for insert
  with check (true);  -- enforced via service role key, not per-row

-- =============================================
-- Sample data to test the UI immediately
-- =============================================
insert into jobs (title, company, location, seniority, salary, apply_method, summary, tags, post_url, author_name, author_headline, raw_text, posted_at)
values
(
  'Credit Analyst — Special Situations',
  'Distressed Debt Fund',
  'London',
  'Senior',
  '£130k–£170k + bonus',
  'DM recruiter on LinkedIn',
  'Special situations fund seeking an analyst with 4-6 years of high yield / distressed credit experience from a bank or credit fund. CFA preferred.',
  array['credit', 'distressed', 'special-situations', 'london', 'hedge-fund'],
  'https://linkedin.com/posts/sample-1',
  'Claire Thompson',
  'Senior Recruiter | Credit & Fixed Income | London',
  'Exciting mandate for a credit analyst seat at a growing special situations fund in London...',
  now() - interval '2 hours'
),
(
  'Macro Strategist',
  'Global Macro Fund',
  'New York / London',
  'VP',
  null,
  'Email CV to recruiter',
  'Established global macro fund hiring a strategist to cover EM rates and FX. Strong fundamental and quantitative research skills required.',
  array['macro', 'rates', 'fx', 'em', 'strategist', 'new-york', 'london'],
  'https://linkedin.com/posts/sample-2',
  'David Okonkwo',
  'Macro & Rates Recruiter | Global Hedge Funds',
  'Looking for a strong macro strategist for one of my top clients...',
  now() - interval '5 hours'
),
(
  'FP&A Manager — FinTech Scale-up',
  'Series C FinTech',
  'Amsterdam',
  'Mid',
  '€80k–€100k + equity',
  'Apply via link in bio',
  'Fast-growing payments fintech hiring an FP&A manager to own financial modelling, budgeting and investor reporting ahead of Series D.',
  array['fpa', 'fintech', 'amsterdam', 'scale-up', 'equity'],
  'https://linkedin.com/posts/sample-3',
  'Lena de Vries',
  'Finance & FinTech Recruiter | Benelux',
  'One of my favourite clients — a rocketship fintech in Amsterdam — is hiring...',
  now() - interval '1 day'
)
on conflict (post_url) do nothing;
