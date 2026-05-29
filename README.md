# FinRecruitFeed

> Surface hidden finance jobs from LinkedIn recruiter posts. Updated every 6 hours.

## How it works

1. **Apify** scrapes LinkedIn using finance + recruiting search queries every 6 hours
2. **Claude** reads each post and classifies it: is this a job? If yes, extract title, company, location, seniority, salary, apply method, tags
3. Results stored in **Supabase** (deduped by post URL)
4. **Next.js UI** displays jobs with filters by seniority, location, keyword

---

## Setup (~30 minutes)

### 1. Supabase
1. Create a project at supabase.com
2. Go to SQL Editor and run the contents of `supabase/schema.sql`
3. Copy your Project URL, Anon Key, and Service Role Key from Settings > API

### 2. Apify
1. Create a free account at apify.com
2. Go to Settings > Integrations > API Token and copy it
3. The free tier gives $5/month credit — enough for ~500 post scrapes to prototype

### 3. Anthropic API
1. Get your API key from console.anthropic.com
2. Claude Sonnet 4 costs ~$0.003 per post classification

### 4. Environment variables
```bash
cp .env.local.example .env.local
# Fill in all values
```

### 5. Run locally
```bash
npm install
npm run dev
# Opens at http://localhost:3000
```

### 6. Deploy to Vercel
```bash
npx vercel --prod
# Add environment variables in Vercel Dashboard > Settings > Environment Variables
```

Vercel runs the ingest cron every 6 hours automatically (configured in vercel.json).

---

## Manually trigger an ingest
```bash
curl -X POST https://your-app.vercel.app/api/ingest \
  -H "x-ingest-secret: YOUR_INGEST_SECRET"
```

---

## Project structure
```
finrecruit/
├── app/
│   ├── api/
│   │   ├── ingest/route.ts   # Apify → Claude → Supabase pipeline
│   │   └── jobs/route.ts     # Jobs query endpoint
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx              # Main job board UI
├── components/
│   ├── JobCard.tsx
│   ├── FilterBar.tsx
│   └── StatsBar.tsx
├── lib/
│   ├── apify.ts              # Scraper + search queries
│   ├── classifier.ts         # Claude classification prompt
│   └── supabase.ts           # DB client
├── types/index.ts
├── supabase/schema.sql       # Run once in Supabase SQL editor
└── vercel.json               # Cron: every 6 hours
```

## Customising search queries
Edit `FINANCE_JOB_QUERIES` in `lib/apify.ts` to change what gets scraped.
