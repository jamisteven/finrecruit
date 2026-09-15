#!/bin/bash
# One-time "loading phase" sweep for backchannel.jobs
#
# Runs every query of every sector ONCE in deep mode (relevance-ranked,
# maxPosts=25, no date filter) to mine the never-before-fetched depths of
# each LinkedIn search. The 60-day age gate in the route bounces fossils.
#
# Run AFTER the mode/maxPosts deploy is live. Expect ~1-3 minutes per call;
# the whole sweep takes a few hours — let it run in a terminal, or run one
# sector at a time by commenting out the others.
#
# Rough cost: ~6,000 Apify results (~$9 at $1.50/1k) + classification.

SECRET="superdupergood954"   # <-- fill in
BASE="https://backchanneljobs.vercel.app/api/ingest"

# sector:query-count (offsets step by 3 to cover each query exactly once)
for pair in finance:55 tech:75 legal:34 marketing:42 realestate:36; do
  sector="${pair%%:*}"
  n="${pair##*:}"
  echo ""
  echo "########## SWEEPING $sector ($n queries) ##########"
  for o in $(seq 0 3 $((n - 1))); do
    echo ""
    echo "=== $sector offset $o / $((n - 1)) ==="
    curl -sS -X POST "$BASE?sector=$sector&offset=$o&mode=deep" \
      -H "x-ingest-secret: $SECRET"
    echo ""
  done
done

echo ""
echo "Sweep complete. Check the site and run your age/count SQL to see the haul."