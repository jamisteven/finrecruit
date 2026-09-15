#!/usr/bin/env bash
# Stage 2: separate actual recruiters from hiring managers in the ranked list.
#
#   ./classify_recruiters.sh score    # free — heuristics on data you already have
#   ./classify_recruiters.sh enrich   # ~$5/1k — pull each candidate's real profile
#   ./classify_recruiters.sh final    # join enrichment back, write final CSV
set -euo pipefail

: "${APIFY_TOKEN:?Set APIFY_TOKEN first}"

OUT_DIR="./ch_jobs"
RANKED="${OUT_DIR}/recruiters_ranked.json"
SCORED="${OUT_DIR}/recruiters_scored.json"
ENRICHED="${OUT_DIR}/enrichment_raw.json"
MIN_JOBS="${MIN_JOBS:-3}"     # below this, it's a hiring manager posting their own req

[[ -s "$RANKED" ]] || { echo "Run ./rank_ch_recruiters.sh first"; exit 1; }

score () {
  echo "==> scoring (min $MIN_JOBS postings)"
  jq --argjson min "$MIN_JOBS" '
    # Multilingual recruiter-title signals
    def strong: "(?i)(recruit|rekrut|talent acquisition|talent partner|talent sourc|sourcer|headhunt|personalberat|personalvermittl|staffing|executive search|resourcing|talent scout|karriereberat)";
    def weak:   "(?i)(hr |human resources|people (ops|team|partner)|personalleit|personalreferent|hr business partner|people & culture)";

    map(
      . as $p
      | .sig_title  = (if ($p.title | test(strong)) then 3
                       elif ($p.title | test(weak)) then 1 else 0 end)
      # posting for many different companies = agency recruiter
      | .sig_agency = (if (($p.companies | length) >= 3) then 3
                       elif (($p.companies | length) == 2) then 1 else 0 end)
      # posting a wide spread of unrelated roles = recruiter, not a manager hiring for their own team
      | .sig_spread = (if ($p.jobs >= 15) then 2 elif ($p.jobs >= 6) then 1 else 0 end)
      | .score      = (.sig_title + .sig_agency + .sig_spread)
      | .verdict    = (if .score >= 4 then "recruiter"
                       elif .score >= 2 then "likely"
                       else "probably-hiring-manager" end)
      # ch./de./at. prefix tells you where they sit
      | .country    = (.url | capture("https?://(?<c>[a-z]{2})\\.linkedin") .c? // "www")
    )
    | map(select(.jobs >= $min))
    | sort_by(-.score, -.jobs)
  ' "$RANKED" > "$SCORED"

  echo
  jq -r 'group_by(.verdict) | map("\(.[0].verdict): \(length)") | .[]' "$SCORED"
  echo
  echo "TOP 30 by score then volume:"
  jq -r '.[0:30][] | "  \(.jobs)\t\(.verdict)\t\(.name)\t\(.title[0:55])"' "$SCORED" \
    | column -t -s $'\t'
  echo
  echo "-> $SCORED"
  echo "   Next: ./classify_recruiters.sh enrich   (confirms titles against live profiles)"
}

enrich () {
  [[ -s "$SCORED" ]] || { echo "Run 'score' first"; exit 1; }

  # Only enrich plausible candidates — no point paying for the obvious managers
  local URLS N
  URLS=$(jq -c '[.[] | select(.verdict != "probably-hiring-manager") | .url]' "$SCORED")
  N=$(echo "$URLS" | jq 'length')
  echo "==> enriching $N candidates (~\$$(echo "scale=2; $N * 0.005" | bc))"
  read -rp "    proceed? [y/N] " OK
  [[ "$OK" == "y" ]] || exit 0

  local RUN RUN_ID DATASET_ID STATUS
  RUN=$(curl -sS -X POST \
    "https://api.apify.com/v2/acts/apimaestro~linkedin-profile-batch-scraper-no-cookies-required/runs?token=${APIFY_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --argjson u "$URLS" '{usernames: $u, includeEmail: false}')")

  RUN_ID=$(echo "$RUN" | jq -r '.data.id // "null"')
  DATASET_ID=$(echo "$RUN" | jq -r '.data.defaultDatasetId // "null"')
  [[ "$RUN_ID" == "null" ]] && { echo "FAILED:"; echo "$RUN" | jq .; exit 1; }
  echo "    run $RUN_ID"

  while :; do
    STATUS=$(curl -sS "https://api.apify.com/v2/actor-runs/${RUN_ID}?token=${APIFY_TOKEN}" | jq -r '.data.status')
    [[ "$STATUS" == "RUNNING" || "$STATUS" == "READY" ]] || break
    sleep 20
  done

  curl -sS "https://api.apify.com/v2/datasets/${DATASET_ID}/items?token=${APIFY_TOKEN}&clean=true&format=json" \
    > "$ENRICHED"
  echo "    $STATUS — $(jq 'length' "$ENRICHED") profiles"
  echo
  echo "Field names in the enrichment output:"
  jq -r '.[0] | keys | join(", ")' "$ENRICHED"
  echo
  echo "   Next: ./classify_recruiters.sh final"
}

final () {
  [[ -s "$ENRICHED" ]] || { echo "Run 'enrich' first"; exit 1; }
  echo "==> joining enrichment onto scored list"

  jq -s '
    def slug: (. | ascii_downcase | split("?")[0] | sub("/$";"") | split("/") | last);
    def liveTitle:
      (.headline
       // .position
       // (.experience[0]?.title)
       // (.experiences[0]?.title)
       // "");

    .[0] as $scored | .[1] as $enr
    | ($enr | map({ key: ((.username // .publicIdentifier // .linkedinUrl // .url // "") | slug),
                    value: liveTitle }) | from_entries) as $lookup
    | $scored
    | map(.live_title = ($lookup[(.url | slug)] // ""))
    | map(.confirmed = (
        if (.live_title | test("(?i)(recruit|rekrut|talent|sourc|headhunt|personalberat|personalvermittl|staffing|executive search|resourcing)"))
        then "yes"
        elif (.live_title == "") then "unknown"
        else "no" end))
    | sort_by(-.jobs)
  ' "$SCORED" "$ENRICHED" > "${OUT_DIR}/recruiters_final.json"

  jq -r '["rank","jobs_posted","name","poster_title","live_title","confirmed","verdict","score","country","companies","url"],
    (to_entries[] | [
      (.key+1), .value.jobs, .value.name, .value.title, .value.live_title,
      .value.confirmed, .value.verdict, .value.score, .value.country,
      (.value.companies | join(" | ")), .value.url
    ]) | @csv' "${OUT_DIR}/recruiters_final.json" > "${OUT_DIR}/recruiters_final.csv"

  echo
  jq -r 'group_by(.confirmed) | map("confirmed=\(.[0].confirmed): \(length)") | .[]' \
    "${OUT_DIR}/recruiters_final.json"
  echo
  echo "TOP 30 confirmed recruiters:"
  jq -r '[.[] | select(.confirmed == "yes")] | .[0:30][] | "  \(.jobs)\t\(.name)\t\(.live_title[0:60])"' \
    "${OUT_DIR}/recruiters_final.json" | column -t -s $'\t'
  echo
  echo "-> ${OUT_DIR}/recruiters_final.csv"
}

case "${1:-score}" in
  score)  score ;;
  enrich) enrich ;;
  final)  final ;;
  *) echo "Usage: $0 [score|enrich|final]"; exit 1 ;;
esac