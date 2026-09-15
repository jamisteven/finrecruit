#!/usr/bin/env bash
# Find the handful of Swiss recruiters who post hiring content DAILY.
#
# Method: sweep one week of Swiss hiring posts at near-complete coverage.
# A daily poster shows up 5-7x in a single week; an occasional poster shows up
# 0-1x. Frequency separates itself inside a short window -- which a 3-month
# window at 5% coverage can never do, because everyone lands on 1.
#
#   ./find_pros.sh week      # sweep the last 7 days      (~$4)
#   ./find_pros.sh pros      # rank by hits-per-week      (free)
#   ./find_pros.sh enrich    # followers + location       (~$0.50)
#
# Run `week` every Monday. Two or three weeks of data separates the true
# regulars from someone who had one busy week.
set -euo pipefail

: "${APIFY_TOKEN:?Set APIFY_TOKEN first}"

POST_ACTOR="harvestapi~linkedin-post-search"
PROF_ACTOR="apimaestro~linkedin-profile-batch-scraper-no-cookies-required"
OUT="./pros"; WK="${OUT}/weeks"
mkdir -p "$WK"

PER_QUERY="${PER_QUERY:-250}"
MIN_HITS="${MIN_HITS:-3}"        # hits in a single week to count as a pro

# Few, broad queries. With a 7-day window each one can reach deep into the
# week's posts, and overlap between them is what gives near-complete coverage.
QUERIES=(
  "hiring Switzerland"    "hiring Schweiz"        "wir suchen Schweiz"
  "offene Stelle Schweiz" "we are hiring Zürich"  "Stellenangebot Schweiz"
  "join our team Schweiz" "Verstärkung gesucht"
)

fire () {
  local RUN RUN_ID DS STATUS
  RUN=$(curl -sS -X POST "https://api.apify.com/v2/acts/$1/runs?token=${APIFY_TOKEN}" \
        -H 'Content-Type: application/json' -d "$2")
  RUN_ID=$(echo "$RUN" | jq -r '.data.id // "null"')
  DS=$(echo "$RUN" | jq -r '.data.defaultDatasetId // "null"')
  [[ "$RUN_ID" == "null" ]] && { echo "  FAILED:"; echo "$RUN" | jq .; return 1; }
  echo "  run $RUN_ID | https://console.apify.com/actors/runs/$RUN_ID"
  while :; do
    STATUS=$(curl -sS "https://api.apify.com/v2/actor-runs/${RUN_ID}?token=${APIFY_TOKEN}" | jq -r '.data.status')
    [[ "$STATUS" == "RUNNING" || "$STATUS" == "READY" ]] || break
    sleep 30
  done
  curl -sS "https://api.apify.com/v2/datasets/${DS}/items?token=${APIFY_TOKEN}&clean=true&format=json" > "$3"
  echo "  $STATUS — $(jq 'length' "$3") posts"
}

