-- New sector: biotech (shown as "Biotech & Pharma"). The classifier starts using it on deploy;
-- this backfills what is already in the feed. Run the PREVIEW first, eyeball the sample, then the UPDATEs.

-- Strong title signals: move from ANY sector. Data/computer/sports "scientists" stay where they are.
-- PREVIEW
select sector, count(*) from jobs
where title ~* '(^|[^a-z])(scientist|clinical (operations|research|trial|data|study|project|program|supply|quality)|regulatory affairs|medical science liaison|\mMSL\M|pharmacovigilance|drug (discovery|development|safety)|\mCMC\M|\mGMP\M|bioprocess|cell therapy|gene therapy|medical affairs|market access|biostatistic|toxicolog|formulation scientist|medical writer|clinical trial)'
  and title !~* 'data scientist|sports scientist|computer scientist|decision scientist|research scientist[^,]*(ai|ml|machine learning|nlp|llm)|applied scientist'
  and sector <> 'biotech'
group by 1;

-- Industry signals in the text: only from 'other' (a tech/finance role at a pharma stays tech/finance).
-- Hospital and clinic jobs stay 'other'.
-- PREVIEW
select count(*), array_agg(title order by posted_at desc) filter (where true) as sample from (
  select title, posted_at from jobs
  where sector = 'other'
    and coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || coalesce(summary,'') ~* 'biotech|pharma|life sciences|clinical trial|\mCRO\M|oncology|hematology|rare disease|therapeutics|biosciences|diagnostics|genomics|biopharma|medical device'
    and title !~* 'nurse|physician|resident|therapist|dental|pharmacist|hospital|surgeon|veterinar|caregiver|technician'
  limit 60
) s;

-- UPDATE 1: strong titles, any sector
update jobs set sector = 'biotech'
where title ~* '(^|[^a-z])(scientist|clinical (operations|research|trial|data|study|project|program|supply|quality)|regulatory affairs|medical science liaison|\mMSL\M|pharmacovigilance|drug (discovery|development|safety)|\mCMC\M|\mGMP\M|bioprocess|cell therapy|gene therapy|medical affairs|market access|biostatistic|toxicolog|formulation scientist|medical writer|clinical trial)'
  and title !~* 'data scientist|sports scientist|computer scientist|decision scientist|research scientist[^,]*(ai|ml|machine learning|nlp|llm)|applied scientist'
  and sector <> 'biotech';

-- UPDATE 2: industry signals, from 'other' only
update jobs set sector = 'biotech'
where sector = 'other'
  and coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || coalesce(summary,'') ~* 'biotech|pharma|life sciences|clinical trial|\mCRO\M|oncology|hematology|rare disease|therapeutics|biosciences|diagnostics|genomics|biopharma|medical device'
  and title !~* 'nurse|physician|resident|therapist|dental|pharmacist|hospital|surgeon|veterinar|caregiver|technician';

-- AFTER: what the sidebar will show
select sector, count(*) from jobs where posted_at > now() - interval '30 days' group by 1 order by 2 desc;
