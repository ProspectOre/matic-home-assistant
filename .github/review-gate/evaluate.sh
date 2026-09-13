#!/usr/bin/env bash
set -Eeuo pipefail
# Bash 3.2 otherwise loses errexit inside nested command substitutions.
trap 'exit 1' ERR

# One canonical policy, loaded by hash-pinned trusted workflow adapters.
# Adapters supply repository and status contexts; regular review is Codex-only.
evidence_only="${EVIDENCE_ONLY:-false}"
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
finding_after="$(normalize_timestamp "$finding_after")"
head_observed_at="$(normalize_timestamp "$head_observed_at")"
evidence_after="$finding_after"
if [[ -n "$head_observed_at" && "$head_observed_at" > "$evidence_after" ]]; then
  evidence_after="$head_observed_at"
fi
# Self-hosted runner services cache PATH at launch; export the
# Homebrew paths so gh/jq resolve instead of failing with 127.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -n "${REVIEW_GATE_GH:-}" ]]; then
  gh() { "$REVIEW_GATE_GH" "$@"; }
fi
command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required to evaluate review evidence."
  exit 1
}
command -v jq >/dev/null || {
  echo "jq is required to evaluate review evidence."
  exit 1
}

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
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
  printf '%s\n' "$statuses" | jq -e --arg context "$REVIEW_BASE_CONTEXT" --arg prefix "Base changed for PR #$pr_number (" '
    any(.[][]; .context == $context and .state == "pending" and ((.description // "") | startswith($prefix)))' >/dev/null
}

rollout_marker_exists() {
  [[ -n "${REVIEW_ROLLOUT_CONTEXT:-}" ]] || return 1
  local statuses
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  printf '%s\n' "$statuses" | jq -e --arg context "$REVIEW_ROLLOUT_CONTEXT" \
    'any(.[][]; .context == $context and .state == "pending")' >/dev/null
}

latest_regular_issue_comment_at() {
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -r --arg context "$REVIEW_COMMENT_CONTEXT" '
        [.[][]
         | select(.context == $context)
         | select(.state == "pending")
         | select((.description // "") | startswith("Regular issue-comment invalidated;"))
         | .updated_at]
        | max // empty'
}

latest_regular_review_invalidation_at() {
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -r --arg context "$REVIEW_REVIEW_CONTEXT" '
        [.[][]
         | select(.context == $context)
         | select(.state == "pending")
         | (.description // "") as $description
         | select($description | startswith("Regular review invalidated"))
         | if ($description | test("^Regular review invalidated at [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z;"))
           then ($description | capture("^Regular review invalidated at (?<at>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z);").at)
           else .updated_at
           end]
        | max // empty'
}

active_security_finding_count() {
  local review_findings issue_comment_findings
  review_findings="$(
    # shellcheck disable=SC2016
    gh api graphql --paginate \
      -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(first: 100, after: $endCursor) { nodes { state body author { login ... on Bot { id } } commit { oid } } pageInfo { hasNextPage endCursor } } } } }' \
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
           | select($lower | contains("[view security finding report]("))
           | select(($body | contains("`" + $head + "`")) or ($body | contains("`" + $prefix + "`")))]
          | length'
  )"
  issue_comment_findings="$(
    gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp \
      | jq -r --arg bot "$SECURITY_REVIEW_BOT_EVENT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" '
          [.[][]
           | select((.user.login // "") == $bot and .user.id == 199175422 and .user.type == "Bot")
           | (.body // "") as $body
           | ($body | ascii_downcase) as $lower
           | select($lower | contains("codex security review"))
           | select($lower | contains("[view security finding report]("))
           | select(($body | contains("`" + $head + "`")) or ($body | contains("`" + $prefix + "`")))]
          | length'
  )"
  [[ "$review_findings" =~ ^[0-9]+$ && "$issue_comment_findings" =~ ^[0-9]+$ ]] || return 1
  echo $((review_findings + issue_comment_findings))
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
            test("(?is)^[[:space:]]*#{1,6}[^\\r\\n]*codex[[:space:]]+review[[:space:]]*\\r?\\n[[:space:]]*\\r?\\n[[:space:]]*here are some automated review suggestions for this pull request\\.[[:space:]]*\\r?\\n[[:space:]]*\\r?\\n[[:space:]]*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*\\r?\\n[[:space:]]*<details>")
            or test("(?is)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review:[[:space:]]*didn.t find any major issues\\.[^\\r\\n]*(?:\\r?\\n[[:space:]]*)+\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*(?:\\r?\\n[[:space:]]*)+<details>[[:space:]]*<summary>[^\\r\\n]*codex[[:space:]]+in[[:space:]]+github")
            or test("(?is)^[[:space:]]*#{1,6}[^\\r\\n]*(?:codex[[:space:]]+review|review result):[[:space:]]*(?:didn.t find any issues|no issues found)\\.[[:space:]]*(?:\\r?\\n[[:space:]]*)*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*$");
          [.[]
           | .data.repository.pullRequest.reviews.nodes[]?
           | select((.author.login // "") == $bot and .author.id == "BOT_kgDOC98s_g")
           | select((.state // "") != "DISMISSED")
           | select((.commit.oid // "") == $head)
           | (.body // "") as $body
           | select($body | regular_heading)
           | select(($body | security_heading) | not)
           | select(($body | availability_notice) | not)
           | select($body | exact_head)
           | {at: (.updatedAt // .submittedAt),
              id: (.databaseId | tostring),
              source: "review",
              clean: ($body | stock_clean_envelope)}]'
  )"
  issue_comment_records="$(
    gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp \
      | jq -c --arg bot "$REVIEW_BOT_EVENT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" '
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
            test("(?is)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review:[[:space:]]*didn.t find any major issues\\.[^\\r\\n]*(?:\\r?\\n[[:space:]]*)+\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*(?:\\r?\\n[[:space:]]*)+<details>[[:space:]]*<summary>[^\\r\\n]*codex[[:space:]]+in[[:space:]]+github")
            or test("(?is)^[[:space:]]*#{1,6}[^\\r\\n]*(?:codex[[:space:]]+review|review result):[[:space:]]*(?:didn.t find any issues|no issues found)\\.[[:space:]]*(?:\\r?\\n[[:space:]]*)*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*$");
          [.[][]
           | select((.user.login // "") == $bot and .user.id == 199175422 and .user.type == "Bot")
           | (.body // "") as $body
           | select($body | regular_heading)
           | select(($body | security_heading) | not)
           | select(($body | availability_notice) | not)
           | select($body | exact_head)
           | {at: (.updated_at // .created_at),
              id: ("issue-comment-" + (.id | tostring)),
              source: "issue_comment",
              clean: ($body | stock_clean_issue_comment_envelope)}]'
  )"
  jq -cn --argjson reviews "$review_records" --argjson issue_comments "$issue_comment_records" '
    {deliveries: ($reviews + $issue_comments),
     review_ids: [$reviews[].id]}'
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

shared_open_head_count() {
  # Commit statuses are keyed by SHA, not PR number. A shared open
  # head is therefore fail-closed rather than borrowing another PR's
  # clean status or review evidence.
  gh api "repos/$REPO/pulls?state=open&per_page=100" --paginate \
    | jq -rs --arg head "$head_sha" '
        [.[][] | select((.head.sha // "") == $head) | .number]
        | unique
        | length'
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

read_gate_snapshot() {
  local evidence deliveries reviews review_ids thread_summary verdict_selection verdict finding_count security_finding_count latest_finding_at issue_comment_at review_invalidation_at
  evidence="$(regular_evidence)"
  deliveries="$(jq -c '.deliveries' <<< "$evidence")"
  reviews="$(jq -c '[.deliveries[] | select(.source == "review")]' <<< "$evidence")"
  review_ids="$(jq -c '.review_ids' <<< "$evidence")"
  thread_summary="$(regular_review_thread_summary "$review_ids")"
  verdict_selection="$(
    issue_comment_at="$(latest_regular_issue_comment_at)"
    review_invalidation_at="$(latest_regular_review_invalidation_at)"
    jq -cn --argjson deliveries "$deliveries" --argjson reviews "$reviews" --argjson thread_summary "$thread_summary" --arg issue_comment_at "$issue_comment_at" --arg review_invalidation_at "$review_invalidation_at" '
      ($thread_summary | map(select(.total_count > 0) | .id)) as $finding_ids
      | (([$deliveries[] | select(.clean | not) | .at]
          + [$reviews[]
             | select(.id as $id | ($finding_ids | index($id)) != null)
             | .at]
          + (if $issue_comment_at == "" then [] else [$issue_comment_at] end)
          + (if $review_invalidation_at == "" then [] else [$review_invalidation_at] end))
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
  security_finding_count="$(active_security_finding_count)"
  jq -cn \
    --argjson verdict "$verdict" \
    --argjson finding_count "$finding_count" \
    --argjson security_finding_count "$security_finding_count" \
    --arg latest_finding_at "$latest_finding_at" \
    '{verdict: $verdict,
      finding_count: $finding_count,
      security_finding_count: $security_finding_count,
      latest_finding_at: $latest_finding_at}'
}

require_clean_regular_snapshot() {
  local gate_snapshot="$1"
  local verdict verdict_at finding_count security_finding_count latest_finding_at
  verdict="$(jq -c '.verdict' <<< "$gate_snapshot")"
  latest_finding_at="$(jq -r '.latest_finding_at // empty' <<< "$gate_snapshot")"
  finding_count="$(jq -r '.finding_count' <<< "$gate_snapshot")"
  security_finding_count="$(jq -r '.security_finding_count' <<< "$gate_snapshot")"
  write_finding_observation "$latest_finding_at"
  if [[ "$security_finding_count" -gt 0 ]]; then
    stamp_review_gate pending "Codex Security reported findings on $head_prefix"
    echo "Codex Security reported $security_finding_count findings-bearing result(s) on the exact head."
    echo "Fix them, push a new head, and request review again."
    gate_pending
  fi
  if [[ "$finding_count" -gt 0 && -n "$latest_finding_at" ]]; then
    stamp_status "$REVIEW_REVIEW_CONTEXT" pending \
      "Regular review invalidated at $latest_finding_at; active regular findings require a newer clean normal verdict"
  fi
  if base_change_marker_exists; then
    stamp_review_gate pending "Base changed; push a new head for a fresh regular review"
    echo "The base-change marker requires a new PR head and regular review."
    gate_pending
  fi
  if rollout_marker_exists; then
    stamp_review_gate pending "Review-gate rollout reset; push a new head for a fresh regular review"
    echo "The policy rollout marker requires a new PR head and regular review."
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
shared_head_count="$(shared_open_head_count)"
shared_head_owner="$(shared_open_head_owner)"
if [[ "$shared_head_count" != "1" || "$shared_head_owner" != "$pr_number" ]]; then
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

# Classify the whole diff for every author. A dependency title, branch, label,
# or bot login alone never exempts unrelated application/workflow changes.
stamp_review_gate pending "Classifying dependency-only changes on $head_prefix"
classifier="${DEPENDENCY_CLASSIFIER:-${BASH_SOURCE[0]}.dependencies.py}"
[[ -f "$classifier" ]] || { echo "Canonical dependency classifier is missing." >&2; exit 1; }
# This helper is called only in command substitutions. Exit 3 is a normal
# classification result, so do not translate it through the inherited ERR trap.
classify_dependencies() {
  trap - ERR
  REPO="$REPO" PR_NUMBER="$pr_number" HEAD_SHA="$head_sha" BASE_SHA="$base_sha" \
    python3 "$classifier"
}
dependency_digest=""
if dependency_digest="$(classify_dependencies)"; then
  [[ "$dependency_digest" =~ ^[0-9a-f]{64}$ ]] || exit 1
  require_no_security_findings
  if base_change_marker_exists || rollout_marker_exists; then
    stamp_review_gate pending "Base or policy changed; push a fresh dependency head"
    gate_pending
  fi
  final_pr_snapshot="$(read_pr_snapshot)"
  IFS=$'\t' read -r final_head_sha final_base_sha final_base_ref final_is_draft final_pr_node_id final_auto_merge_enabled final_pr_state final_pr_author_login final_head_repo <<< "$final_pr_snapshot"
  if [[ "$final_head_sha" != "$head_sha" || "$final_base_sha" != "$base_sha" || "$final_base_ref" != "$DEFAULT_BRANCH" || "$final_is_draft" != "false" || "$final_auto_merge_enabled" != "false" || "$final_pr_state" != "OPEN" || "$final_pr_author_login" != "$pr_author_login" || "$final_head_repo" != "$head_repo" ]]; then
    echo "Candidate changed during dependency exemption verification."
    gate_pending
  fi
  final_dependency_digest="$(classify_dependencies)" || exit 1
  [[ "$final_dependency_digest" == "$dependency_digest" ]] || exit 1
  final_shared_head_count="$(shared_open_head_count)"
  final_shared_head_owner="$(shared_open_head_owner)"
  if [[ "$final_shared_head_count" != "1" || "$final_shared_head_owner" != "$pr_number" ]]; then
    stamp_review_gate pending "Current head is shared by multiple open pull requests"
    gate_pending
  fi
  require_no_security_findings
  if base_change_marker_exists || rollout_marker_exists; then
    stamp_review_gate pending "Base or policy changed; push a fresh dependency head"
    gate_pending
  fi
  # Close the final classifier/listing window before publishing the exact SHA.
  [[ "$(read_pr_snapshot)" == "$final_pr_snapshot" ]] || gate_pending
  stamp_review_gate success "Dependencies exempt for $head_prefix; diff ${dependency_digest:0:16}"
  trap 'stamp_review_gate pending "Dependency state could not be revalidated after publication"; exit 1' ERR
  require_no_security_findings
  if [[ "$(read_pr_snapshot)" != "$final_pr_snapshot" ]] || base_change_marker_exists || rollout_marker_exists; then
    stamp_review_gate pending "Dependency state changed while publishing success"
    gate_pending
  fi
  echo "Dependency-only PR exempt from Codex review; CI and security checks remain required."
  exit 0
else
  classification_status=$?
  [[ "$classification_status" == 3 ]] || exit 1
fi

# The event head was revoked before its first API read. Revoke the
# resolved head as well for manual dispatches and stale event payloads.
stamp_review_gate pending "Evaluating the regular review on $head_prefix"
if ! head_prefix_resolves; then
  stamp_review_gate pending "Could not uniquely resolve the abbreviated head on $head_prefix"
  echo "The abbreviated head marker did not resolve uniquely to the exact pull request head."
  gate_pending
fi
if [[ "${REQUIRE_TIMELINE_FRESHNESS:-false}" == true ]]; then
  timeline_watermark="$(gh api "repos/$REPO/issues/$pr_number/timeline?per_page=100" --paginate --slurp \
    | jq -r '[.[][] | select(.event == "base_ref_changed" or .event == "base_ref_force_pushed" or (.event == "commented" and ((.author_association // "") == "OWNER" or (.author_association // "") == "MEMBER" or (.author_association // "") == "COLLABORATOR") and ((.body // "") | contains("@codex review")))) | (.updated_at // .created_at)] | max // empty')"
  timeline_watermark="$(normalize_timestamp "$timeline_watermark")"
  if [[ "$timeline_watermark" > "$evidence_after" ]]; then evidence_after="$timeline_watermark"; fi
fi
gate_snapshot="$(read_gate_snapshot)"
require_clean_regular_snapshot "$gate_snapshot"

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
final_shared_head_count="$(shared_open_head_count)"
final_shared_head_owner="$(shared_open_head_owner)"
if [[ "$final_shared_head_count" != "1" || "$final_shared_head_owner" != "$pr_number" ]]; then
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
post_success_snapshot="$(read_gate_snapshot)"
require_clean_regular_snapshot "$post_success_snapshot"
if [[ "$post_success_snapshot" != "$final_gate_snapshot" || "$(read_pr_snapshot)" != "$last_pr_snapshot" ]]; then
  stamp_review_gate pending "Review state changed while publishing success"
  gate_pending
fi
echo "The exact pull request head has an affirmative clean regular review."
echo "Security findings are independently blocking and never qualify as regular-review evidence."
echo "This workflow never enables or performs a merge."
