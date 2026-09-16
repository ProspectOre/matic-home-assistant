#!/usr/bin/env bash
set -Eeuo pipefail
# Bash 3.2 otherwise loses errexit inside nested command substitutions.
trap 'exit 1' ERR

# One canonical policy, loaded by hash-pinned trusted workflow adapters.
# Adapters supply repository and status contexts; regular review is Codex-only.
evidence_only="${EVIDENCE_ONLY:-false}"
case "${RECORD_EVENT_ONLY:-false}" in
  true|false) ;;
  *) echo "RECORD_EVENT_ONLY must be true or false." >&2; exit 1 ;;
esac
case "$evidence_only" in
  true) evidence_only_mode=1 ;;
  false|"") evidence_only_mode=0 ;;
  *) echo "EVIDENCE_ONLY must be true or false." >&2; exit 1 ;;
esac

gate_pending() {
  if (( evidence_only_mode )); then
    exit 3
  fi
  exit 0
}

finding_after="${REVIEW_FINDING_AFTER:-}"
head_observed_at="${REVIEW_HEAD_OBSERVED_AT:-}"
expected_base_sha="${EXPECTED_BASE_SHA:-}"
# The canonical reviewer is the Codex connector.  Adapters may carry legacy
# provider variables, but they cannot broaden the accepted reviewer identity.
REVIEW_BOT_LOGIN="chatgpt-codex-connector"
REVIEW_BOT_EVENT_LOGIN="chatgpt-codex-connector[bot]"
timestamp_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
for watermark_name in REVIEW_FINDING_AFTER REVIEW_HEAD_OBSERVED_AT; do
  watermark_value="${!watermark_name:-}"
  if [[ -n "$watermark_value" && ! "$watermark_value" =~ $timestamp_re ]]; then
    echo "$watermark_name must be an RFC3339 UTC timestamp (for example 2026-01-02T03:04:05Z)." >&2
    exit 1
  fi
done
if [[ -n "$expected_base_sha" && ! "$expected_base_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "EXPECTED_BASE_SHA must be a full lowercase commit SHA." >&2
  exit 1
fi
normalize_timestamp() {
  python3 -c 'import datetime, sys; value=sys.argv[1]; print(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat(timespec="microseconds").replace("+00:00", "Z") if value else "")' "$1"
}
latest_timestamp() {
  python3 -c 'import datetime,json,sys; values=json.load(sys.stdin); print(max((datetime.datetime.fromisoformat(v.replace("Z","+00:00")).isoformat(timespec="microseconds").replace("+00:00","Z") for v in values if v), default=""))'
}
normalize_delivery_timestamps() {
  python3 -c 'import datetime,json,sys; data=json.load(sys.stdin); [(item.update(at=datetime.datetime.fromisoformat(item["at"].replace("Z","+00:00")).isoformat(timespec="microseconds").replace("+00:00","Z"))) for item in data["deliveries"]]; print(json.dumps(data))'
}
finding_after="$(normalize_timestamp "$finding_after")"
head_observed_at="$(normalize_timestamp "$head_observed_at")"
evidence_after="$finding_after"
if [[ -n "$head_observed_at" && "$head_observed_at" > "$evidence_after" ]]; then
  evidence_after="$head_observed_at"
fi
event_name="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
event_path="${FORWARDED_EVENT_PATH:-${GITHUB_EVENT_PATH:-}}"
# Self-hosted runner services cache PATH at launch; export the
# Homebrew paths so gh/jq resolve instead of failing with 127.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
gh_path="${REVIEW_GATE_GH:-$(command -v gh || true)}"
[[ -n "$gh_path" ]] || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
gh() {
  local cache_key cache_file response argument readonly=false
  if [[ -n "${REVIEW_READ_CACHE:-}" && "${1:-}" == api ]]; then
    case "${2:-}" in
      */statuses\?*|*/comments\?*) readonly=true ;;
      graphql)
        for argument in "$@"; do
          [[ "$argument" == query=query* ]] && readonly=true
        done ;;
    esac
    if [[ "$readonly" == true ]]; then
      cache_key="$(printf '%s\0' "$@" | shasum -a 256)"
      cache_file="$REVIEW_READ_CACHE/${cache_key%% *}.json"
      if [[ -f "$cache_file" ]]; then cat "$cache_file"; return; fi
      response="$(mktemp "$REVIEW_READ_CACHE/response.XXXXXX")"
      if "$gh_path" "$@" > "$response"; then
        mv "$response" "$cache_file"
        cat "$cache_file"
        return
      fi
      rm -f "$response"
      return 1
    fi
    # A write can alter the same snapshot's status history. Never cache across it.
    rm -f "$REVIEW_READ_CACHE/"*.json
  fi
  "$gh_path" "$@"
}
command -v jq >/dev/null || {
  echo "jq is required to evaluate review evidence."
  exit 1
}

