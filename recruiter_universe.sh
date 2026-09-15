#!/usr/bin/env bash
# Build a monitoring list of recruiters in German-speaking Switzerland, then
# discover who actually posts by checking a batch of them each day.
#
#   ./recruiter_universe.sh list     # build the universe        (~$4 per 1000)
#   ./recruiter_universe.sh batch    # check today's slice       (~$0.50/day)
#   ./recruiter_universe.sh score    # rank by observed activity (free)
#
# The idea: don't pay to measure everyone's posting frequency up front. Get the
# names cheaply, then sample a rotating batch daily. After a month every person
# has been checked ~1x/week and the regulars separate themselves.
set -euo pipefail

: "${APIFY_TOKEN:?Set APIFY_TOKEN first: export APIFY_TOKEN=apify_api_xxx}"

SEARCH_ACTOR="harvestapi~linkedin-profile-search"
POSTS_ACTOR="harvestapi~linkedin-profile-posts"
OUT="./recruiters"; RAW="${OUT}/raw"; OBS="${OUT}/observations"
mkdir -p "$RAW" "$OBS"

PER_SLICE="${PER_SLICE:-100}"        # profiles per city x cluster slice
BATCH_SIZE="${BATCH_SIZE:-100}"      # people to check per day
POSTS_PER="${POSTS_PER:-5}"          # posts to pull per person per check
LOOKBACK="${LOOKBACK:-week}"         # any|24h|week|month

CITIES=(
  "Zurich, Switzerland"      "Basel, Switzerland"       "Bern, Switzerland"
  "Zug, Switzerland"         "Lucerne, Switzerland"  "Thurgau, Switzerland"
  "Schaffhausen, Switzerland"
)
CLUSTERS=(agency inhouse generic)
C_agency='["Personalberater","Personalberaterin","Personalvermittler","Recruitment Consultant","Executive Search","Headhunter","Personalberatung"]'
C_inhouse='["Talent Acquisition","Talent Acquisition Partner","Talent Acquisition Manager","Talent Sourcer","Talent Partner"]'
C_generic='["Recruiter","Senior Recruiter","Technical Recruiter","IT Recruiter","Recruiting Manager","Leiter Recruiting"]'

fire () {   # $1=actor $2=input $3=dest
  local RUN RUN_ID DS STATUS
  RUN=$(curl -sS -X POST "https://api.apify.com/v2/acts/$1/runs?token=${APIFY_TOKEN}" \
        -H 'Content-Type: application/json' -d "$2")
  RUN_ID=$(echo "$RUN" | jq -r '.data.id // "null"')
  DS=$(echo "$RUN" | jq -r '.data.defaultDatasetId // "null"')
  [[ "$RUN_ID" == "null" ]] && { echo "  FAILED:"; echo "$RUN" | jq .; return 1; }
  while :; do
    STATUS=$(curl -sS "https://api.apify.com/v2/actor-runs/${RUN_ID}?token=${APIFY_TOKEN}" | jq -r '.data.status')
    [[ "$STATUS" == "RUNNING" || "$STATUS" == "READY" ]] || break
    sleep 20
  done
  curl -sS "https://api.apify.com/v2/datasets/${DS}/items?token=${APIFY_TOKEN}&clean=true&format=json" > "$3"
  echo "  $STATUS — $(jq 'length' "$3") items  (run $RUN_ID)"
}

