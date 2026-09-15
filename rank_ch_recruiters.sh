#!/usr/bin/env bash
# Rank Swiss recruiters by how many jobs they post to LinkedIn.
#
# Scrapes LinkedIn job postings across Swiss cities, pulls the "hiring team"
# person off each posting, aggregates by profile URL -> posting count.
#
# Fans out by city because this actor's splitCountry enum has no "ch",
# so each (city, window) slice stays under LinkedIn's ~1000-result ceiling.
#
# Usage:
#   export APIFY_TOKEN=apify_api_xxx
#   ./rank_ch_recruiters.sh snapshot   # last 30 days, one pass
#   ./rank_ch_recruiters.sh daily      # last 24h — put this on a cron
#   ./rank_ch_recruiters.sh rank       # re-aggregate what's already on disk
set -euo pipefail

: "${APIFY_TOKEN:?Set APIFY_TOKEN first: export APIFY_TOKEN=apify_api_xxx}"

ACTOR="harshmaur~linkedin-jobs-scraper"
OUT_DIR="./ch_jobs"
RAW_DIR="${OUT_DIR}/raw"
mkdir -p "$RAW_DIR"

MODE="${1:-snapshot}"
CAP=1000          # per-slice ceiling; LinkedIn stops serving past ~1000 anyway

CITIES=(
  "Zurich, Switzerland"
)

harvest () {
  local WINDOW="$1" STAMP="$2"

  for CITY in "${CITIES[@]}"; do
    local CSLUG DEST
    CSLUG=$(echo "$CITY" | sed 's/, Switzerland//' | tr '[:upper:] ' '[:lower:]_')
    DEST="${RAW_DIR}/${STAMP}__${CSLUG}.json"

    [[ -s "$DEST" ]] && { echo "==> ${STAMP} ${CSLUG} (cached)"; continue; }
    echo "==> ${STAMP} ${CSLUG}"

    local INPUT
    INPUT=$(jq -n --arg loc "$CITY" --arg w "$WINDOW" --argjson cap "$CAP" '{
      location: $loc,
      datePosted: $w,
      scrapeDetails: true,
      sortBy: "recent",
      maxItems: $cap
    }')

    local RUN RUN_ID DATASET_ID STATUS TOTAL WITH
    RUN=$(curl -sS -X POST \
      "https://api.apify.com/v2/acts/${ACTOR}/runs?token=${APIFY_TOKEN}" \
      -H 'Content-Type: application/json' -d "$INPUT")

    RUN_ID=$(echo "$RUN" | jq -r '.data.id // "null"')
    DATASET_ID=$(echo "$RUN" | jq -r '.data.defaultDatasetId // "null"')
    if [[ "$RUN_ID" == "null" ]]; then
      echo "    FAILED to start:"; echo "$RUN" | jq .; continue
    fi

    while :; do
      STATUS=$(curl -sS "https://api.apify.com/v2/actor-runs/${RUN_ID}?token=${APIFY_TOKEN}" \
        | jq -r '.data.status')
      [[ "$STATUS" == "RUNNING" || "$STATUS" == "READY" ]] || break
      sleep 20
    done

    curl -sS "https://api.apify.com/v2/datasets/${DATASET_ID}/items?token=${APIFY_TOKEN}&clean=true&format=json" \
      > "$DEST"

    TOTAL=$(jq 'length' "$DEST")
    WITH=$(jq '[.[] | select((.jobPosterProfileUrl // "") != "")] | length' "$DEST")
    echo "    $STATUS — $TOTAL jobs, $WITH with a named poster"
    (( TOTAL >= CAP )) && echo "    !! hit the $CAP cap — narrow this slice (shorter window or add jobType)"
  done
}

rank () {
  echo
  echo "==> aggregating"
  # Field names vary between actor builds, so probe the likely ones.
  jq -s '
    def coname:
      (.companyName
       // .organizationName
       // (if (.company | type) == "object" then .company.name else .company end)
       // "");
    def jobkey:
      (.jobUrl // .url // .link // .jobId // .id // .title // "");

    add
    | map(select((.jobPosterProfileUrl // "") != ""))
    | map(.pkey = (.jobPosterProfileUrl | ascii_downcase | split("?")[0] | sub("/$"; "")))
    | group_by(.pkey)
    | map({
        name:      (map(.jobPosterName)  | map(select(. != null)) | first // ""),
        title:     (map(.jobPosterTitle) | map(select(. != null)) | first // ""),
        jobs:      (map(jobkey) | map(select(. != "")) | unique | length),
        companies: (map(coname) | map(select(. != "")) | unique),
        roles:     (map(.title // "") | map(select(. != "")) | unique | .[0:5]),
        url:       (map(.jobPosterProfileUrl) | first)
      })
    | sort_by(-.jobs)
  ' "${RAW_DIR}"/*.json > "${OUT_DIR}/recruiters_ranked.json"

  echo "    $(jq 'length' "${OUT_DIR}/recruiters_ranked.json") distinct recruiters"

  jq -r '["rank","jobs_posted","name","title","companies","sample_roles","url"],
    (to_entries[] | [
      (.key + 1), .value.jobs, .value.name, .value.title,
      (.value.companies | join(" | ")),
      (.value.roles | join(" | ")),
      .value.url
    ]) | @csv' "${OUT_DIR}/recruiters_ranked.json" > "${OUT_DIR}/recruiters_ranked.csv"

  echo
  echo "TOP 25:"
  jq -r '.[0:25][] | "  \(.jobs)\t\(.name)\t\(.companies | join(", "))"' \
    "${OUT_DIR}/recruiters_ranked.json" | column -t -s $'\t'
  echo
  echo "Full list: ${OUT_DIR}/recruiters_ranked.csv"
}

case "$MODE" in
  snapshot) harvest "30" "m$(date +%Y%m)" ; rank ;;
  daily)    harvest "1"  "d$(date +%Y%m%d)" ; rank ;;
  rank)     rank ;;
  *) echo "Usage: $0 [snapshot|daily|rank]"; exit 1 ;;
esac