if [[ "$event_name" == "workflow_dispatch" ]]; then
  if [[ ! "${INPUT_PR:-}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Pull request input must be a positive integer."
    exit 1
  fi
  pr_number="$INPUT_PR"
else
  pr_number="$EVENT_PR_NUMBER"
fi

if [[ ! "$pr_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "Could not resolve a pull request number."
  exit 1
fi

review_owner="$(printf '%s' "$REPO" | cut -d/ -f1)"
review_repo="$(printf '%s' "$REPO" | cut -d/ -f2)"
event_head_sha="${EVENT_HEAD_SHA:-}"
if [[ -n "$event_head_sha" && ! "$event_head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The review event did not provide a valid pull request head SHA."
  exit 1
fi

stamp_status_for_sha() {
  local target_sha="$1"
  local context="$2"
  local state="$3"
  local description="$4"
  if (( evidence_only_mode )); then
    return 0
  fi
  if [[ "${AUDIT_MODE:-false}" == true && "$context" == "$REVIEW_GATE_CONTEXT" ]]; then
    case "$description" in
      "Review state changed; evaluating the regular review"|"Classifying dependency-only changes on "*|"Evaluating the regular review on "*) return 0 ;;
    esac
    if [[ "$state" == success || "$state" == pending ]]; then
      current_status="$(gh api "repos/$REPO/commits/$target_sha/statuses?per_page=100" --paginate --slurp \
        | jq -c --arg context "$context" '[.[][] | select(.context == $context)][0] // null')"
      if jq -e --arg description "$description" --arg state "$state" '.state == $state and .description == $description' <<< "$current_status" >/dev/null; then return 0; fi
    fi
  fi
  gh api "repos/$REPO/statuses/$target_sha" --silent \
    -f state="$state" \
    -f context="$context" \
    -f description="$description" \
    -f target_url="${GITHUB_SERVER_URL:-https://github.com}/$REPO/actions/runs/${GITHUB_RUN_ID:-}"
}

# PR-state event payloads carry the exact head. Revoke its prior
# success before the first fallible lookup; dedicated routers have
# already classified review and issue-comment events.
if [[ -n "$event_head_sha" ]]; then
  stamp_status_for_sha "$event_head_sha" "$REVIEW_GATE_CONTEXT" pending \
    "Review state changed; evaluating the regular review"
fi

read_pr_snapshot() {
  # shellcheck disable=SC2016 # GraphQL expands these variables, not the shell.
    gh api graphql \
    -f query='query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { id state headRefOid baseRefOid baseRefName isDraft author { login } headRepository { nameWithOwner } autoMergeRequest { enabledAt } } } }' \
    -F owner="$review_owner" \
    -F name="$review_repo" \
    -F number="$pr_number" \
    | jq -er '
        .data.repository.pullRequest as $pr
        | select($pr != null)
        | [$pr.headRefOid,
           $pr.baseRefOid,
           $pr.baseRefName,
           ($pr.isDraft | tostring),
           $pr.id,
           (($pr.autoMergeRequest != null) | tostring),
           $pr.state,
           ($pr.author.login // ""),
           ($pr.headRepository.nameWithOwner // "")]
        | @tsv'
}

pr_snapshot="$(read_pr_snapshot)"
IFS=$'\t' read -r head_sha base_sha base_ref is_draft pr_node_id auto_merge_enabled pr_state pr_author_login head_repo <<< "$pr_snapshot"
if [[ ! "$head_sha" =~ ^[0-9a-f]{40}$ || ! "$base_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve valid pull request head and base SHAs."
  exit 1
fi
if [[ -n "$expected_base_sha" && "$base_sha" != "$expected_base_sha" ]]; then
  echo "The pull request base does not match EXPECTED_BASE_SHA; it remains pending."
  gate_pending
fi
if [[ ! "$pr_node_id" =~ ^PR_ || ! "$is_draft" =~ ^(true|false)$ || ! "$auto_merge_enabled" =~ ^(true|false)$ || ! "$pr_state" =~ ^(OPEN|CLOSED|MERGED)$ ]]; then
  echo "Could not resolve the pull request state for PR #$pr_number."
  exit 1
fi
if [[ "$pr_state" != "OPEN" ]]; then
  echo "PR #$pr_number is no longer open; it will not publish review-gate."
  gate_pending
fi
if [[ -n "$event_head_sha" && "$event_head_sha" != "$head_sha" ]]; then
  echo "The event head changed before evaluation; the newer PR event will re-evaluate it."
  gate_pending
fi
head_prefix="$(printf '%.10s' "$head_sha")"
base_marker_description="Base changed for PR #$pr_number ($base_sha); push a new head for fresh review"

stamp_status() {
  local context="$1"
  local state="$2"
  local description="$3"
  stamp_status_for_sha "$head_sha" "$context" "$state" "$description"
}

stamp_review_gate() {
  if [[ "$1" == success && -n "${CANONICAL_RESULT_OUTPUT:-}" ]]; then
    printf '%s\n' "$2" > "$CANONICAL_RESULT_OUTPUT"
  fi
  stamp_status "$REVIEW_GATE_CONTEXT" "$1" "$2"
}

stamp_base_change_marker() {
  stamp_status "$REVIEW_BASE_CONTEXT" pending \
    "$base_marker_description"
}

disable_auto_merge() {
  local pull_request_id="$1"
  if [[ ! "$pull_request_id" =~ ^PR_ ]]; then
    echo "Could not resolve a pull request node ID to disable automatic merge."
    exit 1
  fi
  # Revoke any old green gate before a transient GraphQL/API failure
  # can leave an already-armed PR eligible to merge automatically.
  stamp_review_gate pending "Disarming automatic merge on $head_prefix"
  # shellcheck disable=SC2016 # GraphQL expands this variable, not the shell.
  gh api graphql \
    -f query='mutation($pullRequestId: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId}) { pullRequest { id } } }' \
    -F pullRequestId="$pull_request_id" >/dev/null
}

head_prefix_resolves() {
  local resolved
  resolved="$(gh api "repos/$REPO/commits/$head_prefix" --jq '.sha')" || return 1
  [[ "$resolved" == "$head_sha" ]]
}

base_change_marker_exists() {
  local statuses
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  printf '%s\n' "$statuses" | jq -e --arg context "$REVIEW_BASE_CONTEXT" --arg pr "$pr_number" '
    any(.[][]; .context == $context and .state == "pending" and ((.description // "") | (startswith("Base changed for PR #" + $pr + " (") or startswith("Base changed for PR #" + $pr + " at base "))))' >/dev/null
}

latest_regular_issue_comment_at() {
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -c --arg context "$REVIEW_COMMENT_CONTEXT" '
        [.[][]
         | select(.context == $context)
         | select(.state == "pending")
         | (.description // "") as $description
         | select($description | test("^Regular issue-comment invalidated(?: at [^;]+)?;"))
         | if ($description | test("^Regular issue-comment invalidated at [^;]+;"))
           then ($description | capture("^Regular issue-comment invalidated at (?<at>[^;]+);").at)
           else .updated_at
           end]
        ' | latest_timestamp
}

latest_regular_review_invalidation_at() {
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -c --arg context "$REVIEW_REVIEW_CONTEXT" '
        [.[][]
         | select(.context == $context)
         | select(.state == "pending")
         | (.description // "") as $description
         | select($description | startswith("Regular review invalidated"))
         | if ($description | test("^Regular review invalidated at [^;]+;"))
           then ($description | capture("^Regular review invalidated at (?<at>[^;]+);").at)
           else .updated_at
           end]
        ' | latest_timestamp
}

active_security_findings() {
  local review_findings issue_comment_findings inline_findings security_reviews
  review_findings="$(
    # shellcheck disable=SC2016
    gh api graphql --paginate \
      -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(first: 100, after: $endCursor) { nodes { databaseId state submittedAt updatedAt body author { login ... on Bot { id } } commit { oid } } pageInfo { hasNextPage endCursor } } } } }' \
      -F owner="$review_owner" \
      -F name="$review_repo" \
      -F number="$pr_number" \
      | jq -rs --arg bot "$SECURITY_REVIEW_BOT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" '
          [.[]
           | .data.repository.pullRequest.reviews.nodes[]?
           | select((.author.login // "") == $bot and .author.id == "BOT_kgDOC98s_g")
           | select((.state // "") != "DISMISSED")
           | select((.commit.oid // "") == $head)
           | (.body // "") as $body
           | ($body | ascii_downcase) as $lower
           | select($lower | contains("codex security review"))
           | select($lower | contains("[view security finding report](") or contains("codex-security-review-finding:v1"))
           | select(($body | contains("`" + $head + "`")) or ($body | contains("`" + $prefix + "`")))
           | {source: "review", id: (.databaseId // 0 | tostring)}]'
  )"
  # Inline security deliveries may omit a textual head marker. Bind them to
  # their authenticated originating review and immutable original commit.
  # shellcheck disable=SC2016
  security_reviews="$(gh api graphql --paginate \
    -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(first: 100, after: $endCursor) { nodes { databaseId state submittedAt updatedAt body author { login ... on Bot { id } } commit { oid } } pageInfo { hasNextPage endCursor } } } } }' \
    -F owner="$review_owner" \
      -F name="$review_repo" \
      -F number="$pr_number" \
    | jq -rs --arg head "$head_sha" '[.[] | .data.repository.pullRequest.reviews.nodes[]? | select(.author.login == "chatgpt-codex-connector" and .author.id == "BOT_kgDOC98s_g" and .commit.oid == $head and .state != "DISMISSED") | .databaseId]')"
  inline_findings="$(gh api "repos/$REPO/pulls/$pr_number/comments?per_page=100" --paginate --slurp \
    | jq -c --argjson reviews "$security_reviews" --arg head "$head_sha" '
      [.[][] | select(.user.login == "chatgpt-codex-connector[bot]" and .user.id == 199175422 and .user.type == "Bot")
       | select(.original_commit_id == $head)
       | select(.pull_request_review_id as $id | $reviews | index($id))
       | select((.body // "" | ascii_downcase) | contains("codex-security-review-finding:v1") or (contains("codex security review") and contains("[view security finding report](")))
       | {source:"review", id:(.pull_request_review_id | tostring)}]')"
  issue_comment_findings="$(
    gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp \
      | jq -r --arg bot "$SECURITY_REVIEW_BOT_EVENT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" '
          [.[][]
           | select((.user.login // "") == $bot and .user.id == 199175422 and .user.type == "Bot")
           | (.body // "") as $body
           | ($body | ascii_downcase) as $lower
           | select($lower | contains("codex security review"))
           | select($lower | contains("[view security finding report](") or contains("codex-security-review-finding:v1"))
           | select(($body | contains("`" + $head + "`")) or ($body | contains("`" + $prefix + "`")))
           | {source: "issue-comment", id: (.id // 0 | tostring)}]'
  )"
  jq -cn --argjson reviews "$review_findings" --argjson comments "$issue_comment_findings" --argjson inline "$inline_findings" '$reviews + $comments + $inline | unique'
}

# Exact-head regular PR reviews and explicit clean regular issue
# comments can qualify. Security findings block independently and
# can never satisfy the required regular-review verdict.
regular_evidence() {
  local review_records issue_comment_records
  review_records="$(
    # shellcheck disable=SC2016 # GraphQL expands these variables, not the shell.
    gh api graphql --paginate \
      -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(first: 100, after: $endCursor) { nodes { databaseId state submittedAt updatedAt body author { login ... on Bot { id } } commit { oid } } pageInfo { hasNextPage endCursor } } } } }' \
      -F owner="$review_owner" \
      -F name="$review_repo" \
      -F number="$pr_number" \
      | jq -cs --arg bot "$REVIEW_BOT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" '
          def regular_heading:
            ascii_downcase
            | test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review(?:[[:space:]]*:|[[:space:]]|$)|^[[:space:]]*(?:#{1,6}[[:space:]]+)?review result(?:[[:space:]]*:|[[:space:]]|$)");
          def security_heading:
            ascii_downcase
            | test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]]+)?security(?:[[:space:]-]+)review(?:[[:space:]]*:|[[:space:]]|$)");
          def availability_notice:
            ascii_downcase
            | test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]]+)?(?:review|review[[:space:]]+result)(?:[[:space:]]*:|[[:space:]]|$)[[:space:]]*(?:you have reached[^\\r\\n]*(?:usage[[:space:]]+limits?|quota)|(?:codex[[:space:]]+)?(?:review[[:space:]]+)?(?:is[[:space:]]+)?(?:currently[[:space:]]+)?(?:unavailable|at[[:space:]]+capacity|rate[[:space:]-]*limited)|(?:could not|unable to)[[:space:]]+(?:start|complete|perform)[[:space:]]+(?:the[[:space:]]+)?(?:codex[[:space:]]+)?review|[^\\r\\n]*try again later)");
          def exact_head:
            test("(?im)\\*{0,2}reviewed commit:\\*{0,2}[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60");
          # A "no major/blocking issues" claim must carry the
          # known connector footer; a body-only claim is not a
          # clean verdict.
          def stock_clean_envelope:
            test("(?is)^[[:space:]]*#{1,6}[^\\r\\n]*codex[[:space:]]+review[[:space:]]*\\r?\\n[[:space:]]*\\r?\\n[[:space:]]*here are some automated review suggestions for this pull request\\.[[:space:]]*\\r?\\n[[:space:]]*\\r?\\n[[:space:]]*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*\\r?\\n[[:space:]]*<details>.*</details>[[:space:]]*$")
            or test("(?is)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review:[[:space:]]*didn.t find any major issues\\.[ \t]*(?:Nice work!|Already looking forward to the next diff\\.|Another round soon, please!|More of your lovely PRs please\\.)?[ \t]*(?::\\+1:|👍|:rocket:|🚀)?[ \t]*(?:\\r?\\n[[:space:]]*)+\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*(?:\\r?\\n[[:space:]]*)+<details>[[:space:]]*<summary>[^\\r\\n]*codex[[:space:]]+in[[:space:]]+github.*</details>[[:space:]]*$")
            or test("(?is)^[[:space:]]*#{1,6}[^\\r\\n]*(?:codex[[:space:]]+review|review result):[[:space:]]*(?:didn.t find any issues|no issues found)\\.[[:space:]]*(?:\\r?\\n[[:space:]]*)*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*$");
          [.[]
           | .data.repository.pullRequest.reviews.nodes[]?
           | select((.author.login // "") == $bot and .author.id == "BOT_kgDOC98s_g")
           | select((.commit.oid // "") == $head)
           | (.body // "") as $body
           | select($body | regular_heading)
           | select(($body | security_heading) | not)
           | select(($body | availability_notice) | not)
           | select($body | exact_head)
           | {at: (.updatedAt // .submittedAt),
              id: (.databaseId | tostring),
              source: "review",
              dismissed: (.state == "DISMISSED"),
              clean: ((.state == "COMMENTED" or .state == "APPROVED") and ($body | stock_clean_envelope))}]'
  )"
  issue_comment_records="$(
    gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp \
      | jq -c --arg bot "$REVIEW_BOT_EVENT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" --arg prior_body "${1:-}" --arg prior_id "${2:-}" '
          def regular_heading:
            ascii_downcase
            | test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review(?:[[:space:]]*:|[[:space:]]|$)|^[[:space:]]*(?:#{1,6}[[:space:]]+)?review result(?:[[:space:]]*:|[[:space:]]|$)");
          def security_heading:
            ascii_downcase
            | test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]]+)?security(?:[[:space:]-]+)review(?:[[:space:]]*:|[[:space:]]|$)");
          def availability_notice:
            ascii_downcase
            | test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]]+)?(?:review|review[[:space:]]+result)(?:[[:space:]]*:|[[:space:]]|$)[[:space:]]*(?:you have reached[^\\r\\n]*(?:usage[[:space:]]+limits?|quota)|(?:codex[[:space:]]+)?(?:review[[:space:]]+)?(?:is[[:space:]]+)?(?:currently[[:space:]]+)?(?:unavailable|at[[:space:]]+capacity|rate[[:space:]-]*limited)|(?:could not|unable to)[[:space:]]+(?:start|complete|perform)[[:space:]]+(?:the[[:space:]]+)?(?:codex[[:space:]]+)?review|[^\\r\\n]*try again later)");
          def exact_head:
            test("(?im)\\*{0,2}reviewed commit:\\*{0,2}[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60");
          # An issue comment has no review-thread metadata. A generic
          # suggestions envelope therefore cannot prove a clean verdict.
          def stock_clean_issue_comment_envelope:
            test("(?is)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review:[[:space:]]*didn.t find any major issues\\.[ \t]*(?:Nice work!|Already looking forward to the next diff\\.|Another round soon, please!|More of your lovely PRs please\\.)?[ \t]*(?::\\+1:|👍|:rocket:|🚀)?[ \t]*(?:\\r?\\n[[:space:]]*)+\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*(?:\\r?\\n[[:space:]]*)+<details>[[:space:]]*<summary>[^\\r\\n]*codex[[:space:]]+in[[:space:]]+github.*</details>[[:space:]]*$")
            or test("(?is)^[[:space:]]*#{1,6}[^\\r\\n]*(?:codex[[:space:]]+review|review result):[[:space:]]*(?:didn.t find any issues|no issues found)\\.[[:space:]]*(?:\\r?\\n[[:space:]]*)*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*$");
          [.[][]
           | if (.id | tostring) == $prior_id then .body = $prior_body else . end
           | select((.user.login // "") == $bot and .user.id == 199175422 and .user.type == "Bot")
           | (.body // "") as $body
           | select($body | regular_heading)
           | select(($body | security_heading) | not)
           | select(($body | availability_notice) | not)
           | select($body | exact_head)
           | {at: (.updated_at // .created_at),
              id: ("issue-comment-" + (.id | tostring)),
              source: "issue_comment",
              body: $body,
              clean: ($body | stock_clean_issue_comment_envelope)}]'
  )"
  jq -cn --argjson reviews "$review_records" --argjson issue_comments "$issue_comment_records" '
    {deliveries: ($reviews + $issue_comments),
     review_ids: [$reviews[] | select(.dismissed != true) | .id]}' | normalize_delivery_timestamps
}

regular_review_thread_summary() {
  local review_ids="$1"
  # shellcheck disable=SC2016 # GraphQL expands these variables, not the shell.
  gh api graphql --paginate \
    -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100, after: $endCursor) { nodes { isResolved isOutdated comments(first: 100) { nodes { commit { oid } originalCommit { oid } replyTo { databaseId } pullRequestReview { databaseId } author { login ... on Bot { id } } } } } pageInfo { hasNextPage endCursor } } } } }' \
    -F owner="$review_owner" \
    -F name="$review_repo" \
    -F number="$pr_number" \
    | jq -rs --argjson review_ids "$review_ids" --arg bot "$REVIEW_BOT_LOGIN" --arg head "$head_sha" '
        [.[]
         | .data.repository.pullRequest.reviewThreads.nodes[]? as $thread
         | $thread.comments.nodes[]?
         | select((.author.login // "") == $bot and .author.id == "BOT_kgDOC98s_g")
         | select(.replyTo == null)
         | select((((.pullRequestReview.databaseId // -1) | tostring) as $review_id
             | ($review_ids | index($review_id))) != null)
         | select((.originalCommit.oid // .commit.oid // "") == $head)
         | {id: (.pullRequestReview.databaseId | tostring),
            active: (($thread.isResolved | not) and ($thread.isOutdated | not))}]
        | group_by(.id)
        | map({id: .[0].id,
               active_count: ([.[] | select(.active)] | length),
               total_count: length})'
}

shared_open_head_owner() {
  gh api "repos/$REPO/pulls?state=open&per_page=100" --paginate \
    | jq -rs --arg head "$head_sha" '
        [.[][] | select((.head.sha // "") == $head) | .number]
        | unique
        | if length == 1 then .[0] | tostring else "" end'
}

write_finding_observation() {
  local observed_at="$1"
  [[ -n "${CANONICAL_FINDING_OUTPUT:-}" && -n "$observed_at" ]] || return 0
  if ! printf '%s\n' "$observed_at" > "$CANONICAL_FINDING_OUTPUT"; then
    echo "Could not persist the canonical finding observation." >&2
    exit 1
  fi
}

finding_history_head() {
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -r --arg context "review-finding-history" '
      [.[][] | select(.context == $context and .state == "pending")
       | (.description // "") | try capture("head (?<head>[0-9a-f]{40})").head catch ""][0] // ""'
}

security_history_head() {
  if [[ "${security_withdrawal_unresolved:-false}" == true ]]; then
    printf '%s\n' "$head_sha"
    return
  fi
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -r --arg context "review-security-history" --arg head "$head_sha" '
      if any(.[][]; .context == $context and .state == "pending"
             and ((.description // "") | contains("head " + $head)))
      then $head else "" end'
}

security_findings_dismissed() { findings_dismissed "review-security-history" "Security"; }
regular_findings_dismissed() { findings_dismissed "review-finding-history" "Regular"; }

findings_dismissed() {
  local context="$1" label="$2" markers reviews
  markers="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -c --arg head "$head_sha" --arg context "$context" --arg label "$label" '
      [.[][] | select(.context == $context and .state == "pending")
       | select((.description // "") | contains("head " + $head))
       | (.description // "") as $description
       | if ($description | test("^" + $label + " findings observed on head " + $head + "; (review|issue-comment):[1-9][0-9]*$")) then
           ($description | capture("; (?<source>review|issue-comment):(?<id>[1-9][0-9]*)$"))
         elif ($description | test("^Security review invalidated at [^;]+; withdrawn issue-comment:[1-9][0-9]* on head " + $head + "$")) then
           ($description | capture("withdrawn (?<source>issue-comment):(?<id>[1-9][0-9]*) on head"))
         else null end]')" || return 1
  # Issue-comment deletion is not dismissal. Every review origin needs authenticated
  # dismissal proof. Unknown
  # legacy markers cannot be cleared by unrelated reviews or API failures.
  jq -e 'length > 0 and all(.[]; . != null)' <<< "$markers" >/dev/null || return 1
  # shellcheck disable=SC2016
  reviews="$(gh api graphql --paginate \
    -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(first: 100, after: $endCursor) { nodes { databaseId state submittedAt updatedAt body author { login ... on Bot { id } } commit { oid } } pageInfo { hasNextPage endCursor } } } } }' \
    -F owner="$review_owner" \
      -F name="$review_repo" \
      -F number="$pr_number" \
    | jq -rs '[.[] | .data.repository.pullRequest.reviews.nodes[]?]')" || return 1
  jq -en --argjson markers "$markers" --argjson reviews "$reviews" --arg head "$head_sha" '
    all($markers[]; . as $origin |
      if .source == "issue-comment" then
        false
      else any($reviews[];
        (.databaseId | tostring) == $origin.id
        and .author.login == "chatgpt-codex-connector"
        and .author.id == "BOT_kgDOC98s_g"
        and .commit.oid == $head
        and .state == "DISMISSED") end)' >/dev/null
}

stamp_security_finding_history() {
  local findings="$1" key
  while IFS= read -r key; do
    if [[ "$key" =~ ^(review|issue-comment):[1-9][0-9]*$ ]]; then
      stamp_status "review-security-history" pending "Security findings observed on head $head_sha; $key" >/dev/null
    else
      # Missing origin metadata is unresolved evidence, never dismissal proof.
      stamp_status "review-security-history" pending "Security findings observed on head $head_sha" >/dev/null
    fi
  done < <(jq -r '.[] | .source + ":" + .id' <<< "$findings")
}

# Retain withdrawal history even when a failed/fork router could not write it.
# Compare the last published evidence ID with all currently valid records, not
# merely the selected verdict: an older clean verdict cannot replace a deletion.
withdrawn_evidence_at() {
  local deliveries="$1" statuses prior key prior_at saved at
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  prior="$(jq -c --arg context "$REVIEW_GATE_CONTEXT" '
    [.[][] | select(.context == $context and .state == "success")
     | select((.description // "") | test("evidence (review:[0-9]+|issue-comment:[0-9]+)"))][0] // null' <<< "$statuses")"
  [[ "$prior" != null ]] || return 0
  key="$(jq -r '.description | capture("evidence (?<key>review:[0-9]+|issue-comment:[0-9]+)").key' <<< "$prior")"
  if jq -e --arg key "$key" 'any(.[]; .clean and
       (if .source == "review" then "review:" + .id else (.id | sub("^issue-comment-"; "issue-comment:")) end) == $key)' <<< "$deliveries" >/dev/null; then
    return 0
  fi
  # If the non-clean delivery is still present, its observed timestamp is the
  # authoritative invalidation watermark. Do not replace it with the current
  # clock value when a newer clean verdict is already available.
  local delivery_at
  delivery_at="$(jq -r --arg key "$key" '
    [.[] | select(.clean | not)
      | select((if .source == "review" then "review:" + .id else (.id | sub("^issue-comment-"; "issue-comment:")) end) == $key)
      | .at] | sort | last // ""' <<< "$deliveries")"
  if [[ -n "$delivery_at" ]]; then
    normalize_timestamp "$delivery_at"
    return 0
  fi
  saved="$(jq -r --arg context "$REVIEW_REVIEW_CONTEXT" --arg suffix "; withdrawn $key" '
    [.[][] | select(.context == $context and .state == "pending")
     | select((.description // "") | endswith($suffix))
     | .description | capture("^Regular review invalidated at (?<at>[^;]+);").at][0] // ""' <<< "$statuses")"
  if [[ -z "$saved" ]]; then
    saved="$(jq -r --arg context "$REVIEW_REVIEW_CONTEXT" '
      [.[][] | select(.context == $context and .state == "pending")
       | select((.description // "") | endswith("; withdrawn delivery"))
       | .description | capture("^Regular review invalidated at (?<at>[^;]+);").at][0] // ""' <<< "$statuses")"
  fi
  if [[ -n "$saved" ]]; then normalize_timestamp "$saved"; return 0; fi
  prior_at="$(normalize_timestamp "$(jq -r '.updated_at // .created_at' <<< "$prior")")"
  # The web adapter persists finding observations outside commit statuses.
  if (( evidence_only_mode )) && [[ -n "$finding_after" && "$finding_after" > "$prior_at" ]]; then
    echo "$finding_after"; return 0
  fi
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  stamp_status "$REVIEW_REVIEW_CONTEXT" pending "Regular review invalidated at $at; withdrawn $key" >/dev/null
  normalize_timestamp "$at"
}

read_gate_snapshot() (
  REVIEW_READ_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/review-snapshot.XXXXXX")"
  export REVIEW_READ_CACHE
  trap 'rm -rf "$REVIEW_READ_CACHE"' EXIT
  local evidence deliveries reviews review_ids thread_summary verdict_selection verdict finding_count security_finding_count security_findings latest_finding_at issue_comment_at review_invalidation_at withdrawal_at
  evidence="$(regular_evidence)"
  deliveries="$(jq -c '.deliveries' <<< "$evidence")"
  reviews="$(jq -c '[.deliveries[] | select(.source == "review")]' <<< "$evidence")"
  review_ids="$(jq -c '.review_ids' <<< "$evidence")"
  thread_summary="$(regular_review_thread_summary "$review_ids")"
  verdict_selection="$(
    issue_comment_at="$(latest_regular_issue_comment_at)"
    review_invalidation_at="$(latest_regular_review_invalidation_at)"
    withdrawal_at="$(withdrawn_evidence_at "$deliveries")"
    jq -cn --argjson deliveries "$deliveries" --argjson reviews "$reviews" --argjson thread_summary "$thread_summary" --arg issue_comment_at "$issue_comment_at" --arg review_invalidation_at "$review_invalidation_at" --arg withdrawal_at "$withdrawal_at" '
      ($thread_summary | map(select(.total_count > 0) | .id)) as $finding_ids
      | (([$deliveries[] | select(.clean | not) | .at]
          + [$reviews[]
             | select(.id as $id | ($finding_ids | index($id)) != null)
             | .at]
          + (if $issue_comment_at == "" then [] else [$issue_comment_at] end)
          + (if $review_invalidation_at == "" then [] else [$review_invalidation_at] end)
          + (if $withdrawal_at == "" then [] else [$withdrawal_at] end))
         | max // "") as $latest_finding_at
      | ($deliveries | sort_by(.at) | last) as $latest_delivery
      | {verdict:
           (if $latest_delivery != null
                 and ($latest_delivery.source == "review" or $latest_delivery.source == "issue_comment")
                 and $latest_delivery.clean
                 and (($finding_ids | index($latest_delivery.id)) == null)
                 and $latest_delivery.at > $latest_finding_at
            then $latest_delivery
            else null
            end),
         latest_finding_at: $latest_finding_at}'
  )"
  verdict="$(jq -c '.verdict' <<< "$verdict_selection")"
  latest_finding_at="$(jq -r '.latest_finding_at' <<< "$verdict_selection")"
  finding_count="$(jq '[.[].active_count] | add // 0' <<< "$thread_summary")"
  security_findings="$(active_security_findings)"
  security_finding_count="$(jq length <<< "$security_findings")"
  jq -cn \
    --argjson deliveries "$deliveries" \
    --argjson thread_summary "$thread_summary" \
    --argjson verdict "$verdict" \
    --argjson finding_count "$finding_count" \
    --argjson security_finding_count "$security_finding_count" \
    --argjson security_findings "$security_findings" \
    --arg latest_finding_at "$latest_finding_at" \
    '{regular_findings: (([$deliveries[] | select((.clean | not) and .dismissed != true) | {source: (if .source == "issue_comment" then "issue-comment" else .source end), id: (.id | sub("^issue-comment-"; ""))}] + [$thread_summary[] | select(.total_count > 0) | {source:"review", id:.id}]) | unique),
      verdict: $verdict,
      finding_count: $finding_count,
      security_finding_count: $security_finding_count,
      security_findings: $security_findings,
      latest_finding_at: $latest_finding_at}'
)

require_clean_regular_snapshot() {
  local gate_snapshot="$1"
  local verdict verdict_at finding_count regular_finding_count security_finding_count latest_finding_at
  verdict="$(jq -c '.verdict' <<< "$gate_snapshot")"
  latest_finding_at="$(jq -r '.latest_finding_at // empty' <<< "$gate_snapshot")"
  finding_count="$(jq -r '.finding_count' <<< "$gate_snapshot")"
  regular_finding_count="$(jq '.regular_findings | length' <<< "$gate_snapshot")"
  security_finding_count="$(jq -r '.security_finding_count' <<< "$gate_snapshot")"
  if [[ "$regular_finding_count" -gt 0 ]]; then
    local origin
    while IFS= read -r origin; do
      [[ "$origin" =~ ^(review|issue-comment):[1-9][0-9]*$ ]] || exit 1
      stamp_status "review-finding-history" pending "Regular findings observed on head $head_sha; $origin" >/dev/null
    done < <(jq -r '.regular_findings[] | .source + ":" + .id' <<< "$gate_snapshot")
  fi
  # Block directly from observed origins too: evidence-only consumers cannot
  # persist statuses, and a resolved thread is not a native review dismissal.
  if [[ "$regular_finding_count" -gt 0 || "${edited_finding:-false}" == true ]] || { [[ "$(finding_history_head)" == "$head_sha" ]] && ! regular_findings_dismissed; }; then
    stamp_review_gate pending "Unresolved finding history; fix code or record authorized review dismissal"
    gate_pending
  fi
  if [[ "$(security_history_head)" == "$head_sha" ]] && ! security_findings_dismissed; then
    stamp_review_gate pending "Security findings were reported on this head; push a fresh head"
    gate_pending
  fi
  write_finding_observation "$latest_finding_at"
  if [[ "$security_finding_count" -gt 0 ]]; then
    stamp_security_finding_history "$(jq -c '.security_findings' <<< "$gate_snapshot")"
    stamp_review_gate pending "Codex Security reported findings on $head_prefix"
    echo "Codex Security reported $security_finding_count findings-bearing result(s) on the exact head."
    echo "Fix them, push a new head, and request review again."
    gate_pending
  fi
  if [[ -n "$latest_finding_at" && "$latest_finding_at" > "$(latest_regular_review_invalidation_at)" ]]; then
    stamp_status "$REVIEW_REVIEW_CONTEXT" pending \
      "Regular review invalidated at $latest_finding_at; regular evidence changed; require a newer clean normal verdict"
  fi
  if base_change_marker_exists; then
    stamp_review_gate pending "Base changed; push a new head for a fresh regular review"
    echo "The base-change marker requires a new PR head and regular review."
    gate_pending
  fi

  if [[ "$verdict" == "null" ]]; then
    if [[ -n "$latest_finding_at" ]]; then
      stamp_review_gate pending "Waiting for a fresh clean regular review on $head_prefix"
      echo "A findings-bearing regular review needs a newer clean review."
      gate_pending
    fi
    stamp_review_gate pending "Waiting for the regular review verdict on $head_prefix"
    echo "No affirmative regular review verdict covers the exact head."
    gate_pending
  fi
  verdict_at="$(normalize_timestamp "$(jq -r '.at // empty' <<< "$verdict")")"
  if [[ -n "$evidence_after" ]] && { [[ -z "$verdict_at" ]] || [[ "$verdict_at" < "$evidence_after" ]] || [[ "$verdict_at" == "$evidence_after" ]]; }; then
    stamp_review_gate pending "Waiting for clean evidence strictly after $evidence_after on $head_prefix"
    echo "Clean regular-review evidence must be newer than the supplied watermark."
    gate_pending
  fi
  if [[ -z "$verdict_at" || "$finding_count" -gt 0 ]]; then
    stamp_review_gate pending "Regular review reported findings on $head_prefix"
    echo "The regular review reported $finding_count active finding(s) on the exact head."
    echo "Fix them, push a new head, and request the regular review again."
    gate_pending
  fi
}

require_no_security_findings() {
  local count
  count="$(active_security_finding_count)"
  if [[ "$count" -gt 0 ]]; then
    stamp_review_gate pending "Codex Security reported findings on $head_prefix"
    gate_pending
  fi
}

# A pre-policy or manually armed pull request must be made manual-only
# before this gate evaluates it. This mutation only disables auto-merge.
if [[ "$auto_merge_enabled" == "true" ]]; then
  if (( evidence_only_mode )); then
    echo "Automatic merge is enabled; evidence-only mode cannot disarm it."
    gate_pending
  fi
  disable_auto_merge "$pr_node_id"
  echo "Disabled automatic merge for PR #$pr_number."
fi
if [[ -z "$DEFAULT_BRANCH" || "$base_ref" != "$DEFAULT_BRANCH" ]]; then
  stamp_review_gate pending "Retarget to the repository default branch before review"
  echo "PR #$pr_number targets unsupported base '$base_ref'; expected '$DEFAULT_BRANCH'."
  gate_pending
fi

if [[ "$is_draft" == "true" ]]; then
  stamp_review_gate pending "Waiting for pull request to leave draft"
  gate_pending
fi
shared_head_owner="$(shared_open_head_owner)"
if [[ "$shared_head_owner" != "$pr_number" ]]; then
  stamp_review_gate pending "Current head is shared by multiple open pull requests"
  echo "Refusing to use regular-review evidence for an ambiguous or mismatched open PR head."
  gate_pending
fi

if [[ "${REQUIRE_CURRENT_BASE:-false}" == true ]]; then
  relationship="$(gh api "repos/$REPO/compare/$base_sha...$head_sha" --jq '.status')"
  if [[ "$relationship" != ahead && "$relationship" != identical ]]; then
    stamp_review_gate pending "Current head must include the current default branch"
    gate_pending
  fi
fi

# A base retarget or force-push invalidates the reviewed comparison.
# Evidence-only runs cannot persist a marker on the contributor head, so
# reconstruct that invalidation from the authenticated timeline.
if [[ "${REQUIRE_TIMELINE_FRESHNESS:-false}" == true ]]; then
  timeline_base_at="$(gh api "repos/$REPO/issues/$pr_number/timeline?per_page=100" --paginate --slurp \
    | jq -r '[.[][] | select(.event == "base_ref_changed" or .event == "base_ref_force_pushed") | (.updated_at // .created_at)]' | latest_timestamp)" || exit 1
  timeline_base_at="$(normalize_timestamp "$timeline_base_at")"
  if [[ -n "$timeline_base_at" && -z "$head_observed_at" ]]; then
    # Without an authenticated head-observation watermark, a base event cannot
    # reuse an earlier verdict. A fresh regular review can recover normally.
    if [[ "$timeline_base_at" > "$evidence_after" ]]; then evidence_after="$timeline_base_at"; fi
  elif [[ -n "$timeline_base_at" && "$timeline_base_at" > "$head_observed_at" ]]; then
    stamp_review_gate pending "Base changed after head observation; push a fresh head before evaluation"
    gate_pending
  fi
fi

# A retarget event carries persistent base invalidation even when the head did
# not change. Ignore stale deliveries for other heads or unrelated title edits.
if [[ "$event_name" == pull_request_target && -f "$event_path" ]]; then
  if jq -e --arg head "$head_sha" --argjson number "$pr_number" \
    '.changes.base != null and .pull_request.number == $number and .pull_request.head.sha == $head' "$event_path" >/dev/null; then
    stamp_base_change_marker
    stamp_review_gate pending "Base changed; push a fresh head before evaluation"
    gate_pending
  fi
fi

# A trusted relay may deliver review or inline-review-comment events while the
# workflow itself is running as workflow_dispatch. Preserve an authenticated
# security finding from that payload even when the live API record is already
# missing (for example after a delete or edit race).
if [[ ("$event_name" == pull_request_review || "$event_name" == pull_request_review_comment) && -f "$event_path" ]] &&
   jq -e --arg event "$event_name" --arg head "$head_sha" --argjson number "$pr_number" '
     .pull_request.number == $number and .pull_request.head.sha == $head and
     (if $event == "pull_request_review" then
        .review.user.id == 199175422 and .review.user.type == "Bot" and
        .review.user.login == "chatgpt-codex-connector[bot]" and
        (.review.id | type == "number" and . > 0) and .review.commit_id == $head
      else
        .comment.user.id == 199175422 and .comment.user.type == "Bot" and
        .comment.user.login == "chatgpt-codex-connector[bot]" and
        (.comment.id | type == "number" and . > 0) and
        (.comment.pull_request_review_id | type == "number" and . > 0) and
        .comment.original_commit_id == $head
      end)' "$event_path" >/dev/null; then
  relayed_security_finding=false
  if jq -e --arg event "$event_name" --arg head "$head_sha" '
    ([if $event == "pull_request_review" then .review.body else .comment.body end,
      .changes.body.from // ""] | any(
        ((ascii_downcase | contains("codex security review")) and
         (contains("codex-security-review-finding:v1") or contains("[view security finding report](")))
      ))' "$event_path" >/dev/null; then
    relayed_security_finding=true
  fi
  if [[ "$relayed_security_finding" == true ]]; then
    if [[ "$event_name" == pull_request_review ]]; then
      relayed_review_id="$(jq -r '.review.id' "$event_path")"
    else
      relayed_review_id="$(jq -r '.comment.pull_request_review_id' "$event_path")"
    fi
    stamp_status "review-security-history" pending \
      "Security findings observed on head $head_sha; review:$relayed_review_id" >/dev/null
    if [[ "$(jq -r '.action' "$event_path")" != dismissed ]]; then
      security_withdrawal_unresolved=true
    fi
  fi
fi

# A relayed inline review comment can be edited or deleted after its original
# delivery was missed. Preserve the authenticated originating review as
# blocking history even when the mutable comment is no longer available.
if [[ "$event_name" == pull_request_review_comment && -f "$event_path" ]] &&
   jq -e --arg head "$head_sha" --argjson number "$pr_number" '
     .pull_request.number == $number and .pull_request.head.sha == $head and
     (.action == "edited" or .action == "deleted") and
     .comment.user.id == 199175422 and .comment.user.type == "Bot" and
     .comment.user.login == "chatgpt-codex-connector[bot]" and
     (.comment.pull_request_review_id | type == "number" and . > 0) and
     .comment.original_commit_id == $head' "$event_path" >/dev/null; then
  relayed_review_id="$(jq -r '.comment.pull_request_review_id' "$event_path")"
  stamp_status "review-security-history" pending \
    "Relayed inline review changed on head $head_sha; review:$relayed_review_id" >/dev/null
  security_withdrawal_unresolved=true
fi

# Persist authenticated withdrawal deliveries even when their deleted body no
# longer exists in the API list. External watermarks are trusted finding history.
if [[ -n "$finding_after" ]]; then
  stamp_status "$REVIEW_REVIEW_CONTEXT" pending "Regular review invalidated at $finding_after; withdrawn delivery" >/dev/null
fi
  if [[ "$event_name" == issue_comment && -f "$event_path" ]] &&
   jq -e --arg head "$head_sha" --arg prefix "$head_prefix" '
     (.action == "deleted" or .action == "edited") and
     .comment.user.id == 199175422 and .comment.user.type == "Bot" and
     .comment.user.login == "chatgpt-codex-connector[bot]" and
     ([.comment.body // "", .changes.body.from // ""] | any(
       (contains("`" + $head + "`") or contains("`" + $prefix + "`")) and
       test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:(?:codex[[:space:]-]+security[[:space:]-]+review)|(?:codex[[:space:]]+review)|review result)(?:[[:space:]]*:|[[:space:]]|$)")))' "$event_path" >/dev/null; then
  edited_clean=false
  security_event=false
  if jq -e --arg head "$head_sha" --arg prefix "$head_prefix" '
    ([.comment.body // "", .changes.body.from // ""] | any(
      (contains("`" + $head + "`") or contains("`" + $prefix + "`")) and
      test("(?mi)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]-]+security[[:space:]-]+review)(?:[[:space:]]*:|[[:space:]]|$)")))
  ' "$event_path" >/dev/null; then
    security_event=true
    # Security notices are never regular-review withdrawals.
    edited_clean=true
  fi
  security_finding=false
  if [[ "$security_event" == true ]] && jq -e --arg head "$head_sha" --arg prefix "$head_prefix" '
    ([.comment.body // "", .changes.body.from // ""] | any(
      (contains("`" + $head + "`") or contains("`" + $prefix + "`")) and
      (ascii_downcase | contains("codex-security-review-finding:v1") or contains("[view security finding report]("))))
  ' "$event_path" >/dev/null; then
    security_finding=true
  fi
  if [[ "$security_finding" == true ]]; then
    withdrawal_at="$(jq -r '.comment.updated_at // empty' "$event_path")"
    withdrawal_at="${withdrawal_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    comment_id="$(jq -r '.comment.id // empty' "$event_path")"
    security_marker="withdrawn delivery"
    if [[ "$comment_id" =~ ^[0-9]+$ ]]; then
      security_marker="withdrawn issue-comment:$comment_id"
    fi
    if [[ ! "$comment_id" =~ ^[1-9][0-9]*$ || "$(jq -r '.action' "$event_path")" != deleted ]]; then
      security_withdrawal_unresolved=true
    fi
    stamp_status "review-security-history" pending "Security review invalidated at $withdrawal_at; $security_marker on head $head_sha" >/dev/null
    edited_clean=true
  fi
  if [[ "$security_event" != true && "$(jq -r '.action' "$event_path")" == edited ]]; then
    prior_body="$(jq -r '.changes.body.from // empty' "$event_path")"
    prior_id="$(jq -r '.comment.id // empty' "$event_path")"
    if [[ -n "$prior_body" ]] && jq -en --arg body "$prior_body" --arg head "$head_sha" --arg prefix "$head_prefix" '
      $body | contains("`" + $head + "`") or contains("`" + $prefix + "`")' >/dev/null; then
      prior_evidence="$(regular_evidence "$prior_body" "$prior_id")"
      if jq -e --arg id "issue-comment-$prior_id" 'any(.deliveries[]; .id == $id and (.clean | not))' <<< "$prior_evidence" >/dev/null; then
        stamp_status "review-finding-history" pending "Regular findings observed on head $head_sha" >/dev/null
        # A status read immediately after writing can lag. Carry this fact
        # into both branches in memory as well as the durable history.
        edited_finding=true
        finding_after="$(normalize_timestamp "$(jq -r '.comment.updated_at' "$event_path")")"
        evidence_after="$finding_after"
      fi
    fi
    edited_evidence="$(regular_evidence)"
    if jq -e --slurpfile event "$event_path" '
      any(.deliveries[]; .source == "issue_comment" and .clean and
          .id == ("issue-comment-" + ($event[0].comment.id | tostring)) and .body == $event[0].comment.body)
    ' <<< "$edited_evidence" >/dev/null; then
      edited_clean=true
    fi
  fi
  if [[ "$edited_clean" != true ]]; then
    withdrawal_at="$(jq -r '.comment.updated_at // empty' "$event_path")"
    withdrawal_at="${withdrawal_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    comment_id="$(jq -r '.comment.id // empty' "$event_path")"
    if [[ "$comment_id" =~ ^[0-9]+$ ]]; then
      withdrawal_marker="withdrawn issue-comment:$comment_id"
    else
      withdrawal_marker="withdrawn delivery"
    fi
    stamp_status "$REVIEW_REVIEW_CONTEXT" pending "Regular review invalidated at $withdrawal_at; $withdrawal_marker" >/dev/null
    evidence_after="$(normalize_timestamp "$withdrawal_at")"
  fi
fi

# Requests schedule work; only findings, comparison changes, or withdrawn
# evidence invalidate a completed review.
refresh_review_timeline_watermark() {
  if [[ "${REQUIRE_TIMELINE_FRESHNESS:-false}" == true ]]; then
    local latest_base_at
    latest_base_at="$(gh api "repos/$REPO/issues/$pr_number/timeline?per_page=100" --paginate --slurp \
      | jq -r '[.[][] | select(.event == "base_ref_changed" or .event == "base_ref_force_pushed") | (.updated_at // .created_at)]' | latest_timestamp)"
    latest_base_at="$(normalize_timestamp "$latest_base_at")"
    if [[ "$latest_base_at" > "$evidence_after" ]]; then evidence_after="$latest_base_at"; fi
  fi
}

# The event head was revoked before its first API read. Revoke the
# resolved head as well for manual dispatches and stale event payloads.
stamp_review_gate pending "Evaluating the regular review on $head_prefix"
if ! head_prefix_resolves; then
  stamp_review_gate pending "Could not uniquely resolve the abbreviated head on $head_prefix"
  echo "The abbreviated head marker did not resolve uniquely to the exact pull request head."
  gate_pending
fi
refresh_review_timeline_watermark
gate_snapshot="$(read_gate_snapshot)"
require_clean_regular_snapshot "$gate_snapshot"
if [[ "${RECORD_EVENT_ONLY:-false}" == true ]]; then
  echo "Review event history recorded; candidate proof still owns success publication."
  gate_pending
fi

# Re-read every merge-relevant input immediately before success. This
# catches a new result, finding, comment, head, or base change that
# arrived while the first snapshot was being evaluated.
final_pr_snapshot="$(read_pr_snapshot)"
IFS=$'\t' read -r final_head_sha final_base_sha final_base_ref final_is_draft final_pr_node_id final_auto_merge_enabled final_pr_state final_pr_author_login final_head_repo <<< "$final_pr_snapshot"
if [[ "$final_pr_state" != "OPEN" ]]; then
  echo "The PR was closed during evaluation; it was not marked successful."
  gate_pending
fi
if [[ "$final_head_sha" != "$head_sha" || "$final_pr_author_login" != "$pr_author_login" || "$final_head_repo" != "$head_repo" ]]; then
  echo "The PR head changed during evaluation; its synchronize event will re-evaluate it."
  gate_pending
fi
if [[ "$final_base_sha" != "$base_sha" ]]; then
  stamp_base_change_marker
  stamp_review_gate pending "Base changed; push a new head for a fresh regular review"
  echo "The PR base changed during evaluation; push a new head before requesting a regular review."
  gate_pending
fi
if [[ "$final_base_ref" != "$DEFAULT_BRANCH" || "$final_is_draft" != "false" || "$final_auto_merge_enabled" != "false" ]]; then
  if [[ "$final_auto_merge_enabled" == "true" ]]; then
    disable_auto_merge "$final_pr_node_id"
    echo "Disabled automatic merge that was enabled during evaluation."
  fi
  stamp_review_gate pending "Pull request state changed during review evaluation"
  echo "The PR became draft or automatic merge was enabled during evaluation."
  gate_pending
fi
refresh_review_timeline_watermark
final_gate_snapshot="$(read_gate_snapshot)"
require_clean_regular_snapshot "$final_gate_snapshot"

last_pr_snapshot="$(read_pr_snapshot)"
IFS=$'\t' read -r last_head_sha last_base_sha last_base_ref last_is_draft last_pr_node_id last_auto_merge_enabled last_pr_state last_pr_author_login last_head_repo <<< "$last_pr_snapshot"
if [[ "$last_head_sha" != "$head_sha" || "$last_base_sha" != "$base_sha" || "$last_base_ref" != "$DEFAULT_BRANCH" || "$last_is_draft" != "false" || "$last_auto_merge_enabled" != "false" || "$last_pr_state" != "OPEN" || "$last_pr_author_login" != "$pr_author_login" || "$last_head_repo" != "$head_repo" ]]; then
  if [[ "$last_head_sha" == "$head_sha" && "$last_base_sha" != "$base_sha" ]]; then
    stamp_base_change_marker
    stamp_review_gate pending "Base changed; push a new head for a fresh regular review"
  fi
  if [[ "$last_auto_merge_enabled" == "true" ]]; then
    disable_auto_merge "$last_pr_node_id"
    echo "Disabled automatic merge that was enabled during final revalidation."
  fi
  echo "The PR state changed during final revalidation; it was not marked successful."
  gate_pending
fi
final_shared_head_owner="$(shared_open_head_owner)"
if [[ "$final_shared_head_owner" != "$pr_number" ]]; then
  stamp_review_gate pending "Current head is shared by multiple open pull requests"
  echo "The current open PR head is ambiguous or no longer belongs to this PR."
  gate_pending
fi

evidence_source="$(jq -r '.verdict.source // empty' <<< "$final_gate_snapshot")"
evidence_id="$(jq -r '.verdict.id // empty' <<< "$final_gate_snapshot")"
case "$evidence_source" in
  review)
    [[ "$evidence_id" =~ ^[1-9][0-9]*$ ]] || exit 1
    evidence_marker="review:$evidence_id"
    ;;
  issue_comment)
    evidence_comment_id="${evidence_id#issue-comment-}"
    [[ "$evidence_comment_id" =~ ^[1-9][0-9]*$ ]] || exit 1
    evidence_marker="issue-comment:$evidence_comment_id"
    ;;
  *)
    echo "Could not persist the current clean regular-review evidence." >&2
    exit 1
    ;;
esac
stamp_review_gate success "Clean regular review for $head_prefix; evidence $evidence_marker"
trap 'stamp_review_gate pending "Review state could not be revalidated after publication"; exit 1' ERR
refresh_review_timeline_watermark
post_success_snapshot="$(read_gate_snapshot)"
require_clean_regular_snapshot "$post_success_snapshot"
post_snapshot="$(read_pr_snapshot)"
post_node="$(cut -f5 <<< "$post_snapshot")"
  post_auto="$(cut -f6 <<< "$post_snapshot")"
if [[ "$post_auto" == true ]]; then
  disable_auto_merge "$post_node"
  stamp_review_gate pending "Automatic merge was enabled during publication"
  gate_pending
fi
if [[ "$post_success_snapshot" != "$final_gate_snapshot" || "$post_snapshot" != "$last_pr_snapshot" || "$(shared_open_head_owner)" != "$pr_number" ]]; then
  stamp_review_gate pending "Review state changed while publishing success"
  gate_pending
fi
echo "The exact pull request head has an affirmative clean regular review."
echo "Security findings are independently blocking and never qualify as regular-review evidence."
echo "This workflow never enables or performs a merge."