week () {
  local TAG="w$(date +%Y%m%d)" DEST
  DEST="${WK}/${TAG}.json"
  [[ -s "$DEST" ]] && { echo "Already swept this week ($TAG)"; pros; exit 0; }

  echo "==> sweeping 7 days: ${#QUERIES[@]} queries x ${PER_QUERY} posts"
  echo "    ceiling \$$(echo "scale=2; ${#QUERIES[@]} * $PER_QUERY * 0.002" | bc)"
  read -rp "    proceed? [y/N] " OK; [[ "$OK" == "y" ]] || exit 0

  fire "$POST_ACTOR" "$(jq -n \
    --argjson q "$(printf '%s\n' "${QUERIES[@]}" | jq -R . | jq -s .)" \
    --argjson m "$PER_QUERY" \
    '{searchQueries:$q, postedLimit:"week", sortBy:"date", maxPosts:$m, profileScraperMode:"short"}')" \
    "$DEST"
  pros
}

pros () {
  ls "${WK}"/w*.json >/dev/null 2>&1 || { echo "No weeks swept yet"; exit 1; }
  local WEEKS; WEEKS=$(ls "${WK}"/w*.json | wc -l | tr -d ' ')
  echo; echo "==> ranking across $WEEKS week(s)"

  # Score each week separately, then combine: what matters is hits-PER-WEEK,
  # not a total that a single busy week could inflate.
  for F in "${WK}"/w*.json; do
    jq '
      def akey: (.author.linkedinUrl // "" | ascii_downcase | split("?")[0] | sub("/$";""));
      def text: ((.content // "") | ascii_downcase);
      def hiring: (text | test("hiring|wir suchen|we.re hiring|join (our|the) team|offene stelle|stellenangebot|verst(ä|ae)rkung|looking to hire|apply now|bewerb|vacancy|open (position|role)|#job"));
      def swiss:  (text | test("schweiz|switzerland|suisse|z(ü|ue)rich|\\bchf\\b|pensum|kanton|\\bch-[0-9]{4}\\b|winterthur|luzern|st\\. ?gallen|aargau|basel|\\bbern\\b|zug\\b|genf|lausanne"));
      def seeker: (text | test("open to work|#opentowork|looking for (a |an |my )?(new )?(opportunit|role|position|job)|auf jobsuche"));
      def botname: ((.author.name // "") | ascii_downcase | test("\\bjobs?$|job alert|vacancies|stellenb(ö|oe)rse"));

      unique_by(.linkedinUrl)
      | map(select(akey != "" and hiring and swiss and (seeker|not) and (botname|not)))
      | map(select(akey | test("/in/")))          # people, not company pages
      | group_by(akey)
      | map({url: (.[0].author.linkedinUrl | split("?")[0]),
             name: (.[0].author.name // ""),
             headline: (.[0].author.headline // ""),
             hits: length})
    ' "$F"
  done | jq -s '
    add
    | group_by(.url | ascii_downcase | sub("/$";""))
    | map({
        name:      (.[0].name),
        headline:  (.[0].headline),
        weeks:     length,
        best_week: (map(.hits) | max),
        avg_week:  ((map(.hits) | add) / length | floor),
        total:     (map(.hits) | add),
        url:       (.[0].url)
      })
    | sort_by(-.avg_week, -.best_week)
  ' > "${OUT}/pros.json"

  jq -r '["avg_per_week","best_week","weeks_seen","total_posts","name","headline","url"],
    (.[] | [.avg_week,.best_week,.weeks,.total,.name,.headline,.url]) | @csv' \
    "${OUT}/pros.json" > "${OUT}/pros.csv"

  echo "    $(jq 'length' "${OUT}/pros.json") people posting hiring content"
  echo "    $(jq --argjson m "$MIN_HITS" '[.[]|select(.best_week>=$m)]|length' "${OUT}/pros.json") hit ${MIN_HITS}+ in a single week  <- the pros"
  echo
  echo "TOP 40 (avg posts/week):"
  jq -r '.[0:40][] | "  \(.avg_week)/wk\t\(.best_week) best\t\(.name)\t\(.headline[0:45])"' \
    "${OUT}/pros.json" | column -t -s $'\t'
  echo
  echo "-> ${OUT}/pros.csv"
}

enrich () {
  [[ -s "${OUT}/pros.json" ]] || { echo "Run 'pros' first"; exit 1; }
  local URLS N
  URLS=$(jq -c --argjson m "$MIN_HITS" '[.[] | select(.best_week >= $m) | .url]' "${OUT}/pros.json")
  N=$(echo "$URLS" | jq 'length')
  (( N == 0 )) && { echo "Nobody cleared MIN_HITS=$MIN_HITS. Try MIN_HITS=2"; exit 1; }
  echo "==> enriching $N pros (~\$$(echo "scale=2; $N * 0.005" | bc)) for followers + location"
  read -rp "    proceed? [y/N] " OK; [[ "$OK" == "y" ]] || exit 0

  fire "$PROF_ACTOR" "$(jq -n --argjson u "$URLS" '{usernames:$u, includeEmail:false}')" \
    "${OUT}/enrich.json"

  jq -s '
    def txt:  (if . == null then "" else tostring end);
    def slug: (txt | ascii_downcase | split("?")[0] | sub("/$";"") | split("/") | last);
    def flat: (if type=="object" then (.full // .city // .country // "") else . end | txt);
    def prof: (.basic_info // .);
    .[0] as $p | .[1] as $e
    | ($e | map({key: ((prof.public_identifier // prof.publicIdentifier // .profileUrl // "") | slug),
                 value: {loc: (prof.location | flat),
                         hl:  ((prof.headline // "") | txt),
                         fol: (prof.follower_count // prof.followers // prof.connection_count // 0)}})
         | map(select(.key != "")) | from_entries) as $lk
    | $p | map(.e = ($lk[(.url|slug)] // null))
    | map(.location = ((.e.loc // "") | txt) | .followers = (.e.fol // 0)
        | .headline = ((.e.hl // .headline // "") | txt))
    | map(del(.e))
    | sort_by(-.avg_week, -.followers)
  ' "${OUT}/pros.json" "${OUT}/enrich.json" > "${OUT}/pros_final.json"

  jq -r '["avg_per_week","best_week","weeks_seen","followers","name","headline","location","url"],
    (.[] | [.avg_week,.best_week,.weeks,.followers,.name,.headline,.location,.url]) | @csv' \
    "${OUT}/pros_final.json" > "${OUT}/pros_final.csv"

  echo; echo "THE LIST:"
  jq -r '.[] | "  \(.avg_week)/wk\t\(.followers) foll\t\(.name)\t\(.location[0:22])\t\(.url)"' \
    "${OUT}/pros_final.json" | column -t -s $'\t'
  echo; echo "-> ${OUT}/pros_final.csv"
}

case "${1:-week}" in
  week) week ;; pros) pros ;; enrich) enrich ;;
  *) echo "Usage: $0 [week|pros|enrich]"; exit 1 ;;
esac