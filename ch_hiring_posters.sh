#!/usr/bin/env bash
# Find people who CONSISTENTLY post hiring content to the LinkedIn feed
# in German-speaking Switzerland.
#
#   ./ch_hiring_posters.sh search   # scrape feed posts        (~$2 per 1k posts)
#   ./ch_hiring_posters.sh rank     # filter + rank            (free, re-runnable)
#   ./ch_hiring_posters.sh enrich   # confirm location/title   (~$5 per 1k)
#   ./ch_hiring_posters.sh final    # Swiss-only final list    (free)
set -euo pipefail

: "${APIFY_TOKEN:?Set APIFY_TOKEN first: export APIFY_TOKEN=apify_api_xxx}"

POST_ACTOR="harvestapi~linkedin-post-search"
PROF_ACTOR="apimaestro~linkedin-profile-batch-scraper-no-cookies-required"
OUT="./ch_posters"; RAW="${OUT}/raw"
mkdir -p "$RAW"

WINDOW="${WINDOW:-3months}"
MIN_POSTS="${MIN_POSTS:-2}"          # below this it isn't "consistent"
ENRICH_TOP="${ENRICH_TOP:-400}"

# TIER controls spend. Start small; only scale if the small run looks right.
#   small  ~1.2k posts  ~$2.40   <- default
#   medium ~4.8k posts  ~$9.60
#   large  ~31k posts   ~$63
TIER="${TIER:-small}"

case "$TIER" in
  small)
    # No bare "hiring" (matches globally) and no bare "Basel" (an Arabic given
    # name). Every query pairs hiring language with an unambiguous Swiss token.
    PHRASES=( "wir suchen" "offene Stelle" "we are hiring" "join our team" )
    GEOS=( "Zürich" "Schweiz" "Switzerland" )
    MAX_PER_QUERY="${MAX_PER_QUERY:-100}" ;;
  medium)
    PHRASES=( "wir suchen" "offene Stelle" "Verstärkung gesucht" "Stellenangebot"
              "we are hiring" "join our team" "looking to hire" "neue Stelle" )
    GEOS=( "Zürich" "Schweiz" "Switzerland" "Kanton" )
    MAX_PER_QUERY="${MAX_PER_QUERY:-150}" ;;
  large)
    PHRASES=( "wir suchen" "wir stellen ein" "offene Stelle" "Verstärkung gesucht"
              "neue Stelle" "Stellenangebot" "Job frei" "wir suchen Verstärkung"
              "hiring" "we are hiring" "join our team" "open position"
              "looking to hire" "new role" "now hiring" )
    GEOS=( "Zürich" "Schweiz" "Basel" "Bern" "Zug" "Luzern" "Switzerland" )
    MAX_PER_QUERY="${MAX_PER_QUERY:-300}" ;;
  *) echo "TIER must be small|medium|large"; exit 1 ;;
esac

fire () {   # $1=actor $2=input $3=dest
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
  echo "  $STATUS — $(jq 'length' "$3") items"
}

