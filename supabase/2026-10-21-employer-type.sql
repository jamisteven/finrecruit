-- Direct employer vs agency / staffing post. New rows get it from the classifier plus the text
-- signals in lib/employer.ts; this adds the column and backfills from the stored post text.
-- Run the previews, read the samples, then the updates. Safe to re-run.

alter table jobs add column if not exists employer_type text;   -- 'direct' | 'agency' | null (unknown)
create index if not exists jobs_employer_type_idx on jobs (employer_type);

-- PREVIEW 1: text signals (same pattern as AGENCY_TEXT in lib/employer.ts)
select count(*) as would_mark, array_agg(title || ' · ' || coalesce(company, '?') order by posted_at desc) filter (where true) as sample
from (
  select title, company, posted_at from jobs
  where employer_type is null
    and coalesce(raw_text, '') ~* '\m(our client|end[- ]client|client (location|site|is|in)|for (a|an|our) (client|customer)|implementation partner|prime vendor|bench|c2c|corp[- ]to[- ]corp|w2|1099|h1b|gc/usc|usc/gc|opt|ead|contract[- ]to[- ]hire|c2h|\d+[- ]?(month|week)s? (contract|engagement|project)|must be local|locals? only|staffing|consultancy services|send (me )?(your )?(updated )?(resume|cv) (to|at)|share (your )?(updated )?(resume|cv))\M'
       or coalesce(raw_text, '') ~* 'duration\s*:'
  limit 40
) s;

-- PREVIEW 2: company-name pattern + apply by email (the quieter agencies)
select count(*) as would_mark, array_agg(title || ' · ' || coalesce(company, '?') order by posted_at desc) filter (where true) as sample
from (
  select title, company, posted_at from jobs
  where employer_type is null
    and apply_method ilike '%email%'
    and coalesce(company, '') ~* '\m(technologies|technology|solutions|consultancy|consulting|infotech|softech|staffing|resourcing|recruitment|talent|systems inc|it services)\M'
  limit 40
) s;

-- UPDATE 1: text signals → agency
update jobs set employer_type = 'agency'
where employer_type is null
  and (coalesce(raw_text, '') ~* '\m(our client|end[- ]client|client (location|site|is|in)|for (a|an|our) (client|customer)|implementation partner|prime vendor|bench|c2c|corp[- ]to[- ]corp|w2|1099|h1b|gc/usc|usc/gc|opt|ead|contract[- ]to[- ]hire|c2h|\d+[- ]?(month|week)s? (contract|engagement|project)|must be local|locals? only|staffing|consultancy services|send (me )?(your )?(updated )?(resume|cv) (to|at)|share (your )?(updated )?(resume|cv))\M'
       or coalesce(raw_text, '') ~* 'duration\s*:');

-- UPDATE 2: consultancy-style company + email → agency
update jobs set employer_type = 'agency'
where employer_type is null
  and apply_method ilike '%email%'
  and coalesce(company, '') ~* '\m(technologies|technology|solutions|consultancy|consulting|infotech|softech|staffing|resourcing|recruitment|talent|systems inc|it services)\M';

-- UPDATE 3: everything else already in the feed counts as direct (the classifier decides from here on)
update jobs set employer_type = 'direct' where employer_type is null;

-- AFTER
select employer_type, count(*) from jobs where posted_at > now() - interval '14 days' group by 1;

-- ── Correction after the first backfill (the first text pattern was too greedy: "bench", "client is",
--    "send your resume", "staffing", and non-tech companies called Solutions). Recomputes from scratch
--    with the rules now in lib/employer.ts. Already run on 2026-10-21 (result: 4214 direct / 1016 agency).
--    Safe to re-run any time.
update jobs set employer_type = 'direct';

update jobs set employer_type = 'agency'
where coalesce(raw_text, '') ~* '\m(our client|end[- ]client|client (location|site)|for (a|an|our) (client|customer)|client unnamed|undisclosed client|implementation partner|prime vendor|bench sales|on (our |the )?bench|c2c|corp[- ]to[- ]corp|w2|1099|h1b|h-1b|gc/usc|usc/gc|opt/cpt|contract[- ]to[- ]hire|c2h|\d+\+?[- ]?(month|week)s? (contract|engagement|project|assignment)|must be local|locals? only|staffing (firm|agency|partner|company)|consultancy services)\M'
   or coalesce(raw_text, '') ~* 'duration\s*:'
   or coalesce(company, '') ~* '\m(staffing|resourcing|recruitment|recruiting|headhunt|talent (partners|solutions|group|acquisition)|search partners|executive search)\M'
   or (sector = 'tech' and apply_method ilike '%email%'
       and coalesce(company, '') ~* '\m(technologies|technology|solutions|consultancy|consulting|infotech|softech|systems inc|it services|tek|soft)\M');

select employer_type, count(*) from jobs where posted_at > now() - interval '14 days' group by 1;