# ---- stage 1: build the universe ----------------------------------------
list () {
  local SLICES=$(( ${#CITIES[@]} * ${#CLUSTERS[@]} ))
  echo "==> $SLICES slices x $PER_SLICE profiles"
  echo "    ceiling: $(( SLICES * PER_SLICE )) profiles = \$$(echo "scale=2; $SLICES * $PER_SLICE * 0.004" | bc) (before dedup)"
  read -rp "    proceed? [y/N] " OK; [[ "$OK" == "y" ]] || exit 0

  for CITY in "${CITIES[@]}"; do
    local CSLUG; CSLUG=$(echo "$CITY" | sed 's/, Switzerland//' | tr '[:upper:] .' '[:lower:]__' | tr -s '_')
    for CL in "${CLUSTERS[@]}"; do
      local VAR="C_${CL}" DEST="${RAW}/${CSLUG}__${CL}.json"
      [[ -s "$DEST" ]] && { echo "==> ${CSLUG}/${CL} (cached)"; continue; }
      echo "==> ${CSLUG}/${CL}"
      fire "$SEARCH_ACTOR" "$(jq -n \
        --argjson t "${!VAR}" --arg c "$CITY" --argjson m "$PER_SLICE" \
        '{profileScraperMode:"Short", currentJobTitles:$t, locations:[$c],
          maxItems:$m, takePages:100, autoQuerySegmentation:true}')" \
        "$DEST" || true
    done
  done
  consolidate
}

consolidate () {
  echo; echo "==> consolidating"
  jq -s '
    def k: (.linkedinUrl // .id // "" | ascii_downcase | split("?")[0] | sub("/$";""));
    add | map(select(k != "")) | unique_by(k)
    | map({
        name:     ((.firstName // "") + " " + (.lastName // "")),
        title:    (.currentPositions[0]?.title // ""),
        company:  (.currentPositions[0]?.companyName // ""),
        location: (.location.linkedinText // ""),
        url:      (.linkedinUrl // "")
      })
    | sort_by(.name)
  ' "${RAW}"/*.json > "${OUT}/universe.json"

  jq -r '["name","title","company","location","url"],
    (.[] | [.name,.title,.company,.location,.url]) | @csv' \
    "${OUT}/universe.json" > "${OUT}/universe.csv"
  echo "    $(jq 'length' "${OUT}/universe.json") unique recruiters"
  echo "    -> ${OUT}/universe.csv"
  echo "    Next: ./recruiter_universe.sh batch   (checks $BATCH_SIZE/day)"
}

# ---- stage 2: check one rotating batch per day ---------------------------
batch () {
  [[ -s "${OUT}/universe.json" ]] || { echo "Run 'list' first"; exit 1; }
  local TOTAL DAY OFFSET URLS TODAY
  TOTAL=$(jq 'length' "${OUT}/universe.json")
  TODAY=$(date +%Y%m%d)
  [[ -s "${OBS}/${TODAY}.json" ]] && { echo "Already ran today"; exit 0; }

  # rotate through the list so everyone gets checked every TOTAL/BATCH_SIZE days
  DAY=$(( $(date +%s) / 86400 ))
  OFFSET=$(( (DAY * BATCH_SIZE) % TOTAL ))
  URLS=$(jq -c --argjson o "$OFFSET" --argjson n "$BATCH_SIZE" \
         '[.[$o:($o+$n)][].url]' "${OUT}/universe.json")

  echo "==> checking $(echo "$URLS" | jq 'length') of $TOTAL (offset $OFFSET), lookback=$LOOKBACK"
  echo "    ~\$$(echo "scale=2; $BATCH_SIZE * $POSTS_PER * 0.0015" | bc)"

  fire "$POSTS_ACTOR" "$(jq -n --argjson u "$URLS" --arg w "$LOOKBACK" --argjson p "$POSTS_PER" \
    '{targetUrls:$u, postedLimit:$w, maxPosts:$p, includeReposts:true, includeQuotePosts:true, scrapeReactions:false}')" \
    "${OBS}/${TODAY}_raw.json"

  # record one observation row per person checked: did they post hiring content?
  jq -s --argjson urls "$URLS" '
    def k: (. // "" | ascii_downcase | split("?")[0] | sub("/$";""));
    def hiring: (((.content // "") | ascii_downcase)
      | test("hiring|wir suchen|we.re hiring|join (our|the) team|offene stelle|stellenangebot|verst(ä|ae)rkung|looking to hire|apply now|bewerb|vacancy|open (position|role)|stellen|#job"));
    (.[0] | group_by(.author.linkedinUrl | k)
          | map({key: (.[0].author.linkedinUrl | k),
                 value: {posts: length, hiring: (map(select(hiring)) | length)}})
          | from_entries) as $h
    | $urls | map({ url: ., k: (. | k) })
    | map({ url: .url,
            posts:  ($h[.k].posts  // 0),
            hiring: ($h[.k].hiring // 0) })
  ' "${OBS}/${TODAY}_raw.json" > "${OBS}/${TODAY}.json"

  echo "    checked: $(jq 'length' "${OBS}/${TODAY}.json")"
  echo "    posted anything: $(jq '[.[]|select(.posts>0)]|length' "${OBS}/${TODAY}.json")"
  echo "    posted hiring:   $(jq '[.[]|select(.hiring>0)]|length' "${OBS}/${TODAY}.json")"
  score
}

# ---- stage 3: rank by what we've observed so far -------------------------
score () {
  ls "${OBS}"/2*.json >/dev/null 2>&1 || { echo "No observations yet"; exit 0; }
  echo; echo "==> scoring across $(ls "${OBS}"/2*[0-9].json 2>/dev/null | wc -l | tr -d ' ') days of observations"

  jq -s '
    def k: (. // "" | ascii_downcase | split("?")[0] | sub("/$";""));
    (.[0]) as $uni
    | (.[1:] | add
       | group_by(.url | k)
       | map({key: (.[0].url | k),
              value: {checks: length,
                      hits:   (map(select(.hiring > 0)) | length),
                      posts:  (map(.hiring) | add)}})
       | from_entries) as $o
    | $uni
    | map(.k = (.url | k))
    | map(.checks       = ($o[.k].checks // 0)
        | .hiring_hits  = ($o[.k].hits   // 0)
        | .hiring_posts = ($o[.k].posts  // 0))
    | map(.hit_rate = (if .checks > 0 then (.hiring_hits / .checks) else 0 end))
    | map(.intent = (if .checks == 0 then "unchecked"
                     elif .hit_rate >= 0.5 then "high"
                     elif .hit_rate > 0    then "medium"
                     else "low" end))
    | map(del(.k))
    | sort_by(-.hiring_posts, -.hit_rate)
  ' "${OUT}/universe.json" "${OBS}"/2*[0-9].json > "${OUT}/scored.json"

  jq -r '["intent","hiring_posts","checks","hit_rate","name","title","company","location","url"],
    (.[] | [.intent,.hiring_posts,.checks,(.hit_rate*100|floor),.name,.title,.company,.location,.url])
    | @csv' "${OUT}/scored.json" > "${OUT}/scored.csv"

  jq -r 'group_by(.intent) | map("    \(.[0].intent): \(length)") | .[]' "${OUT}/scored.json"
  echo
  echo "TOP 20 OBSERVED:"
  jq -r '[.[]|select(.checks>0)] | .[0:20][] | "  \(.hiring_posts)/\(.checks)\t\(.name)\t\(.title[0:40])"' \
    "${OUT}/scored.json" | column -t -s $'\t'
  echo
  echo "-> ${OUT}/scored.csv"
}

case "${1:-list}" in
  list) list ;; consolidate) consolidate ;; batch) batch ;; score) score ;;
  *) echo "Usage: $0 [list|batch|score]"; exit 1 ;;
esac