search () {
  local QUERIES=()
  for P in "${PHRASES[@]}"; do for G in "${GEOS[@]}"; do QUERIES+=("$P $G"); done; done
  echo "==> TIER=$TIER — ${#QUERIES[@]} queries x ${MAX_PER_QUERY} posts, window=${WINDOW}"
  echo "    ceiling: $(( ${#QUERIES[@]} * MAX_PER_QUERY )) posts = \$$(echo "scale=2; ${#QUERIES[@]} * $MAX_PER_QUERY * 0.002" | bc)"
  echo "    (queries overlap heavily, so actual is usually well under this)"
  read -rp "    proceed? [y/N] " OK; [[ "$OK" == "y" ]] || exit 0

  fire "$POST_ACTOR" "$(jq -n \
    --argjson q "$(printf '%s\n' "${QUERIES[@]}" | jq -R . | jq -s .)" \
    --arg w "$WINDOW" --argjson m "$MAX_PER_QUERY" \
    '{searchQueries:$q, postedLimit:$w, sortBy:"date", maxPosts:$m, profileScraperMode:"short"}')" \
    "${RAW}/posts_$(date +%Y%m%d).json"
  rank
}

rank () {
  echo; echo "==> filtering + ranking"
  jq -s '
    def akey: (.author.linkedinUrl // "" | ascii_downcase | split("?")[0] | sub("/$";""));
    def day:  ((.postedAt.date // .postedAt // "") | tostring | .[0:10]);
    def text: ((.content // "") | ascii_downcase);

    # must actually be hiring, in DE or EN
    def hiring: (text | test("hiring|wir suchen|we.re hiring|join (our|the) team|offene stelle|stellenangebot|verst(ä|ae)rkung|looking to hire|apply now|bewerb|vacancy|open (position|role)"));
    # job seekers are the exact inverse of the target
    def seeker: (text | test("open to work|#opentowork|looking for (a |an |my )?(new )?(opportunit|role|position|job)|seeking (a )?(new )?(role|position|opportunit)|i am available|auf jobsuche|suche eine (neue )?(stelle|herausforderung)"));
    # generic engagement-bait listicles that match on a stray keyword
    def listicle: (text | test("startups that recently became unicorns|i curated a list|companies i have my eyes on"));

    # HARD Swiss requirement. "Basel" alone is an Arabic given name and "Zurich"
    # is an insurance company, so those do not count on their own -- the post
    # must carry a marker that is unambiguously Swiss.
    def swiss: (text | test("schweiz|switzerland|suisse|svizzera|z(ü|ue)rich|\\bchf\\b|pensum|kanton|\\bch-[0-9]{4}\\b|winterthur|luzern|lucerne|st\\. ?gallen|aargau|basel-(stadt|land)|genf|\\bbern\\b|zug\\b"));

    # job-board bot accounts: "Seattle jobs", "North Sydney jobs", "XYZ Job Alerts"
    def botname: ((.author.name // "") | ascii_downcase
                  | test("\\bjobs?$|\\bjobs\\b.*\\b(board|alert|feed)|job alert|vacancies|stellenb(ö|oe)rse"));

    add
    | unique_by(.linkedinUrl)
    | map(select(akey != ""))
    | map(select(hiring and swiss and (seeker | not) and (listicle | not) and (botname | not)))
    | map(.is_company = (akey | test("/company/")))
    | group_by(akey)
    | map({
        name:        (.[0].author.name // ""),
        headline:    (.[0].author.headline // .[0].author.position // ""),
        is_company:  .[0].is_company,
        posts:       length,
        active_days: (map(day) | map(select(. != "")) | unique | length),
        first_seen:  (map(day) | map(select(. != "")) | min),
        last_seen:   (map(day) | map(select(. != "")) | max),
        sample:      ((.[0].content // "") | gsub("\\s+";" ") | .[0:140]),
        url:         (.[0].author.linkedinUrl // "" | split("?")[0])
      })
    | map(.consistency = (.active_days * 2 + .posts))
    | sort_by(-.consistency, -.posts)
  ' "${RAW}"/*.json > "${OUT}/all_authors.json"

  jq '[.[] | select(.is_company | not)]' "${OUT}/all_authors.json" > "${OUT}/people.json"
  jq '[.[] | select(.is_company)]'       "${OUT}/all_authors.json" > "${OUT}/company_pages.json"

  echo "    people:        $(jq 'length' "${OUT}/people.json")"
  echo "    company pages: $(jq 'length' "${OUT}/company_pages.json")  (-> company_pages.json)"
  echo "    people with ${MIN_POSTS}+ posts: $(jq --argjson m "$MIN_POSTS" '[.[]|select(.posts>=$m)]|length' "${OUT}/people.json")"
  echo
  echo "TOP 30 PEOPLE (posts/active-days):"
  jq -r '.[0:30][] | "  \(.posts)p/\(.active_days)d\t\(.name)\t\(.headline[0:55])"' \
    "${OUT}/people.json" | column -t -s $'\t'
  echo
  echo "   Next: ./ch_hiring_posters.sh enrich   (confirms who is actually in Switzerland)"
}

enrich () {
  [[ -s "${OUT}/people.json" ]] || { echo "Run 'rank' first"; exit 1; }
  local URLS N
  URLS=$(jq -c --argjson m "$MIN_POSTS" --argjson n "$ENRICH_TOP" \
         '[.[] | select(.posts >= $m)] | .[0:$n] | map(.url)' "${OUT}/people.json")
  N=$(echo "$URLS" | jq 'length')
  echo "==> enriching $N people (~\$$(echo "scale=2; $N * 0.005" | bc)) to confirm location"
  read -rp "    proceed? [y/N] " OK; [[ "$OK" == "y" ]] || exit 0
  fire "$PROF_ACTOR" "$(jq -n --argjson u "$URLS" '{usernames:$u, includeEmail:false}')" \
    "${OUT}/enrich_raw.json"
  echo; echo "field names:"; jq -r '.[0] | keys | join(", ")' "${OUT}/enrich_raw.json"
  final
}

final () {
  [[ -s "${OUT}/enrich_raw.json" ]] || { echo "Run 'enrich' first"; exit 1; }
  echo; echo "==> Swiss-only final list"
  # This actor nests the profile under `basic_info`; everything below is
  # null-safe because any of these fields can be missing on a given profile.
  jq -s '
    def txt:  (if . == null then "" else tostring end);
    def slug: (txt | ascii_downcase | split("?")[0] | sub("/$";"") | split("/") | last);
    def flat: (if type == "object" then (.full // .city // .country // "") else . end | txt);

    def prof: (.basic_info // .);
    def loc:  ((prof.location // prof.geo // prof.addressWithCountry // .location // "") | flat);
    def hl:   ((prof.headline // prof.title // prof.occupation
                // (.experience[0]?.title) // "") | txt);
    def pid:  ((prof.public_identifier // prof.publicIdentifier // prof.username
                // .profileUrl // .linkedinUrl // .url // "") | slug);

    .[0] as $ppl | .[1] as $enr
    | ($enr | map({key: pid, value: {loc: loc, hl: hl}})
            | map(select(.key != "")) | from_entries) as $lk
    | $ppl
    | map(.e = ($lk[(.url | slug)] // null))
    | map(.live_location = ((.e.loc // "") | txt))
    | map(.live_headline = ((.e.hl // .headline // "") | txt))
    | map(.swiss = (.live_location | test("(?i)(switzerland|schweiz|suisse|svizzera|z(ü|u)rich|basel|bern|geneva|gen(è|e)ve|lausanne|zug|luzern|lucerne|st\\.? ?gallen|winterthur|lugano|aargau|thurgau|solothurn|chur)")))
    | map(.is_recruiter = (.live_headline | test("(?i)(recruit|rekrut|talent|sourc|headhunt|personalberat|personalvermittl|staffing|executive search|resourcing|\\bhr\\b|human resources|people)")))
    | map(del(.e))
    | map(select(.swiss))
    | sort_by(-.consistency, -.posts)
  ' "${OUT}/people.json" "${OUT}/enrich_raw.json" > "${OUT}/final.json"

  # If nothing joined, the field guesses are wrong — show the real structure.
  if [[ "$(jq 'length' "${OUT}/final.json")" == "0" ]]; then
    echo "    !! nothing matched. Actual structure of basic_info:"
    jq -r '.[0].basic_info | keys | join(", ")' "${OUT}/enrich_raw.json" 2>/dev/null || true
    jq '.[0].basic_info' "${OUT}/enrich_raw.json" 2>/dev/null | head -30
  fi

  jq -r '["rank","posts","active_days","first_seen","last_seen","name","headline","location","is_recruiter","url","sample"],
    (to_entries[] | [(.key+1), .value.posts, .value.active_days, .value.first_seen,
      .value.last_seen, .value.name, .value.live_headline, .value.live_location,
      .value.is_recruiter, .value.url, .value.sample]) | @csv' \
    "${OUT}/final.json" > "${OUT}/final.csv"

  echo "    $(jq 'length' "${OUT}/final.json") confirmed in Switzerland"
  echo "    $(jq '[.[]|select(.is_recruiter)]|length' "${OUT}/final.json") with a recruiter/HR headline"
  echo
  echo "TOP 40:"
  jq -r '.[0:40][] | "  \(.posts)p/\(.active_days)d\t\(.name)\t\(.live_headline[0:45])\t\(.live_location[0:20])"' \
    "${OUT}/final.json" | column -t -s $'\t'
  echo
  echo "-> ${OUT}/final.csv"
}

# --- stage 5: exact post counts for the confirmed Swiss candidates --------
# Sampling the whole feed to count everyone is expensive and still approximate.
# Instead: take the people the sample already proved post hiring content, and
# pull their ACTUAL post history. Enumeration, not sampling.
count () {
  [[ -s "${OUT}/final.json" ]] || { echo "Run 'enrich' first"; exit 1; }
  local COUNT_TOP="${COUNT_TOP:-200}" PER="${MAX_POSTS_PER_PERSON:-40}"
  local ONLY_RECRUITERS="${ONLY_RECRUITERS:-1}"

  local URLS N
  URLS=$(jq -c --argjson n "$COUNT_TOP" --argjson r "$ONLY_RECRUITERS" \
    '[.[] | select($r == 0 or .is_recruiter)] | .[0:$n] | map(.url)' "${OUT}/final.json")
  N=$(echo "$URLS" | jq 'length')
  (( N == 0 )) && { echo "No candidates. Try ONLY_RECRUITERS=0"; exit 1; }

  echo "==> pulling real post history for $N people (up to $PER posts each, $WINDOW)"
  echo "    ceiling: $(( N * PER )) posts = \$$(echo "scale=2; $N * $PER * 0.0015" | bc)"
  read -rp "    proceed? [y/N] " OK; [[ "$OK" == "y" ]] || exit 0

  fire "harvestapi~linkedin-profile-posts" "$(jq -n \
    --argjson u "$URLS" --arg w "$WINDOW" --argjson p "$PER" \
    '{targetUrls:$u, postedLimit:$w, maxPosts:$p, includeReposts:false, scrapeReactions:false}')" \
    "${OUT}/history_raw.json"

  echo; echo "==> counting hiring posts per person"
  jq -s '
    def akey: (.author.linkedinUrl // "" | ascii_downcase | split("?")[0] | sub("/$";""));
    def day:  ((.postedAt.date // .postedAt // "") | tostring | .[0:10]);
    def text: ((.content // "") | ascii_downcase);
    def hiring: (text | test("hiring|wir suchen|we.re hiring|join (our|the) team|offene stelle|stellenangebot|verst(ä|ae)rkung|looking to hire|apply now|bewerb|vacancy|open (position|role)|stellen"));

    .[0] as $ppl | .[1] as $hist
    | ($hist | unique_by(.linkedinUrl) | group_by(akey)
       | map({ key: .[0] | akey,
               value: {
                 total:   length,
                 hiring:  (map(select(hiring)) | length),
                 days:    (map(select(hiring)) | map(day) | map(select(. != "")) | unique | length),
                 first:   (map(select(hiring)) | map(day) | map(select(. != "")) | min),
                 last:    (map(select(hiring)) | map(day) | map(select(. != "")) | max)
               }}) | from_entries) as $h
    | $ppl
    | map(.k = (.url | ascii_downcase | split("?")[0] | sub("/$";"")))
    | map(.hiring_posts = ($h[.k].hiring // 0)
        | .total_posts  = ($h[.k].total  // 0)
        | .hiring_days  = ($h[.k].days   // 0)
        | .first_post   = ($h[.k].first  // "")
        | .last_post    = ($h[.k].last   // "")
        | .hiring_ratio = (if ($h[.k].total // 0) > 0
                           then (($h[.k].hiring // 0) / ($h[.k].total)) else 0 end))
    | map(del(.k))
    | map(select(.total_posts > 0))
    | sort_by(-.hiring_posts, -.hiring_days)
  ' "${OUT}/final.json" "${OUT}/history_raw.json" > "${OUT}/counted.json"

  jq -r '["rank","hiring_posts","total_posts","hiring_ratio","active_days","first_post","last_post","name","headline","location","url"],
    (to_entries[] | [(.key+1), .value.hiring_posts, .value.total_posts,
      (.value.hiring_ratio*100|floor), .value.hiring_days, .value.first_post,
      .value.last_post, .value.name, .value.live_headline, .value.live_location, .value.url])
    | @csv' "${OUT}/counted.json" > "${OUT}/counted.csv"

  echo
  echo "TOP 40 BY REAL HIRING-POST VOLUME:"
  jq -r '.[0:40][] | "  \(.hiring_posts)/\(.total_posts)\t\(.hiring_days)d\t\(.name)\t\(.live_headline[0:42])"' \
    "${OUT}/counted.json" | column -t -s $'\t'
  echo
  echo "-> ${OUT}/counted.csv"
}

case "${1:-search}" in
  search) search ;; rank) rank ;; enrich) enrich ;; final) final ;; count) count ;;
  *) echo "Usage: $0 [search|rank|enrich|final|count]"; exit 1 ;;
esac