-- Jobs already saved that the tightened prefilter would now refuse: AI-training gig marketplaces (micro1, Mercor,
-- Outlier, DataAnnotation) and posts whose own text says "Location: <India/Pakistan/...>" even though the model
-- tagged them Remote. Marking them quality = 'low' removes them from every feed (the feed hides low quality).
-- Run the preview, read it, then the update. Safe to re-run.

-- PREVIEW
select title, company, location, posted_at::date as posted
from jobs
where quality is distinct from 'low'
  and (
    coalesce(raw_text, '') ~* '\m(micro1|mercor|outlier\.ai|data ?annotation)\M'
    or coalesce(company, '') ~* '^(micro1|mercor)'
    or normalize(coalesce(raw_text, ''), NFKC) ~* 'location\s*:\s*(pakistan|india|bangladesh|sri lanka|nigeria|kenya|ghana|egypt|philippines|indonesia|vietnam)\M'
  )
order by posted_at desc;

-- UPDATE
update jobs set quality = 'low'
where quality is distinct from 'low'
  and (
    coalesce(raw_text, '') ~* '\m(micro1|mercor|outlier\.ai|data ?annotation)\M'
    or coalesce(company, '') ~* '^(micro1|mercor)'
    or normalize(coalesce(raw_text, ''), NFKC) ~* 'location\s*:\s*(pakistan|india|bangladesh|sri lanka|nigeria|kenya|ghana|egypt|philippines|indonesia|vietnam)\M'
  );
