-- Marketing email: who has opted out, and a log of every campaign send (one row per member per campaign).
-- Run once in the Supabase SQL editor.

alter table profiles add column if not exists email_unsubscribed_at timestamptz;

create table if not exists email_sends (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  email       text not null,
  campaign    text not null,
  status      text not null default 'sending',   -- sending | sent | failed
  resend_id   text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (user_id, campaign)                      -- a member can never get the same campaign twice
);
create index if not exists email_sends_campaign_idx on email_sends (campaign, created_at desc);
alter table email_sends enable row level security;
alter table email_sends force row level security;
revoke all on email_sends from anon, authenticated;

-- After a send: results by campaign, and who came back.
-- select campaign, status, count(*) from email_sends group by 1, 2 order by 1, 2;
-- select count(*) as paid_after_email
-- from email_sends s join profiles p on p.id = s.user_id
-- where s.campaign = 'winback-1' and s.status = 'sent' and p.pass_expires_at > s.sent_at;
