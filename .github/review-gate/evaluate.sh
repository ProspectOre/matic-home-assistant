#!/usr/bin/env bash
set -Eeuo pipefail
# Bash 3.2 otherwise loses errexit inside nested command substitutions.
trap 'exit 1' ERR

# One canonical policy, loaded by hash-pinned trusted workflow adapters.
# Adapters supply repository and status contexts; regular review is Codex-only.
evidence_only="${EVIDENCE_ONLY:-false}"
event_history_phase_done=false
history_reconciled=false
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
  if [[ "${RECORD_EVENT_ONLY:-false}" == true && "$event_history_phase_done" == false ]]; then
    return 0
  fi
  # A direct issue-comment workflow writes its receipt before evaluating the
  # PR's base/draft/head eligibility. Keep processing the authenticated event
  # until its history is recorded and the receipt can be acknowledged.
  if [[ "${REVIEW_NATIVE_EVENT_ID:-}" =~ ^[1-9][0-9]*$ && "$event_history_phase_done" == false ]]; then
    [[ -n "${event_path:-}" ]] || exit 1
    return 0
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
security_heading_pattern='(?i)\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\r\n]+[[:space:]]+)?)?(?:codex[[:space:]-]+)?security(?:[[:space:]-]+)review(?:[[:space:]]*:|[[:space:]]*[^[:alnum:][:space:]][^\r\n]*|[[:space:]]*$)'
security_clean_report_pattern='(?is)\A[[:space:]]*(?:#{1,6}[[:space:]]+)?(?:[^[:alnum:]\r\n]+[[:space:]]+)?(?:codex[[:space:]-]+)?security[[:space:]-]+review(?:[ \t]+·[ \t]+_automatically triggered_|:)?[ \t]*\r?\n(?:[ \t]*\r?\n)*(?:[ \t]*security review completed[.!]?[ \t]*(?:\r?\n[ \t]*)?)?(?:no (?:security )?issues (?:were )?found(?: in this pull request)?|didn.t find any (?:major )?issues(?: in this pull request)?)[.!]?[ \t]*\r?\n(?:[ \t]*\r?\n)*(?:\*\*reviewed commit:\*\*[ \t]*\x60[0-9a-f]{7,40}\x60[ \t]*\r?\n(?:[ \t]*\r?\n)*)?\[view security finding report\]\([^\r\n)]+\)'
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
# Self-hosted runner services cache PATH at launch; export the
# Homebrew paths before any jq/python/date helper is invoked.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
normalize_timestamp() {
  jq -nr --arg value "$1" '
    if $value == "" then ""
    elif ($value | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$")) | not then error("invalid RFC3339 timestamp")
    else ($value | capture("^(?<base>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.(?<fraction>[0-9]+))?Z$")
      | .base + "." + ((.fraction // "") + "000000" | .[0:6]) + "Z") as $normalized
      | ($normalized | sub("\\.[0-9]+Z$"; "Z")) as $whole
      | ($whole | fromdateiso8601) as $epoch
      | ($epoch | todate) as $roundtrip
      | if $roundtrip != $whole then error("invalid calendar timestamp") else $normalized end
    end'
}
timestamp_event_tag() {
  python3 -c '
from datetime import datetime, timezone
import sys

value = datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
delta = value - datetime(1970, 1, 1, tzinfo=timezone.utc)
microseconds = (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds
if microseconds < 0 or microseconds >= 1 << 56:
    raise SystemExit("event timestamp is outside the supported range")
print(format(microseconds, "014x"))
' "$1"
}
latest_timestamp() {
  jq -r '
    map(select(. != "")
      | (if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$") | not
          then error("invalid RFC3339 timestamp")
          else capture("^(?<base>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.(?<fraction>[0-9]+))?Z$")
        end | .base + "." + ((.fraction // "") + "000000" | .[0:6]) + "Z") as $normalized
      | ($normalized | sub("\\.[0-9]+Z$"; "Z")) as $whole
      | ($whole | fromdateiso8601) as $epoch
      | ($epoch | todate) as $roundtrip
      | if $roundtrip != $whole then error("invalid calendar timestamp") else $normalized end)
    | max // ""'
}
normalize_delivery_timestamps() {
  jq '
    def normalized_timestamp:
      if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$") | not then error("invalid RFC3339 timestamp")
      else capture("^(?<base>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.(?<fraction>[0-9]+))?Z$") as $parts
        | ($parts.base + "." + (($parts.fraction // "") + "000000" | .[0:6]) + "Z") as $normalized
        | ($normalized | sub("\\.[0-9]+Z$"; "Z")) as $whole
        | ($whole | fromdateiso8601 | todate) as $roundtrip
        | if $roundtrip != $whole then error("invalid calendar timestamp") else $normalized end
      end;
    .deliveries |= map(
      .at |= normalized_timestamp
      | .created_at |= (if . == null or . == "" then . else normalized_timestamp end))'
}
finding_after="$(normalize_timestamp "$finding_after")"
head_observed_at="$(normalize_timestamp "$head_observed_at")"
evidence_after="$finding_after"
if [[ -n "$head_observed_at" && "$head_observed_at" > "$evidence_after" ]]; then
  evidence_after="$head_observed_at"
fi
event_name="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
event_path="${FORWARDED_EVENT_PATH:-${GITHUB_EVENT_PATH:-}}"
historical_event_head=false
native_security_finding_observed=false

body_targets_review_head() {
  local body="$1" target_head="$2"
  [[ "$target_head" =~ ^[0-9a-f]{40}$ ]] || return 1
  jq -en --arg body "$body" --arg head "$target_head" --arg prefix "${target_head:0:10}" '
    def coordinator_prelude:
      test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
    if ($body | coordinator_prelude) then
      ($body | capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head) == $head
    else
      ($body | test("(?im)reviewed commit:[*]*[ \\t]*`(" + $head + "|" + $prefix + ")`"))
    end' >/dev/null
}

# Native receipts authenticate delivery, not the reviewed commit. Require an
# in-band current/prior body binding before recording permanent head history.
native_issue_comment_event_bound() {
  [[ "$event_name" == issue_comment && -f "$event_path" ]] || return 1
  [[ "${REVIEW_NATIVE_EVENT_ID:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$event_head_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  jq -e --argjson number "$pr_number" '
    (.action == "created" or .action == "edited" or .action == "deleted")
    and (.issue.number | type == "number" and . == $number)
    and .issue.pull_request != null
    and (.comment.id | type == "number" and . > 0 and floor == .)
    and .comment.user.id == 199175422
    and .comment.user.login == "chatgpt-codex-connector[bot]"
    and .comment.user.type == "Bot"
  ' "$event_path" >/dev/null || return 1
  jq -e --arg head "$event_head_sha" --arg prefix "${event_head_sha:0:10}" --arg clean_security_report_pattern "$security_clean_report_pattern" '
    def coordinator_prelude:
      test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
    def body_refs:
      . as $body
      | ([scan("(?i)(?:^|\\n)[ \\t]*\\*{0,2}reviewed commit:\\*{0,2}[ \\t]*`([0-9a-f]{40}|[0-9a-f]{10})`(?:(?:\\r?\\n[ \\t]*)+\\[view security finding report\\]\\([^\\r\\n)]+\\)(?:[ \\t]*(?:\\r?\\n[ \\t]*)+_only the user who started this review can view the report in codex\\._)?(?:[ \\t]*(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?about codex security reviews in github</summary>[\\s\\S]*?</details>)?|(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?About Codex(?: reviews)? in GitHub</summary>[\\s\\S]*?</details>)?[ \\t]*(?:\\r?\\n[ \\t]*)*$") | .[0] | ascii_downcase]
         + [if ($body | coordinator_prelude) then
              ($body | capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head)
            else empty end]
         | unique);
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
     def clean_security_envelope:
  if test($clean_security_report_pattern) then
    (sub($clean_security_report_pattern; "")
      | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
      | gsub("\r"; "")
      | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
          def has_security_report_link:
            (ascii_downcase) as $lower
            | ($lower | contains("[view security finding report]("))
              and ((($lower | clean_security_envelope) | not)
                   or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));

    [.comment.body // "", (if .action == "edited" then .changes.body.from // "" else empty end)] as $bodies
    | any($bodies[]; body_refs | any(.[]; . == $head or . == $prefix))
      and all($bodies[];
        if test("(?i)codex-security-review-finding:v1") or
           has_security_report_link
        then (body_refs | any(.[]; . == $head or . == $prefix)) else true end)
  ' "$event_path" >/dev/null
}
gh_path="${REVIEW_GATE_GH:-$(command -v gh || true)}"
[[ -n "$gh_path" ]] || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
gh() {
  local cache_key cache_file response argument readonly=false
  if [[ -n "${REVIEW_READ_CACHE:-}" && "${1:-}" == api ]]; then
    case "${2:-}" in
      */statuses\?*|*/comments\?*|*/actions/runs/*|*/actions/workflows/*) readonly=true ;;
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
gh_uncached() {
  REVIEW_READ_CACHE="" gh "$@"
}
# Share immutable API reads across one evaluator pass. Cache entries are
# invalidated on every API mutation and at each consistency-snapshot boundary.
REVIEW_READ_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/review-snapshot.XXXXXX")"
export REVIEW_READ_CACHE
trap 'rm -rf "$REVIEW_READ_CACHE"' EXIT
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
native_event_head_bound=false

capture_receipt_is_authenticated() {
  local receipt="$1" context capture_id scoped_pr description target_url expected_url run_id workflow_file workflow_id run
  context="$(jq -r '.context // empty' <<< "$receipt")" || return 1
  scoped_pr=""
  if [[ "$context" =~ ^review-event-capture/([1-9][0-9]*)$ ]]; then
    capture_id="${BASH_REMATCH[1]}"
  elif [[ "$context" =~ ^review-event-capture/([1-9][0-9]*)/([1-9][0-9]*)$ ]]; then
    scoped_pr="${BASH_REMATCH[1]}"
    capture_id="${BASH_REMATCH[2]}"
    [[ "$scoped_pr" == "$pr_number" ]] || return 1
  else
    return 1
  fi
  description="$(jq -r '.description // empty' <<< "$receipt")" || return 1
  [[ "$description" == "Review event capture consumed for PR #$pr_number" ]] || return 1
  jq -e '.state == "success" and .creator.login == "github-actions[bot]"
    and .creator.type == "Bot" and .creator.id == 41898282' <<< "$receipt" >/dev/null || return 1
  target_url="$(jq -r '.target_url // empty' <<< "$receipt")" || return 1
  expected_url="${GITHUB_SERVER_URL:-https://github.com}/$REPO/actions/runs/"
  [[ "$target_url" == "$expected_url"* ]] || return 1
  run_id="${target_url#"$expected_url"}"
  [[ "$run_id" =~ ^[1-9][0-9]*$ && "$target_url" == "$expected_url$run_id" ]] || return 1
  workflow_file="${REVIEW_GATE_WORKFLOW_FILE:-review-gate.yml}"
  [[ "$workflow_file" =~ ^[A-Za-z0-9._-]+\.yml$ ]] || return 1
  workflow_id="$(gh api "repos/$REPO/actions/workflows/$workflow_file" --jq '.id | select(type == "number" and . > 0)')" || return 2
  [[ "$workflow_id" =~ ^[1-9][0-9]*$ ]] || return 2
  run="$(gh api "repos/$REPO/actions/runs/$run_id")" || return 2
  jq -e --arg repo "$REPO" --arg branch "$DEFAULT_BRANCH" --arg id "$run_id" \
      --arg workflow "$workflow_id" --arg path ".github/workflows/$workflow_file" \
      --arg pr "$pr_number" --arg capture "$capture_id" --arg head "$head_sha" '
    .id == ($id | tonumber)
    and .workflow_id == ($workflow | tonumber)
    and .repository.full_name == $repo
    and .path == $path
    and .event == "workflow_dispatch"
    and .head_branch == $branch
    and .status == "completed"
    and .conclusion == "success"
    and ((.display_title // "") | test("^Review gate PR #" + $pr
      + " \\| policy-workflow-sha=[0-9a-f]{40} \\| event-capture=" + $capture
      + " \\| (event-head=" + $head + "( \\| event-history-head=[0-9a-f]{40})?"
      + "|event-head=[0-9a-f]{40} \\| event-history-head=" + $head + ")$"))
  ' <<< "$run" >/dev/null || return 1
  return 0
}

stamp_status_for_sha() {
  local target_sha="$1"
  local context="$2"
  local state="$3"
  local description="$4"
  # GitHub commit-status descriptions are limited to 140 characters. History
  # records must fail closed rather than truncating the head or origin marker.
  if (( ${#description} > 140 )); then
    case "$context" in
      review-finding-history|review-security-history)
        echo "A finding-history status description exceeded GitHub's 140-character limit." >&2
        exit 1
        ;;
      *) description="${description:0:137}..." ;;
    esac
  fi
  local history
  if (( evidence_only_mode )); then
    return 0
  fi
  case "$context" in
    review-finding-history|review-security-history)
      # These contexts are append-only sets of origin observations, not a
      # latest-value state. Preserve each distinct record exactly once even
      # when another origin is the newest status in the same context.
      history="$(gh api "repos/$REPO/commits/$target_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
      if jq -e --arg context "$context" --arg state "$state" --arg description "$description" \
          'any(.[][]; .context == $context and .state == $state and .description == $description)' <<< "$history" >/dev/null; then
        return 0
      fi
      ;;
  esac
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
    -f query='query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { id state createdAt timelineItems(itemTypes: [REOPENED_EVENT], last: 100) { nodes { ... on ReopenedEvent { createdAt } } } headRefOid baseRefOid baseRefName isDraft author { login } headRepository { nameWithOwner } autoMergeRequest { enabledAt } } } }' \
    -F owner="$review_owner" \
    -F name="$review_repo" \
    -F number="$pr_number" \
    | jq -er '
        .data.repository.pullRequest as $pr
        | select($pr != null)
        | [$pr.headRefOid,
           (([$pr.timelineItems.nodes[]?.createdAt] | max) // $pr.createdAt),
           $pr.baseRefOid,
           $pr.baseRefName,
           ($pr.isDraft | tostring),
           $pr.id,
           (($pr.autoMergeRequest != null) | tostring),
           $pr.state,
           ($pr.author.login // ""),
           ($pr.headRepository.nameWithOwner // ""),
           $pr.createdAt]
        | @tsv'
}

pr_snapshot="$(read_pr_snapshot)"
IFS=$'\t' read -r head_sha pr_opened_at base_sha base_ref is_draft pr_node_id auto_merge_enabled pr_state pr_author_login head_repo pr_created_at <<< "$pr_snapshot"
if [[ ! "$head_sha" =~ ^[0-9a-f]{40}$ || ! "$base_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve valid pull request head and base SHAs."
  exit 1
fi
pr_opened_at="$(normalize_timestamp "$pr_opened_at")"
pr_created_at="$(normalize_timestamp "$pr_created_at")"
if [[ -n "$expected_base_sha" && "$base_sha" != "$expected_base_sha" ]]; then
  echo "The pull request base does not match EXPECTED_BASE_SHA; it remains pending."
  gate_pending
fi
if [[ ! "$pr_node_id" =~ ^PR_ || ! "$is_draft" =~ ^(true|false)$ || ! "$auto_merge_enabled" =~ ^(true|false)$ || ! "$pr_state" =~ ^(OPEN|CLOSED|MERGED)$ ]]; then
  echo "Could not resolve the pull request state for PR #$pr_number."
  exit 1
fi
if native_issue_comment_event_bound; then
  native_event_head_bound=true
elif [[ "$event_name" == issue_comment && "${REVIEW_NATIVE_EVENT_ID:-}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Native issue-comment receipt has no authenticated reviewed-head binding; leaving it pending."
  exit 1
fi
if [[ "$pr_state" != "OPEN" ]]; then
  echo "PR #$pr_number is no longer open; it will not publish review-gate."
  gate_pending
fi
if [[ -n "$event_head_sha" && "$event_head_sha" != "$head_sha" ]]; then
  if [[ "$native_event_head_bound" == true ]]; then
    echo "Recording the authenticated issue-comment event on captured PR head $event_head_sha."
    head_sha="$event_head_sha"
    historical_event_head=true
  elif [[ "${RECORD_EVENT_ONLY:-false}" == true && -f "$event_path" ]] &&
     jq -e --arg head "$event_head_sha" --argjson number "$pr_number" '
       .pull_request.number == $number
       and (.pull_request.head.sha | type == "string" and test("^[0-9a-f]{40}$"))
       and (if .review? != null then .review.commit_id == $head
            else .comment.original_commit_id == $head end)
     ' "$event_path" >/dev/null; then
    # A delayed relay records mutable review history against its immutable
    # commit, even if the webhook's PR head advanced before delivery. The
    # capture is reconcile-only and cannot publish a verdict for that head.
    echo "Recording the authenticated event on its historical PR head $event_head_sha."
    head_sha="$event_head_sha"
    historical_event_head=true
  else
    echo "The event head changed before evaluation; the newer PR event will re-evaluate it."
    gate_pending
  fi
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

associated_pull_numbers() {
  gh api "repos/$REPO/commits/$head_sha/pulls?per_page=100" --paginate --slurp \
    | jq -ce '
        if type != "array" or any(.[]; type != "array") then
          error("Invalid commit-associated PR pages")
        else [ .[][] | .number ]
          | if all(.[]; type == "number" and . > 0 and . == floor) then unique
            else error("Invalid commit-associated PR number") end
        end'
}

latest_regular_review_invalidation_at() {
  local statuses associated_prs='[]'
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  if jq -e --arg context "$REVIEW_REVIEW_CONTEXT" '
      any(.[][]; .context == $context and .state == "pending"
        and ((.description // "") | startswith("Regular review invalidated")
             and (test("^Regular review invalidated at [^;]+; PR #[1-9][0-9]*;") | not)))' \
      <<< "$statuses" >/dev/null; then
    associated_prs="$(associated_pull_numbers)" || exit 1
  fi
  jq -c --arg context "$REVIEW_REVIEW_CONTEXT" --arg pr "$pr_number" --argjson associated "$associated_prs" '
        [.[][]
         | select(.context == $context)
         | select(.state == "pending")
         | (.description // "") as $description
         | select($description | startswith("Regular review invalidated"))
         | select(if ($description | test("^Regular review invalidated at [^;]+; PR #[1-9][0-9]*;"))
                 then ($description | capture("^Regular review invalidated at [^;]+; PR #(?<pr>[1-9][0-9]*);").pr) == $pr
                 else (($associated | map(tostring)) == [$pr]
                       or (($associated | map(tostring) | index($pr)) != null)
                       or (($associated | length) == 0)) end)
         | if ($description | test("^Regular review invalidated at [^;]+;"))
           then ($description | capture("^Regular review invalidated at (?<at>[^;]+);").at)
           else .updated_at
           end]
        ' <<< "$statuses" | latest_timestamp
}

# Finding-history statuses are append-only authenticated observations. Their
# publication timestamp is the durable edit/finding watermark for legacy
# origins whose source event time was not captured. A dismissed native review
# contributes its authenticated update time, so either later observation keeps
# a clean verdict from passing. New relays carry source event time and avoid
# treating delayed publication as a newer finding.
latest_regular_finding_history_at() {
  local reviews="${1:-[]}"
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -c --arg context "review-finding-history" --arg head "$head_sha" --argjson number "$pr_number" --argjson reviews "$reviews" '
        def hex_microseconds($value):
          ($value | explode | reduce .[] as $char (0;
            . * 16 + (if $char >= 48 and $char <= 57 then $char - 48 else $char - 87 end)));
        def event_timestamp($value):
          (hex_microseconds($value)) as $microseconds
          | (($microseconds / 1000000) | floor | todate) as $whole
          | (($microseconds % 1000000) | tostring) as $fraction
          | ($whole | sub("Z$"; "." + (("000000" + $fraction)[-6:]) + "Z"));
        [.[][] | select(.context == $context)] as $history
        | [$history[] | select(.state == "pending") as $marker
           | ($marker.description // "") as $description
           | select(($description | contains("for PR #" + ($number | tostring) + " on head " + $head))
                    or (($description | contains("for PR #")) | not))
           | (try ($description | capture("; (?<origin>(?:review|issue-comment):[1-9][0-9]*)(?:; (?:sha256|h):[0-9a-f]{24})?(?:; (?:t|observed-at):[^;]+)?(?:; (?:event:captured|e:(?<event_hex>[0-9a-f]{14})))?$") ) catch {}) as $marker_fields
           | ($marker_fields.origin // "") as $origin
           | (try (if ($marker_fields.event_hex // "") != "" then event_timestamp($marker_fields.event_hex) else "" end) catch "") as $event_at
           | ("Regular clean receipt #" + ($marker.id | tostring) + " for PR #" + ($number | tostring) + " on head " + $head + "; " + $origin) as $compact_receipt
           | ("Regular clean history receipt #" + ($marker.id | tostring) + " for PR #" + ($number | tostring) + " on head " + $head + "; " + $origin) as $legacy_receipt
           | select(([$history[] | select(.state == "success") | .description] | index($compact_receipt)) == null
                   and ([$history[] | select(.state == "success") | .description] | index($legacy_receipt)) == null)
           | (if ($origin | test("^review:[1-9][0-9]*$")) then
                ([$reviews[] | select((.id | tostring) == ($origin | sub("^review:"; ""))
                                      and .dismissed == true) | .updated_at][0] // "") as $dismissed_at
                | if $event_at != "" then [$event_at, $dismissed_at] | map(select(. != ""))
                  else [($marker.updated_at // $marker.created_at // ""), $dismissed_at]
                       | map(select(. != "")) end
              elif $event_at != "" then [$event_at]
              else [($marker.updated_at // $marker.created_at // "")] end)[]]
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
      | jq -rs --arg bot "$SECURITY_REVIEW_BOT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" --arg security_heading_pattern "$security_heading_pattern" --arg clean_security_report_pattern "$security_clean_report_pattern" '
          def contains_security_heading:
            split("\n") | any(.[]; test($security_heading_pattern));
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
     def clean_security_envelope:
  if test($clean_security_report_pattern) then
    (sub($clean_security_report_pattern; "")
      | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
      | gsub("\r"; "")
      | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
          def has_security_report_link:
            (ascii_downcase) as $lower
            | ($lower | contains("[view security finding report]("))
              and ((($lower | clean_security_envelope) | not)
                   or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));
          def contains_security_marker:
            test("(?im)(?:\\A|\\n)[[:blank:]]*\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$")
            or test("(?is)\\A[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*(?:\\r?\\n|\\z)")
            or (contains_security_heading and test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$"));
          # Coordinator retries carry private diagnosis and request metadata
          # before the generated result.  Only inspect the authenticated result
          # section, so a quoted finding marker in that metadata cannot become
          # a live security finding.  Standalone review bodies remain intact.
          def coordinator_prelude:
            test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
          def coordinator_request: coordinator_prelude;
          def coordinator_metadata:
            test("(?s)\\A[[:space:]]*(?:(?:Retry reason:[^\\r\\n]*|Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*)[[:space:]]*)*\\z") and (test("(?i)\\bP[0-3]\\b") | not) and ((test("(?i)codex-security-review-finding:v1") | not) or test("(?s)\\A[[:space:]]*(?:Retry reason:[^\\r\\n]*\\r?\\n[[:space:]]*)*Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*(?i:codex-security-review-finding:v1)[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*[[:space:]]*\\z")) and ((gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not);
          def security_result_sections:
            . as $body
            | if coordinator_request then
                capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body
                | split("\n") as $lines
                | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern))] | .[0]) as $first_security
                | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))] | .[0]) as $first_result
                | if $first_security != null and $first_result != null and ($lines[:$first_result] | join("\n") | coordinator_metadata) then
                    [range(0; $lines | length) as $start
                     | select($lines[$start] | test($security_heading_pattern))
                     | ([range($start + 1; $lines | length)
                        | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))]
                       | .[0] // ($lines | length)) as $end
                     | $lines[$start:$end] | join("\n")]
                  else [$body] end
              else [$body] end;
          [.[]
           | .data.repository.pullRequest.reviews.nodes[]?
           | select((.author.login // "") == $bot and .author.id == "BOT_kgDOC98s_g")
           | select((.state // "") != "DISMISSED")
           | select((.commit.oid // "") == $head)
           | (.body // "") as $body
           | ($body | security_result_sections) as $results
           | select(any($results[]; (. as $result
             | ($result | contains_security_marker) or
               (($result | contains_security_heading) and
                ($result | has_security_report_link)))))
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
    | jq -c --argjson reviews "$security_reviews" --arg head "$head_sha" --arg security_heading_pattern "$security_heading_pattern" --arg clean_security_report_pattern "$security_clean_report_pattern" '
      def contains_security_heading:
        split("\n") | any(.[]; test($security_heading_pattern));
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
def clean_security_envelope:
  if test($clean_security_report_pattern) then
            (sub($clean_security_report_pattern; "")
              | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
              | gsub("\r"; "")
              | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
      def has_security_report_link:
        (ascii_downcase) as $lower
        | ($lower | contains("[view security finding report]("))
          and ((($lower | clean_security_envelope) | not)
               or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));
      def contains_security_marker:
        test("(?im)(?:\\A|\\n)[[:blank:]]*\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$")
            or test("(?is)\\A[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*(?:\\r?\\n|\\z)")
            or (contains_security_heading and test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$"));
      [.[][] | select(.user.login == "chatgpt-codex-connector[bot]" and .user.id == 199175422 and .user.type == "Bot")
       | select(.original_commit_id == $head)
       | select(.pull_request_review_id as $id | $reviews | index($id))
       | (.body // "") as $body
       | ($body | ascii_downcase) as $lower
       | select(($body | contains_security_marker) or
               (($body | contains_security_heading) and
                ($body | has_security_report_link)))
       | {source:"review", id:(.pull_request_review_id | tostring)}]')"
  issue_comment_findings="$(
    gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp \
      | jq -r --arg bot "$SECURITY_REVIEW_BOT_EVENT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" --arg security_heading_pattern "$security_heading_pattern" --arg clean_security_report_pattern "$security_clean_report_pattern" '
          def contains_security_heading:
            split("\n") | any(.[]; test($security_heading_pattern));
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
def clean_security_envelope:
  if test($clean_security_report_pattern) then
    (sub($clean_security_report_pattern; "")
  | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
  | gsub("\r"; "")
  | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
          def has_security_report_link:
            (ascii_downcase) as $lower
            | ($lower | contains("[view security finding report]("))
              and ((($lower | clean_security_envelope) | not)
                   or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));
          def contains_security_marker:
            test("(?im)(?:\\A|\\n)[[:blank:]]*\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$")
            or test("(?is)\\A[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*(?:\\r?\\n|\\z)")
            or (contains_security_heading and test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$"));
          def coordinator_prelude:
            test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
          def coordinator_result_for_head:
            if coordinator_prelude then
              (capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head == $head)
            else false end;
          def coordinator_metadata:
            test("(?s)\\A[[:space:]]*(?:(?:Retry reason:[^\\r\\n]*|Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*)[[:space:]]*)*\\z") and (test("(?i)\\bP[0-3]\\b") | not) and ((test("(?i)codex-security-review-finding:v1") | not) or test("(?s)\\A[[:space:]]*(?:Retry reason:[^\\r\\n]*\\r?\\n[[:space:]]*)*Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*(?i:codex-security-review-finding:v1)[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*[[:space:]]*\\z")) and ((gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not);
          def security_result_sections:
            . as $body
            | if coordinator_prelude then
                capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body
                | split("\n") as $lines
                | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern))] | .[0]) as $first_security
                | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))] | .[0]) as $first_result
                | if $first_security != null and $first_result != null and ($lines[:$first_result] | join("\n") | coordinator_metadata) then
                    [range(0; $lines | length) as $start
                     | select($lines[$start] | test($security_heading_pattern))
                     | ([range($start + 1; $lines | length)
                        | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))]
                       | .[0] // ($lines | length)) as $end
                     | $lines[$start:$end] | join("\n")]
                  else [$body] end
              else [$body] end;
          [.[][]
           | select((.user.login // "") == $bot and .user.id == 199175422 and .user.type == "Bot")
           | (.body // "") as $body
           | ($body | security_result_sections) as $results
           | select(any($results[]; (. as $result
             | ($result | contains_security_marker) or
               (($result | contains_security_heading) and
                ($result | has_security_report_link)))))
           | select((($body | contains("`" + $head + "`")) or ($body | contains("`" + $prefix + "`")))
                    or ($body | coordinator_result_for_head))
           | {source: "issue-comment", id: (.id // 0 | tostring), body: $body}]'
  )"
  jq -cn --argjson reviews "$review_findings" --argjson comments "$issue_comment_findings" --argjson inline "$inline_findings" '$reviews + $comments + $inline | unique'
}

# Exact-head regular PR reviews and explicit clean regular issue
# comments can qualify. Security findings block independently and
# can never satisfy the required regular-review verdict.
regular_evidence() {
  local issue_comment_receipts_script="${ISSUE_COMMENT_RECEIPTS_SCRIPT:-$(dirname "${BASH_SOURCE[0]}")/issue_comment_receipts.py}"
  local review_records issue_comment_records issue_comment_pages issue_comment_receipt_data
  local prior_creation_receipt=false prior_body_receipt=false prior_body_hash_receipt=false
  local prior_has_creation_receipt=false
  local eligible_comment_run_id="" eligible_comment_id="" eligible_comment_run_attempt="" prior_body_base64=""
  review_records="$(
    # shellcheck disable=SC2016 # GraphQL expands these variables, not the shell.
    gh api graphql --paginate \
      -f query='query($owner: String!, $name: String!, $number: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(first: 100, after: $endCursor) { nodes { databaseId state submittedAt updatedAt body author { login ... on Bot { id } } commit { oid } } pageInfo { hasNextPage endCursor } } } } }' \
      -F owner="$review_owner" \
      -F name="$review_repo" \
      -F number="$pr_number" \
      | jq -cs --arg bot "$REVIEW_BOT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" \
        --arg prior_body "${1:-}" --arg prior_id "${2:-}" --arg prior_source "${3:-issue_comment}" --arg prior_at "${4:-}" '
          def regular_heading:
            ascii_downcase
            | test("(?i)\\A[[:space:]]*(?:@|#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review(?:[[:space:]]*:|[[:space:]]|$)|\\A[[:space:]]*(?:#{1,6}[[:space:]]+)?review result(?:[[:space:]]*:|[[:space:]]|$)");
          # Only the coordinator exact generated prelude may be removed.
          # In particular, an authenticated-looking result may quote a request
          # marker; that quoted marker must remain part of the evidence unless
          # the prelude and removable metadata are both exact.
          def coordinator_prelude:
            test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
          def coordinator_request: coordinator_prelude;
          def coordinator_metadata:
            test("(?s)\\A[[:space:]]*(?:(?:Retry reason:[^\\r\\n]*|Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*)[[:space:]]*)*\\z") and (test("(?i)\\bP[0-3]\\b") | not) and ((test("(?i)codex-security-review-finding:v1") | not) or test("(?s)\\A[[:space:]]*(?:Retry reason:[^\\r\\n]*\\r?\\n[[:space:]]*)*Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*(?i:codex-security-review-finding:v1)[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*[[:space:]]*\\z")) and ((gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not);
          def raw_security_heading:
            ascii_downcase
            | test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]-]+)?security(?:[[:space:]-]+)review(?:[[:space:]]*:|[[:space:]]|$)");
          def raw_availability_notice:
            ascii_downcase
            | test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]]+)?(?:review|review[[:space:]]+result)(?:[[:space:]]*:|[[:space:]]|$)[[:space:]]*(?:you have reached[^\\r\\n]*(?:usage[[:space:]]+limits?|quota)|(?:codex[[:space:]]+)?(?:review[[:space:]]+)?(?:is[[:space:]]+)?(?:currently[[:space:]]+)?(?:unavailable|at[[:space:]]+capacity|rate[[:space:]-]*limited)|(?:could not|unable to)[[:space:]]+(?:start|complete|perform)[[:space:]]+(?:the[[:space:]]+)?(?:codex[[:space:]]+)?review|[^\\r\\n]*try again later)");
          def result_section:
            if coordinator_request then capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body | split("\n") as $lines | ($lines[:80] | to_entries | map(select(.value | (regular_heading or raw_security_heading or raw_availability_notice))) | .[0].key) as $start | if $start != null and ($lines[:$start] | join("\n") | coordinator_metadata) and (($lines[$start] | raw_security_heading) or (($lines[:$start] | join("\n") | gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not)) then $lines[$start:] | join("\n") else $lines | join("\n") end else . end;
          def first_result_section:
            split("\n") as $lines
            | ([range(0; $lines | length) | select($lines[.] | regular_heading)] | .[0]) as $start
            | if $start == null then . else
                ([range($start + 1; $lines | length) | select($lines[.] | regular_heading or raw_security_heading)] | .[0] // ($lines | length)) as $end
                | if ((($lines[:$start] | join("\n") | coordinator_metadata)
                      and (($lines[:$start] | join("\n") | gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not))
                     or (($lines[:$start] | map(select(test("[^[:space:]]"))) | .[0] // "") | raw_security_heading))
                  then $lines[$start:$end] | join("\n")
                  else . end
              end;
          def security_heading:
            split("\n") | .[0] | raw_security_heading;
          def availability_notice:
            result_section as $result
            | ($result | first_result_section) as $first_result
            | ($first_result | raw_availability_notice)
              and (($first_result | test("(?i)\\bP[0-3]\\b|codex-security-review-finding:v1")) | not)
              and (($result | [scan("(?im)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:Codex Review|Review result)(?:[[:space:]]*:|[[:space:]]|$)")] | length) < 2);
          def exact_head:
            test("(?im)\\*{0,2}reviewed commit:\\*{0,2}[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60")
            or (coordinator_prelude and
                (capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head == $head));
          def multiple_result_sections:
            (result_section | [scan("(?im)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:Codex Review|Review result)(?:[[:space:]]*:|[[:space:]]|$)")] | length) > 1;
          # A "no major/blocking issues" claim must carry the
          # known connector footer; a body-only claim is not a
          # clean verdict.
          def known_codex_footer:
            test("(?is)\\A<details>[[:space:]]*<summary>[[:space:]]*(?:ℹ️[[:space:]]*)?about[[:space:]]+codex[[:space:]]+in[[:space:]]+github[[:space:]]*</summary>[[:space:]]*<br[[:space:]]*/?>[[:space:]]*\\[your team has set up codex to review pull requests in this repo\\]\\(https://chatgpt\\.com/codex/cloud/settings/general\\)\\.[[:space:]]*reviews are triggered when you[[:space:]]*-[[:space:]]*open a pull request for review[[:space:]]*-[[:space:]]*mark a draft as ready[[:space:]]*-[[:space:]]*comment \\\"@codex review\\\"\\.[[:space:]]*if codex has suggestions, it will comment; otherwise it will react with (?:👍|:\\+1:)\\.[[:space:]]*codex can also answer questions or update the pr\\.[[:space:]]*try commenting \\\"@codex address that feedback\\\"\\.[[:space:]]*</details>[[:space:]]*$");
          def stock_clean_envelope:
            test("(?is)\\A[[:space:]]*#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?codex[[:space:]]+review[[:space:]]*\\r?\\n[[:space:]]*\\r?\\n[[:space:]]*here are some automated review suggestions for this pull request\\.[[:space:]]*\\r?\\n[[:space:]]*\\r?\\n[[:space:]]*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*\\r?\\n[[:space:]]*<details>(?:(?!</details>).)*</details>[[:space:]]*$")
            or test("(?is)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review:[[:space:]]*didn.t find any major issues\\.[ \t]*(?:What shall we delve into next\\?|You[[:punct:]]re on a roll\\.|Delightful!|Nice work!|Already looking forward to the next diff\\.|Another round soon, please!|More of your lovely PRs please\\.|Hooray!|Swish!|Bravo\\.|Can[\\x27\\x{2019}]t wait for the next one!|Keep it up!|Keep them coming!|Breezy!|Chef.s kiss[.!]?|:tada:)?[ \t]*(?::\\+1:|👍|:rocket:|:rocket!|🚀)?[ \t]*(?:\\r?\\n[[:space:]]*)+\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*(?:\\r?\\n[[:space:]]*)+<details>[[:space:]]*<summary>[^\\r\\n]*codex[[:space:]]+in[[:space:]]+github(?:(?!</details>).)*</details>[[:space:]]*$")
            or test("(?is)\\A[[:space:]]*#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?(?:codex[[:space:]]+review|review result):[[:space:]]*(?:didn.t find any issues|no issues found)\\.[[:space:]]*(?:\\r?\\n[[:space:]]*)*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*$");
          def strict_stock_clean_envelope:
            stock_clean_envelope
            and (if test("(?is)<details>") then
              capture("(?is)\\A.*?(?<footer><details>.*)$").footer | known_codex_footer
              else true end);
          [.[] | .data.repository.pullRequest.reviews.nodes[]?] as $records
          | [$records[]
             | select((.author.login // "") == $bot and .author.id == "BOT_kgDOC98s_g")
             | select((.commit.oid // "") == $head)
             | {id: (.databaseId | tostring), dismissed: (.state == "DISMISSED"),
                updated_at: (.updatedAt // .submittedAt)}] as $all_reviews
          # This synthetic record is used only to classify a previously
          # authenticated relay body, never as a verdict or live API evidence.
          | (if $prior_source == "review" then
               ($records | map(select((.databaseId | tostring) != $prior_id))) +
               [{databaseId: ($prior_id | tonumber), body: $prior_body,
                 state: "COMMENTED", submittedAt: $prior_at, updatedAt: $prior_at,
                 author: {login: $bot, id: "BOT_kgDOC98s_g"}, commit: {oid: $head}}]
             else $records end) as $records_with_prior
          | {all_reviews: $all_reviews,
             deliveries: [$records_with_prior[]
           | select((.author.login // "") == $bot and .author.id == "BOT_kgDOC98s_g")
           | select((.commit.oid // "") == $head)
           | (.body // "") as $body
           | select(if .state == "CHANGES_REQUESTED" then true else ($body | regular_heading) end)
           | select(if .state == "CHANGES_REQUESTED" then true else (($body | result_section | first_result_section | security_heading) | not) end)
           | select(if .state == "CHANGES_REQUESTED" then true else (($body | availability_notice) | not) end)
           | select(if .state == "CHANGES_REQUESTED" then true else ($body | exact_head) end)
           | {at: (if .state == "DISMISSED" then .submittedAt else (.updatedAt // .submittedAt) end),
              updated_at: (.updatedAt // .submittedAt),
              created_at: .submittedAt,
              id: (.databaseId | tostring),
              source: "review",
              dismissed: (.state == "DISMISSED"),
              clean: (.state != "CHANGES_REQUESTED" and (.state == "COMMENTED" or .state == "APPROVED") and (($body | multiple_result_sections) | not) and ($body | first_result_section | strict_stock_clean_envelope))}]}'
  )"
  issue_comment_pages="$(gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp)"
  if [[ "${REQUIRE_CLEAN_ISSUE_COMMENT_RECEIPT:-false}" == true ]]; then
    # A historical body/timestamp receipt cannot prove the mutable comment is
    # still the same revision: GitHub timestamps have only second precision.
    # Only the exact created event currently being handled may use its receipt.
    if [[ "${GITHUB_EVENT_NAME:-}" == issue_comment && "${EVENT_NAME:-}" == issue_comment \
          && "${EVENT_PR_NUMBER:-}" == "$pr_number" \
          && "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] \
        && jq -e --argjson pr "$pr_number" '
          .action == "created" and .issue.number == $pr
          and (.comment.id | type == "number" and . > 0 and floor == .)
          and .comment.user.id == 199175422
          and .comment.user.login == "chatgpt-codex-connector[bot]"
          and .comment.user.type == "Bot"
        ' "${GITHUB_EVENT_PATH:-/dev/null}" >/dev/null 2>&1; then
      eligible_comment_run_id="$GITHUB_RUN_ID"
      eligible_comment_id="$(jq -er '.comment.id' "$GITHUB_EVENT_PATH")"
      if [[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]; then
        eligible_comment_run_attempt="$GITHUB_RUN_ATTEMPT"
      fi
    fi
    issue_comment_receipt_data="$(printf '%s' "$issue_comment_pages" | python3 "$issue_comment_receipts_script" \
      --repo "$REPO" --head "$head_sha" --pr "$pr_number" \
      --workflow-file "${REVIEW_GATE_WORKFLOW_FILE:-review-gate.yml}" \
      --prior-id "${2:-}" \
      --prior-body-base64 "${5:-}" \
      --prior-updated-at "${4:-}" \
      --event-run-id "$eligible_comment_run_id" --event-comment-id "$eligible_comment_id" \
      --event-run-attempt "${eligible_comment_run_attempt:-0}")"
    prior_creation_receipt="$(jq -r '.priorCreationReceipt' <<< "$issue_comment_receipt_data")"
    prior_body_receipt="$(jq -r '.priorBodyReceipt' <<< "$issue_comment_receipt_data")"
    prior_body_hash_receipt="$(jq -r '.priorBodyHashReceipt' <<< "$issue_comment_receipt_data")"
    prior_has_creation_receipt="$(jq -r '.priorHasCreationReceipt' <<< "$issue_comment_receipt_data")"
    # A historical prior body in a deletion/edit event may use any trusted
    # receipt for that exact body; it never annotates the live revision as
    # creation-receipted or makes an edited clean result eligible.
    if [[ "${GITHUB_EVENT_NAME:-}" == issue_comment ]]; then
      if jq -e '.action == "deleted"' "${GITHUB_EVENT_PATH:-/dev/null}" >/dev/null 2>&1; then
        prior_creation_receipt="$prior_body_receipt"
      elif jq -e '.action == "edited"' "${GITHUB_EVENT_PATH:-/dev/null}" >/dev/null 2>&1; then
        prior_creation_receipt="$prior_body_hash_receipt"
      fi
    fi
    issue_comment_pages="$(jq -c '.comments' <<< "$issue_comment_receipt_data")"
  fi
  issue_comment_records="$(printf '%s' "$issue_comment_pages" \
      | jq -c --arg bot "$REVIEW_BOT_EVENT_LOGIN" --arg head "$head_sha" --arg prefix "$head_prefix" \
          --argjson require_creation_receipt "${REQUIRE_CLEAN_ISSUE_COMMENT_RECEIPT:-false}" \
          --argjson prior_creation_receipt "$prior_creation_receipt" \
          --argjson prior_has_creation_receipt "$prior_has_creation_receipt" \
          --arg prior_body "${1:-}" --arg prior_id "${2:-}" --arg prior_at "${4:-}" '
          def regular_heading:
            ascii_downcase
            | test("(?i)\\A[[:space:]]*(?:@|#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review(?:[[:space:]]*:|[[:space:]]|$)|\\A[[:space:]]*(?:#{1,6}[[:space:]]+)?review result(?:[[:space:]]*:|[[:space:]]|$)");
          # Only the coordinator exact generated prelude may be removed.
          # In particular, an authenticated-looking result may quote a request
          # marker; that quoted marker must remain part of the evidence unless
          # the prelude and removable metadata are both exact.
          def coordinator_prelude:
            test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
          def coordinator_request: coordinator_prelude;
          def coordinator_metadata:
            test("(?s)\\A[[:space:]]*(?:(?:Retry reason:[^\\r\\n]*|Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*)[[:space:]]*)*\\z") and (test("(?i)\\bP[0-3]\\b") | not) and ((test("(?i)codex-security-review-finding:v1") | not) or test("(?s)\\A[[:space:]]*(?:Retry reason:[^\\r\\n]*\\r?\\n[[:space:]]*)*Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*(?i:codex-security-review-finding:v1)[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*[[:space:]]*\\z")) and ((gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not);
          def raw_security_heading:
            ascii_downcase
            | test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]-]+)?security(?:[[:space:]-]+)review(?:[[:space:]]*:|[[:space:]]|$)");
          def raw_availability_notice:
            ascii_downcase
            | test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]]+)?(?:review|review[[:space:]]+result)(?:[[:space:]]*:|[[:space:]]|$)[[:space:]]*(?:you have reached[^\\r\\n]*(?:usage[[:space:]]+limits?|quota)|(?:codex[[:space:]]+)?(?:review[[:space:]]+)?(?:is[[:space:]]+)?(?:currently[[:space:]]+)?(?:unavailable|at[[:space:]]+capacity|rate[[:space:]-]*limited)|(?:could not|unable to)[[:space:]]+(?:start|complete|perform)[[:space:]]+(?:the[[:space:]]+)?(?:codex[[:space:]]+)?review|[^\\r\\n]*try again later)");
          def result_section:
            if coordinator_request then capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body | split("\n") as $lines | ($lines[:80] | to_entries | map(select(.value | (regular_heading or raw_security_heading or raw_availability_notice))) | .[0].key) as $start | if $start != null and ($lines[:$start] | join("\n") | coordinator_metadata) and (($lines[$start] | raw_security_heading) or (($lines[:$start] | join("\n") | gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not)) then $lines[$start:] | join("\n") else $lines | join("\n") end else . end;
          def first_result_section:
            split("\n") as $lines
            | ([range(0; $lines | length) | select($lines[.] | regular_heading)] | .[0]) as $start
            | if $start == null then . else
                ([range($start + 1; $lines | length) | select($lines[.] | regular_heading or raw_security_heading)] | .[0] // ($lines | length)) as $end
                | if ((($lines[:$start] | join("\n") | coordinator_metadata)
                      and (($lines[:$start] | join("\n") | gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not))
                     or (($lines[:$start] | map(select(test("[^[:space:]]"))) | .[0] // "") | raw_security_heading))
                  then $lines[$start:$end] | join("\n")
                  else . end
              end;
          def security_heading:
            split("\n") | .[0] | raw_security_heading;
          def availability_notice:
            result_section as $result
            | ($result | first_result_section) as $first_result
            | ($first_result | raw_availability_notice)
              and (($first_result | test("(?i)\\bP[0-3]\\b|codex-security-review-finding:v1")) | not)
              and (($result | [scan("(?im)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:Codex Review|Review result)(?:[[:space:]]*:|[[:space:]]|$)")] | length) < 2);
          def exact_head:
            test("(?im)\\*{0,2}reviewed commit:\\*{0,2}[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60")
            or (coordinator_prelude and
                (capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head == $head));
          def multiple_result_sections:
            (result_section | [scan("(?im)^[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:Codex Review|Review result)(?:[[:space:]]*:|[[:space:]]|$)")] | length) > 1;
          def known_codex_footer:
            test("(?is)\\A<details>[[:space:]]*<summary>[[:space:]]*(?:ℹ️[[:space:]]*)?about[[:space:]]+codex[[:space:]]+in[[:space:]]+github[[:space:]]*</summary>[[:space:]]*<br[[:space:]]*/?>[[:space:]]*\\[your team has set up codex to review pull requests in this repo\\]\\(https://chatgpt\\.com/codex/cloud/settings/general\\)\\.[[:space:]]*reviews are triggered when you[[:space:]]*-[[:space:]]*open a pull request for review[[:space:]]*-[[:space:]]*mark a draft as ready[[:space:]]*-[[:space:]]*comment \\\"@codex review\\\"\\.[[:space:]]*if codex has suggestions, it will comment; otherwise it will react with (?:👍|:\\+1:)\\.[[:space:]]*codex can also answer questions or update the pr\\.[[:space:]]*try commenting \\\"@codex address that feedback\\\"\\.[[:space:]]*</details>[[:space:]]*$");
          def stock_clean_issue_comment_body:
            test("(?is)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?codex review:[[:space:]]*didn.t find any major issues\\.[ \t]*(?:What shall we delve into next\\?|You[[:punct:]]re on a roll\\.|Delightful!|Nice work!|Already looking forward to the next diff\\.|Another round soon, please!|More of your lovely PRs please\\.|Hooray!|Swish!|Bravo\\.|Can[\\x27\\x{2019}]t wait for the next one!|Keep it up!|Keep them coming!|Breezy!|Chef.s kiss[.!]?|:tada:)?[ \t]*(?::\\+1:|👍|:rocket:|:rocket!|🚀)?[ \t]*(?:\\r?\\n[[:space:]]*)+\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*(?:\\r?\\n[[:space:]]*)+<details>[[:space:]]*<summary>[^\\r\\n]*codex[[:space:]]+in[[:space:]]+github(?:(?!</details>).)*</details>[[:space:]]*$")
            or test("(?is)\\A[[:space:]]*#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?(?:codex[[:space:]]+review|review result):[[:space:]]*(?:didn.t find any issues|no issues found)\\.[[:space:]]*(?:\\r?\\n[[:space:]]*)*\\*\\*reviewed commit:\\*\\*[[:space:]]*\\x60(" + $head + "|" + $prefix + ")\\x60[[:space:]]*$");
          def stock_clean_issue_comment_envelope:
            if coordinator_request then
              (capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head == $head)
              and (result_section | first_result_section | stock_clean_issue_comment_body)
            else stock_clean_issue_comment_body end;
          def strict_stock_clean_issue_comment_envelope:
            stock_clean_issue_comment_envelope
            and (result_section | first_result_section | if test("(?is)<details>") then
              capture("(?is)\\A.*?(?<footer><details>.*)$").footer | known_codex_footer
              else true end);
          ([.[][]] as $records
           | (if $prior_id != "" and all($records[]; (.id | tostring) != $prior_id) then
                $records + [{id: ($prior_id | tonumber), body: $prior_body, created_at: $prior_at,
                             updated_at: $prior_at, review_gate_creation_receipt: $prior_creation_receipt,
                             review_gate_has_creation_receipt: $prior_has_creation_receipt,
                             user: {login: $bot, id: 199175422, type: "Bot"}}]
              else [$records[] | if (.id | tostring) == $prior_id then
                       .body = $prior_body
                       | .review_gate_creation_receipt = $prior_creation_receipt
                       | .review_gate_has_creation_receipt = $prior_has_creation_receipt
                       | if $prior_creation_receipt then .updated_at = .created_at else . end
                    else . end] end)
           | [.[]
           | select((.user.login // "") == $bot and .user.id == 199175422 and .user.type == "Bot")
           | (.body // "") as $body
           | select($body | regular_heading)
           | select(($body | result_section | first_result_section | security_heading) | not)
           | select(($body | availability_notice) | not)
           | select($body | exact_head)
           | ((($body | multiple_result_sections) | not)
              and ($body | strict_stock_clean_issue_comment_envelope)) as $clean_envelope
           | {at: (.updated_at // .created_at),
              created_at: .created_at,
              id: ("issue-comment-" + (.id | tostring)),
              source: "issue_comment",
              body: $body,
              # An unreceipted clean body may be a finding edited before its
              # Actions event starts. GitHub timestamps have second precision,
              # so even created_at == updated_at cannot prove it was never
              # edited. Do not let it preserve an older clean verdict: wait
              # for the authenticated, body-bound native creation receipt.
              neutral: false,
              unverified: ($require_creation_receipt and $clean_envelope
                and .review_gate_creation_receipt != true),
              clean: ((($require_creation_receipt | not) or .review_gate_creation_receipt == true)
                and $clean_envelope)}])'
    )"
  jq -cn --argjson review_data "$review_records" --argjson issue_comments "$issue_comment_records" '
    {deliveries: ($review_data.deliveries + $issue_comments),
     all_reviews: $review_data.all_reviews,
     review_ids: [$review_data.deliveries[] | select(.dismissed != true) | .id]}' | normalize_delivery_timestamps
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

write_security_finding_observations() {
  local findings="$1"
  [[ -n "${CANONICAL_SECURITY_FINDING_OUTPUT:-}" ]] || return 0
  if ! { jq -r '.[] | .source + ":" + .id' <<< "$findings";
         printf '%s' "${security_event_origins:-}"; } \
       | LC_ALL=C sort -u > "$CANONICAL_SECURITY_FINDING_OUTPUT"; then
    echo "Could not persist canonical security finding origins." >&2
    exit 1
  fi
}

record_security_event_origin() {
  local origin="$1"
  if [[ ! "$origin" =~ ^(review|issue-comment):[1-9][0-9]*$ ]]; then
    echo "Authenticated security event has no valid immutable origin." >&2
    exit 1
  fi
  security_event_origins+="$origin"$'\n'
}

receipted_history_marker_ids() {
  local context="$1" label="$2" gate_snapshot="$3" statuses source_comments marker_id origin source_hash source_id source_body actual_hash
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || return 1
  source_comments="$(gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp \
    | jq -c '[.[][] | select(.user.login == "chatgpt-codex-connector[bot]" and .user.id == 199175422 and .user.type == "Bot") | {id:(.id | tostring),body:(.body // "")}]')" || return 1
  while IFS=$'\t' read -r marker_id origin source_hash; do
    [[ "$marker_id" =~ ^[1-9][0-9]*$ && "$origin" =~ ^issue-comment:[1-9][0-9]*$ && "$source_hash" =~ ^[0-9a-f]{24}$ ]] || continue
    source_id="${origin#issue-comment:}"
    source_body="$(jq -r --arg id "$source_id" '[.[] | select(.id == $id) | .body][0] // empty' <<< "$source_comments")"
    [[ -n "$source_body" ]] || continue
    actual_hash="$(printf '%s' "$source_body" | shasum -a 256 | awk '{print substr($1, 1, 24)}')"
    [[ "$actual_hash" == "$source_hash" ]] || continue
    printf '%s\n' "$marker_id"
  done < <(jq -r --arg context "$context" --arg label "$label" --arg head "$head_sha" --argjson number "$pr_number" '
    [.[][] | select(.context == $context)] as $history
    | [$history[] | select(.state == "pending") as $marker
       | ($marker.description // "") as $description
       | (try ($description | capture("; (?<origin>issue-comment:[1-9][0-9]*); (?:sha256|h):(?<hash>[0-9a-f]{24})(?:; t:[0-9a-f]{9})?$")) catch null) as $source
       | select($source != null)
       | select(any($history[]; .state == "success" and
           (.description == ($label + " clean receipt #" + ($marker.id | tostring) + " for PR #" + ($number | tostring) + " on head " + $head + "; " + $source.origin)
            or .description == ($label + " clean history receipt #" + ($marker.id | tostring) + " for PR #" + ($number | tostring) + " on head " + $head + "; " + $source.origin))))
       | [($marker.id | tostring), $source.origin, $source.hash] | @tsv] | .[]' <<< "$statuses")
}

finding_history_head() {
  local gate_snapshot="$1" valid_receipts valid_json
  valid_receipts="$(receipted_history_marker_ids "review-finding-history" "Regular" "$gate_snapshot")" || return 1
  valid_json="$(printf '%s\n' "$valid_receipts" | jq -Rsc 'split("\n") | map(select(length > 0))')"
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -r --arg context "review-finding-history" --arg head "$head_sha" --argjson number "$pr_number" --argjson valid "$valid_json" '
      [.[][] | select(.context == $context)] as $history
       | [$history[] | select(.state == "pending") | . as $marker | ($marker.description // "") as $description
          | select(($description | contains("for PR #" + ($number | tostring) + " on head " + $head))
                   or (($description | contains("for PR #")) | not))
          | select(($marker.id | tostring) as $id | ($valid | index($id)) == null)
          | $head][0] // ""'
}

security_history_head() {
  local gate_snapshot="$1" valid_receipts valid_json
  if [[ "${security_withdrawal_unresolved:-false}" == true ]]; then
    printf '%s\n' "$head_sha"
    return
  fi
  valid_receipts="$(receipted_history_marker_ids "review-security-history" "Security" "$gate_snapshot")" || return 1
  valid_json="$(printf '%s\n' "$valid_receipts" | jq -Rsc 'split("\n") | map(select(length > 0))')"
  gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -r --arg context "review-security-history" --arg head "$head_sha" --argjson number "$pr_number" --argjson valid "$valid_json" '
      [.[][] | select(.context == $context)] as $history
       | if any($history[]; .state == "pending"
             and (((.description // "") | contains("for PR #" + ($number | tostring) + " on head " + $head))
                  or (((.description // "") | contains("for PR #")) | not))
             and ((.id | tostring) as $id | ($valid | index($id)) == null))
      then $head else "" end'
}

security_findings_dismissed() { findings_dismissed "review-security-history" "Security" "$1"; }
regular_findings_dismissed() { findings_dismissed "review-finding-history" "Regular" "$1"; }

findings_dismissed() {
  local context="$1" label="$2" gate_snapshot="$3" markers reviews valid_receipts valid_json
  valid_receipts="$(receipted_history_marker_ids "$context" "$label" "$gate_snapshot")" || return 1
  valid_json="$(printf '%s\n' "$valid_receipts" | jq -Rsc 'split("\n") | map(select(length > 0))')"
  markers="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp \
    | jq -c --arg head "$head_sha" --argjson number "$pr_number" --arg context "$context" --arg label "$label" --argjson valid "$valid_json" '
      [.[][] | select(.context == $context)] as $history
      | [$history[] | select(.state == "pending") as $marker
       | select(($marker.description // "") | contains("for PR #" + ($number | tostring) + " on head " + $head)
                or (contains("for PR #") | not))
       | select(($marker.id | tostring) as $id | ($valid | index($id)) == null)
       | ($marker.description // "") as $description
       | if ($description | test("^" + $label + " findings(?: observed)? for PR #" + ($number | tostring) + " on head " + $head + "; (review|issue-comment):[1-9][0-9]*(; (?:sha256|h):[0-9a-f]{24})?(; (?:t|observed-at):[^;]+)?(; (?:event:captured|e:[0-9a-f]{14}))?$")) then
           ($description | capture("; (?<source>review|issue-comment):(?<id>[1-9][0-9]*)(?:; (?:sha256|h):[0-9a-f]{24})?(?:; (?:t|observed-at):[^;]+)?(?:; (?:event:captured|e:[0-9a-f]{14}))?$"))
         elif ($description | test("^" + $label + " findings(?: observed)? on head " + $head + "; (review|issue-comment):[1-9][0-9]*(; (?:sha256|h):[0-9a-f]{24})?(; (?:t|observed-at):[^;]+)?(; (?:event:captured|e:[0-9a-f]{14}))?$")) then
           ($description | capture("; (?<source>review|issue-comment):(?<id>[1-9][0-9]*)(?:; (?:sha256|h):[0-9a-f]{24})?(?:; (?:t|observed-at):[^;]+)?(?:; (?:event:captured|e:[0-9a-f]{14}))?$"))
         elif ($description | test("^" + $label + " for PR #" + ($number | tostring) + " on head " + $head + "; (review|issue-comment):[1-9][0-9]*; (?:sha256|h):[0-9a-f]{24}(?:; t:[0-9a-f]{9})?$")) then
           ($description | capture("; (?<source>review|issue-comment):(?<id>[1-9][0-9]*); (?:sha256|h):[0-9a-f]{24}(?:; t:[0-9a-f]{9})?$"))
         elif ($description | test("^Security review invalidated at [^;]+; withdrawn issue-comment:[1-9][0-9]* for PR #" + ($number | tostring) + " on head " + $head + "$")) then
           ($description | capture("withdrawn (?<source>issue-comment):(?<id>[1-9][0-9]*) on head"))
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

# Old evaluator versions could classify a fully clean, authenticated review as
# adverse history. Keep the pending observation forever, but append a scoped
# success receipt only when the exact immutable source still exists, is clean
# under today's parser, and has not been edited since the observation.
reconcile_clean_regular_history() {
  local snapshot="$1" statuses marker_id origin source_hash source_body receipt receipt_description legacy_receipt_description
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  while IFS=$'\t' read -r marker_id origin source_hash; do
    [[ "$marker_id" =~ ^[1-9][0-9]*$ && -n "$origin" ]] || continue
    [[ "$source_hash" =~ ^[0-9a-f]{24}$ ]] || continue
    source_body="$(jq -r --arg origin "$origin" '
      . as $snapshot | [$snapshot.deliveries[]
       | ((if .source == "issue_comment" then "issue-comment:" + (.id | sub("^issue-comment-"; "")) else .source + ":" + .id end) as $key
          | select($key == $origin and .source == "issue_comment" and .clean == true)
          | select(all($snapshot.regular_findings[]?; .source + ":" + .id != $origin)) | .body)] | .[0] // ""' <<< "$snapshot")"
    [[ -n "$source_body" && "$(printf '%s' "$source_body" | shasum -a 256 | awk '{print substr($1, 1, 24)}')" == "$source_hash" ]] || continue
    receipt_description="Regular clean receipt #$marker_id for PR #$pr_number on head $head_sha; $origin"
    legacy_receipt_description="Regular clean history receipt #$marker_id for PR #$pr_number on head $head_sha; $origin"
    receipt="$(jq -r --arg context "review-finding-history" --arg description "$receipt_description" --arg legacy "$legacy_receipt_description" '
      any(.[][]; .context == $context and .state == "success" and (.description == $description or .description == $legacy))' <<< "$statuses")"
    [[ "$receipt" == true ]] && continue
    stamp_status_for_sha "$head_sha" "review-finding-history" success "$receipt_description" >/dev/null
    history_reconciled=true
    # Each append changes the API snapshot; re-read so subsequent receipts are
    # idempotent even when more than one origin is eligible.
    statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  done < <(jq -r --arg context "review-finding-history" --arg head "$head_sha" --argjson number "$pr_number" '
    [.[][] | select(.context == $context and .state == "pending")
     | . as $status | ($status.description // "") as $description
     | select(($description | contains("for PR #" + ($number | tostring) + " on head " + $head))
              or (($description | contains("for PR #")) | not))
     | select(($status.id | tostring) | test("^[1-9][0-9]*$"))
     | try ($description | capture("; (?<origin>(?:review|issue-comment):[1-9][0-9]*); (?:sha256|h):(?<hash>[0-9a-f]{24})(?:; t:[0-9a-f]{9})?$") as $marker
        | [ ($status.id | tostring), $marker.origin, $marker.hash ] | @tsv) catch empty] | .[]' <<< "$statuses")
}

reconcile_clean_security_history() {
  local statuses marker_id origin source_hash source_json source_updated source_created body receipt receipt_description legacy_receipt_description source_id source_kind
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  while IFS=$'\t' read -r marker_id origin source_hash; do
    [[ "$marker_id" =~ ^[1-9][0-9]*$ && -n "$origin" ]] || continue
    [[ "$source_hash" =~ ^[0-9a-f]{24}$ ]] || continue
    source_kind="${origin%%:*}"
    source_id="${origin#*:}"
    if [[ "$source_kind" == review ]]; then
      # Legacy review origins also cover inline findings; there is no safe way
      # to distinguish those from a clean parent review using the old marker.
      continue
    fi
    source_json="$(gh api "repos/$REPO/issues/$pr_number/comments?per_page=100" --paginate --slurp \
      | jq -c --arg id "$source_id" '[.[][] | select((.id | tostring) == $id and .user.login == "chatgpt-codex-connector[bot]" and .user.id == 199175422 and .user.type == "Bot") | {created_at:.created_at,updated_at:(.updated_at // .created_at),body:(.body // "")}] | .[0] // empty')" || exit 1
    [[ -n "$source_json" ]] || continue
    source_created="$(jq -r '.created_at // empty' <<< "$source_json")"
    source_updated="$(jq -r '.updated_at // empty' <<< "$source_json")"
    body="$(jq -r '.body // empty' <<< "$source_json")"
    [[ -n "$source_created" && -n "$source_updated" && -n "$body" ]] || continue
    [[ "$(printf '%s' "$body" | shasum -a 256 | awk '{print substr($1, 1, 24)}')" == "$source_hash" ]] || continue
    jq -en --arg body "$body" --arg heading "$security_heading_pattern" --arg clean "$security_clean_report_pattern" --arg head "$head_sha" --arg prefix "$head_prefix" '
      def coordinator_prelude:
        test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
      def coordinator_head_matches:
        (try ($body | capture("(?is)<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<request_head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").request_head) catch "") == $head;
      def coordinator_metadata:
        test("(?s)\\A[[:space:]]*(?:(?:Retry reason:[^\\r\\n]*|Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*)[[:space:]]*)*\\z") and (test("(?i)\\bP[0-3]\\b") | not) and ((test("(?i)codex-security-review-finding:v1") | not) or test("(?s)\\A[[:space:]]*(?:Retry reason:[^\\r\\n]*\\r?\\n[[:space:]]*)*Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*(?i:codex-security-review-finding:v1)[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*[[:space:]]*\\z")) and ((gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not);
      def contains_security_heading:
        split("\n") | any(.[]; test($heading));
      def security_result_sections:
        if coordinator_prelude then
          capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body
          | split("\n") as $lines
          | ([range(0; $lines | length) | select($lines[.] | test($heading))] | .[0]) as $start
          | ([range(0; $lines | length) | select($lines[.] | test($heading) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))] | .[0]) as $first_result
          | if $start != null and $first_result != null and ($lines[:$first_result] | join("\n") | coordinator_metadata) then
              [range(0; $lines | length) as $section_start
               | select($lines[$section_start] | test($heading))
               | ([range($section_start + 1; $lines | length)
                  | select($lines[.] | test($heading) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))]
                 | .[0] // ($lines | length)) as $section_end
               | $lines[$section_start:$section_end] | join("\n")]
            else [$body] end
        else [.] end;
      def reconciled_security_footer($summary; $findings_sentence):
        "\n\n" + (["_only the user who started this review can view the report in codex._", "", "<details> <summary>" + $summary + "</summary>", "<br/>", "", "this is an experimental codex feature. reviews are triggered when:", "- you comment \"@codex security review\"", "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review", "", $findings_sentence, "", "", "</details>"] | join("\n"));
      def reconciled_clean_security_envelope:
        if test($clean) then
          (sub($clean; "")
            | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
            | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
          | ($tail == ""
             or $tail == (reconciled_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
             or $tail == (reconciled_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
             or $tail == (reconciled_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
             or $tail == (reconciled_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
        else false end;
      ($body | security_result_sections) as $results
      | (($body | coordinator_prelude) and coordinator_head_matches) as $coordinator_bound
      | any($results[]; . as $result
          | ($result | ascii_downcase) as $normalized_result
          | (($normalized_result | contains_security_heading)
              and ($normalized_result | reconciled_clean_security_envelope)
              and (($normalized_result | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")) | not)
              and (($normalized_result | contains("<!-- codex-security-review-finding:v1 -->")) | not)
              and (($normalized_result | contains("`" + $head + "`") or contains("`" + $prefix + "`"))
                   or ($coordinator_bound and (($normalized_result | test("(?i)reviewed commit")) | not)))))
      and all($results[]; (test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]") or contains("<!-- codex-security-review-finding:v1 -->")) | not)' >/dev/null || continue
    receipt_description="Security clean receipt #$marker_id for PR #$pr_number on head $head_sha; $origin"
    legacy_receipt_description="Security clean history receipt #$marker_id for PR #$pr_number on head $head_sha; $origin"
    receipt="$(jq -r --arg context "review-security-history" --arg description "$receipt_description" --arg legacy "$legacy_receipt_description" '
      any(.[][]; .context == $context and .state == "success" and (.description == $description or .description == $legacy))' <<< "$statuses")"
    [[ "$receipt" == true ]] && continue
    stamp_status_for_sha "$head_sha" "review-security-history" success "$receipt_description" >/dev/null
    history_reconciled=true
    statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  done < <(jq -r --arg context "review-security-history" --arg head "$head_sha" --argjson number "$pr_number" '
    [.[][] | select(.context == $context and .state == "pending") | . as $status
     | ($status.description // "") as $description
     | select(($description | contains("for PR #" + ($number | tostring) + " on head " + $head))
              or (($description | contains("for PR #")) | not))
     | select(($status.id | tostring) | test("^[1-9][0-9]*$"))
     | try ($description | capture("; (?<origin>(?:review|issue-comment):[1-9][0-9]*); (?:sha256|h):(?<hash>[0-9a-f]{24})(?:; t:[0-9a-f]{9})?$") as $marker
        | [($status.id | tostring), $marker.origin, $marker.hash] | @tsv) catch empty] | .[]' <<< "$statuses")
}

stamp_security_finding_history() {
  local findings="$1" key source body source_hash finding
  while IFS= read -r finding; do
    source="$(jq -r '.source' <<< "$finding")"
    key="$source:$(jq -r '.id' <<< "$finding")"
    if [[ "$key" =~ ^(review|issue-comment):[1-9][0-9]*$ ]]; then
      body="$(jq -r '.body // empty' <<< "$finding")"
      if [[ "$source" == issue-comment && -n "$body" ]]; then
        source_hash="$(printf '%s' "$body" | shasum -a 256 | awk '{print substr($1, 1, 24)}')"
        stamp_status "review-security-history" pending "Security for PR #$pr_number on head $head_sha; $key; sha256:$source_hash" >/dev/null
      else
        stamp_status "review-security-history" pending "Security findings observed for PR #$pr_number on head $head_sha; $key" >/dev/null
      fi
    else
      # Missing origin metadata is unresolved evidence, never dismissal proof.
      stamp_status "review-security-history" pending "Security findings observed for PR #$pr_number on head $head_sha" >/dev/null
    fi
  done < <(jq -c '.[]' <<< "$findings")
}

# Retain withdrawal history even when a failed/fork router could not write it.
# Compare the last published evidence ID with all currently valid records, not
# merely the selected verdict: an older clean verdict cannot replace a deletion.
withdrawn_evidence_at() {
  local deliveries="$1" statuses prior key prior_at saved at associated_prs='[]'
  statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || exit 1
  prior="$(jq -c --arg context "$REVIEW_GATE_CONTEXT" '
    [.[][] | select(.context == $context and .state == "success")
     | select((.description // "") | test("evidence (review:[0-9]+|issue-comment:[0-9]+)"))][0] // null' <<< "$statuses")"
  [[ "$prior" != null ]] || return 0
  key="$(jq -r '.description | capture("evidence (?<key>review:[0-9]+|issue-comment:[0-9]+)").key' <<< "$prior")"
  if jq -e --arg key "$key" 'any(.[]; (.clean or .neutral == true) and
       (if .source == "review" then "review:" + .id else (.id | sub("^issue-comment-"; "issue-comment:")) end) == $key)' <<< "$deliveries" >/dev/null; then
    return 0
  fi
  if jq -e --arg context "$REVIEW_REVIEW_CONTEXT" '
      any(.[][]; .context == $context and .state == "pending"
        and ((.description // "") | startswith("Regular review invalidated")
             and (test("^Regular review invalidated at [^;]+; PR #[1-9][0-9]*;") | not)))' \
      <<< "$statuses" >/dev/null; then
    associated_prs="$(associated_pull_numbers)" || exit 1
  fi
  # If the non-clean delivery is still present, its observed timestamp is the
  # authoritative invalidation watermark. Do not replace it with the current
  # clock value when a newer clean verdict is already available.
  local delivery_at
  delivery_at="$(jq -r --arg key "$key" '
    [.[] | select((.clean | not) and .neutral != true)
      | select((if .source == "review" then "review:" + .id else (.id | sub("^issue-comment-"; "issue-comment:")) end) == $key)
      | .at] | sort | last // ""' <<< "$deliveries")"
  if [[ -n "$delivery_at" ]]; then
    normalize_timestamp "$delivery_at"
    return 0
  fi
  saved="$(jq -r --arg context "$REVIEW_REVIEW_CONTEXT" --arg suffix "; withdrawn $key" --arg pr "$pr_number" --argjson associated "$associated_prs" '
    [.[][] | select(.context == $context and .state == "pending")
     | select((.description // "") | endswith($suffix))
     | select(if ((.description // "") | test("^Regular review invalidated at [^;]+; PR #[1-9][0-9]*;"))
             then ((.description | capture("^Regular review invalidated at [^;]+; PR #(?<pr>[1-9][0-9]*);").pr) == $pr)
             else ($associated | map(tostring)) == [$pr] end)
     | .description | capture("^Regular review invalidated at (?<at>[^;]+);").at][0] // ""' <<< "$statuses")"
  if [[ -z "$saved" ]]; then
    saved="$(jq -r --arg context "$REVIEW_REVIEW_CONTEXT" --arg pr "$pr_number" --argjson associated "$associated_prs" '
      [.[][] | select(.context == $context and .state == "pending")
       | select((.description // "") | endswith("; withdrawn delivery"))
       | select(if ((.description // "") | test("^Regular review invalidated at [^;]+; PR #[1-9][0-9]*;"))
               then ((.description | capture("^Regular review invalidated at [^;]+; PR #(?<pr>[1-9][0-9]*);").pr) == $pr)
               else ($associated | map(tostring)) == [$pr] end)
       | .description | capture("^Regular review invalidated at (?<at>[^;]+);").at][0] // ""' <<< "$statuses")"
  fi
  if [[ -n "$saved" ]]; then normalize_timestamp "$saved"; return 0; fi
  prior_at="$(normalize_timestamp "$(jq -r '.updated_at // .created_at' <<< "$prior")")"
  # The web adapter persists finding observations outside commit statuses.
  if (( evidence_only_mode )) && [[ -n "$finding_after" && "$finding_after" > "$prior_at" ]]; then
    echo "$finding_after"; return 0
  fi
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  stamp_status "$REVIEW_REVIEW_CONTEXT" pending "Regular review invalidated at $at; PR #$pr_number; withdrawn $key" >/dev/null
  normalize_timestamp "$at"
}

read_gate_snapshot() (
  # A snapshot must see changes made since the prior pass, while reads inside
  # this pass and its immediate history checks can still be coalesced.
  rm -f "$REVIEW_READ_CACHE/"*.json
  local evidence deliveries reviews all_reviews review_ids thread_summary verdict_selection verdict finding_count security_finding_count security_findings latest_finding_at issue_comment_at review_invalidation_at finding_history_at withdrawal_at
  evidence="$(regular_evidence)"
  deliveries="$(jq -c '.deliveries' <<< "$evidence")"
  reviews="$(jq -c '[.deliveries[] | select(.source == "review")]' <<< "$evidence")"
  all_reviews="$(jq -c '.all_reviews // []' <<< "$evidence")"
  review_ids="$(jq -c '[.deliveries[] | select(.source == "review" and (.dismissed != true)) | .id]' <<< "$evidence")"
  thread_summary="$(regular_review_thread_summary "$review_ids")"
  verdict_selection="$(
    issue_comment_at="$(latest_regular_issue_comment_at)"
    review_invalidation_at="$(latest_regular_review_invalidation_at)"
    finding_history_at="$(latest_regular_finding_history_at "$all_reviews")"
    withdrawal_at="$(withdrawn_evidence_at "$deliveries")"
    jq -cn --argjson deliveries "$deliveries" --argjson reviews "$reviews" --argjson thread_summary "$thread_summary" --arg issue_comment_at "$issue_comment_at" --arg review_invalidation_at "$review_invalidation_at" --arg finding_history_at "$finding_history_at" --arg withdrawal_at "$withdrawal_at" '
      ($thread_summary | map(select(.total_count > 0) | .id)) as $finding_ids
      | (([$deliveries[] | select((.clean | not) and .neutral != true) | .at]
          + [$reviews[]
             | select(.id as $id | ($finding_ids | index($id)) != null)
             | .at]
          + (if $issue_comment_at == "" then [] else [$issue_comment_at] end)
          + (if $review_invalidation_at == "" then [] else [$review_invalidation_at] end)
          + (if $finding_history_at == "" then [] else [$finding_history_at] end)
          + (if $withdrawal_at == "" then [] else [$withdrawal_at] end))
         | max // "") as $latest_finding_at
      | (([$deliveries[] | select((.clean | not) and .neutral != true) | .at]
          + [$reviews[]
             | select(.id as $id | ($finding_ids | index($id)) != null)
             | .at]
          + (if $issue_comment_at == "" then [] else [$issue_comment_at] end)
          + (if $review_invalidation_at == "" then [] else [$review_invalidation_at] end)
          + (if $withdrawal_at == "" then [] else [$withdrawal_at] end))
         | max // "") as $source_latest_finding_at
      | ($deliveries | sort_by(.at) | last) as $latest_delivery
      | {verdict:
           (if any($deliveries[]; .unverified == true) then null
            elif $latest_delivery != null
                 and ($latest_delivery.source == "review" or $latest_delivery.source == "issue_comment")
                 and $latest_delivery.clean
                 and (($finding_ids | index($latest_delivery.id)) == null)
                 and $latest_delivery.at > $latest_finding_at
            then $latest_delivery
            else null
            end),
         latest_finding_at: $latest_finding_at,
         source_latest_finding_at: $source_latest_finding_at}'
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
    '{deliveries: $deliveries,
      regular_findings: (([$deliveries[] | select((.clean | not) and .neutral != true and .unverified != true and .dismissed != true) | {source: (if .source == "issue_comment" then "issue-comment" else .source end), id: (.id | sub("^issue-comment-"; ""))}] + [$thread_summary[] | select(.total_count > 0) | {source:"review", id:.id}]) | unique),
      verdict: $verdict,
      finding_count: $finding_count,
      security_finding_count: $security_finding_count,
      security_findings: $security_findings,
      latest_finding_at: $latest_finding_at}'
)

require_clean_regular_snapshot() {
  local gate_snapshot="$1"
  local verdict verdict_at finding_count regular_finding_count security_finding_count latest_finding_at source_latest_finding_at history_statuses origin origin_observed_at description base_description observed_at existing_at marker_tag source_body source_hash
  verdict="$(jq -c '.verdict' <<< "$gate_snapshot")"
  latest_finding_at="$(jq -r '.latest_finding_at // empty' <<< "$gate_snapshot")"
  source_latest_finding_at="$(jq -r '.source_latest_finding_at // empty' <<< "$gate_snapshot")"
  finding_count="$(jq -r '.finding_count' <<< "$gate_snapshot")"
  regular_finding_count="$(jq '.regular_findings | length' <<< "$gate_snapshot")"
  security_finding_count="$(jq -r '.security_finding_count' <<< "$gate_snapshot")"
  if [[ "$regular_finding_count" -gt 0 ]]; then
    local origin
    history_statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)"
    observed_at="${source_latest_finding_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    # Keep the append-only marker date-sensitive with millisecond precision,
    # while staying within GitHub's 140-character status-description limit.
    marker_tag="${observed_at%%Z}"
    marker_tag="${marker_tag//T/}"
    marker_tag="${marker_tag//-/}"
    marker_tag="${marker_tag//:/}"
    marker_tag="${marker_tag//./}"
    marker_tag="${marker_tag:0:17}"
    while IFS= read -r origin; do
      [[ "$origin" =~ ^(review|issue-comment):[1-9][0-9]*$ ]] || exit 1
      origin_observed_at="$(jq -r --arg origin "$origin" '
        [.deliveries[]
         | ((if .source == "issue_comment" then "issue-comment:" + (.id | sub("^issue-comment-"; "")) else .source + ":" + .id end) as $key
            | select($key == $origin) | .at)] | max // ""' <<< "$gate_snapshot")"
      observed_at="${origin_observed_at:-$source_latest_finding_at}"
      observed_at="${observed_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
      marker_tag="$(printf '%s' "$observed_at" | shasum -a 256 | awk '{print substr($1, 1, 9)}')"
      base_description="Regular findings observed for PR #$pr_number on head $head_sha; $origin"
      if [[ "$origin" == issue-comment:* ]]; then
        source_body="$(jq -r --arg origin "$origin" '
          [.deliveries[] | select(.source == "issue_comment" and ("issue-comment:" + (.id | sub("^issue-comment-"; ""))) == $origin) | .body] | .[0] // ""' <<< "$gate_snapshot")"
        if [[ -n "$source_body" ]]; then
          source_hash="$(printf '%s' "$source_body" | shasum -a 256 | awk '{print substr($1, 1, 24)}')"
          base_description="Regular for PR #$pr_number on head $head_sha; $origin"
          base_description="$base_description; h:$source_hash"
        fi
      fi
      description="$base_description"
      legacy_base_description="${base_description/; h:/; sha256:}"
      existing_at="$(jq -r --arg context "review-finding-history" --arg description "$base_description" --arg legacy_description "$legacy_base_description" '
        [.[][] | select(.context == $context and .state == "pending" and (.description == $description or .description == $legacy_description or (.description | startswith($description + "; t:")) or (.description | startswith($legacy_description + "; t:")) or (.description | startswith($description + "; observed-at:")) or (.description | startswith($legacy_description + "; observed-at:"))))
         | (.updated_at // .created_at // "")] | max // ""' <<< "$history_statuses")"
      existing_at="$(normalize_timestamp "$existing_at")"
      if [[ -n "$existing_at" ]]; then
        if [[ "$observed_at" > "$existing_at" ]]; then
          description="$base_description; t:$marker_tag"
          if jq -e --arg context "review-finding-history" --arg description "$description" \
              'any(.[][]; .context == $context and .state == "pending" and .description == $description)' \
              <<< "$history_statuses" >/dev/null; then
            continue
          fi
        else
          continue
        fi
      fi
      if jq -e --arg context "review-finding-history" --arg description "$description" \
          'any(.[][]; .context == $context and .state == "pending" and .description == $description)' \
          <<< "$history_statuses" >/dev/null; then
        continue
      fi
      stamp_status "review-finding-history" pending "$description" >/dev/null
    done < <(jq -r '.regular_findings[] | .source + ":" + .id' <<< "$gate_snapshot")
  fi
  # Retain every adverse origin before any existing finding can stop the audit.
  if [[ "$security_finding_count" -gt 0 ]]; then
    stamp_security_finding_history "$(jq -c '.security_findings' <<< "$gate_snapshot")"
  fi
  # Evidence-only adapters cannot stamp GitHub statuses, so persist all
  # observations before any gate_pending path can exit the evaluator.
  write_finding_observation "$latest_finding_at"
  write_security_finding_observations "$(jq -c '.security_findings' <<< "$gate_snapshot")"
  # Native event capture has its own durable receipt. An audit must never
  # overwrite the pending gate while another source event is in flight. The
  # exact receipt being consumed is exempt only after its event was processed.
  capture_ack_context=""
  native_ack_context=""
  capture_ack_scoped_context=""
  if [[ "$event_history_phase_done" == true && "${REVIEW_CAPTURE_ID:-}" =~ ^[1-9][0-9]*$ ]]; then
    capture_ack_context="review-event-capture/$REVIEW_CAPTURE_ID"
    capture_ack_scoped_context="review-event-capture/$pr_number/$REVIEW_CAPTURE_ID"
  fi
  if [[ "$event_history_phase_done" == true && "${REVIEW_NATIVE_EVENT_ID:-}" =~ ^[1-9][0-9]*$ ]]; then
    native_ack_context="review-native-event/$REVIEW_NATIVE_EVENT_ID"
  fi
  capture_statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || {
    echo "Could not read review-event capture receipts; refusing to clear the gate." >&2
    return 2
  }
  untrusted_capture_receipt=false
  capture_successes="$(jq -c --arg pr_number "$pr_number" '[.[][]
      | select((.context // "") | test("^review-event-capture/([1-9][0-9]*/)?[1-9][0-9]*$"))
      | select((.description // "") | test(" for PR #" + $pr_number + "$"))
      | select((.context | split("/") | length) == 2
          or (.context | split("/")[1]) == $pr_number)]
      | group_by((.context | split("/") | last))
      | map(max_by([(.created_at // .updated_at // ""), (.id // 0)]))
      | .[] | select(.state == "success")' <<< "$capture_statuses")" || return 2
  while IFS= read -r capture_status; do
    [[ -n "$capture_status" ]] || continue
    if ! capture_receipt_is_authenticated "$capture_status"; then
      untrusted_capture_receipt=true
    fi
  done <<< "$capture_successes"
  if jq --arg pr_number "$pr_number" --arg consumed "$capture_ack_context" \
      --arg consumed_scoped "$capture_ack_scoped_context" --arg native "$native_ack_context" -e '[.[][]
      | select(((.context | startswith("review-event-capture/"))
          and .context != $consumed and .context != $consumed_scoped)
        or ((.context | startswith("review-native-event/")) and .context != $native))
      | select((.context | startswith("review-native-event/"))
          or (.context | split("/") | length) != 3 or (.context | split("/")[1]) == $pr_number)
      | select((.description // "") | test(" for PR #" + $pr_number + "$"))]
      | group_by((if (.context | startswith("review-event-capture/"))
          then (.context | split("/") | last) else .context end))
      | map(max_by([(.created_at // .updated_at // ""), (.id // 0)]))
      | any(.[]; .state != "success")' <<< "$capture_statuses" >/dev/null || [[ "$untrusted_capture_receipt" == true ]]; then
    stamp_review_gate pending "Waiting for authenticated review event capture"
    gate_pending
  fi
  # Block directly from observed origins too: evidence-only consumers cannot
  # persist statuses, and a resolved thread is not a native review dismissal.
  if [[ "$regular_finding_count" -gt 0 || "${edited_finding:-false}" == true ]] || { [[ "$(finding_history_head "$gate_snapshot")" == "$head_sha" ]] && ! regular_findings_dismissed "$gate_snapshot"; }; then
    stamp_review_gate pending "Unresolved finding history; fix code or record authorized review dismissal"
    gate_pending
  fi
  if [[ "$native_security_finding_observed" == true ]] || { [[ "$(security_history_head "$gate_snapshot")" == "$head_sha" ]] && ! security_findings_dismissed "$gate_snapshot"; }; then
    stamp_review_gate pending "Security findings were reported on this head; push a fresh head"
    gate_pending
  fi
  if [[ "$security_finding_count" -gt 0 ]]; then
    stamp_review_gate pending "Codex Security reported findings on $head_prefix"
    echo "Codex Security reported $security_finding_count findings-bearing result(s) on the exact head."
    echo "Fix them, push a new head, and request review again."
    gate_pending
  fi
  if [[ -n "$latest_finding_at" && "$latest_finding_at" > "$(latest_regular_review_invalidation_at)" ]]; then
    stamp_status "$REVIEW_REVIEW_CONTEXT" pending \
      "Regular review invalidated at $latest_finding_at; PR #$pr_number; regular evidence changed; require a newer clean normal verdict"
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
if [[ "$shared_head_owner" != "$pr_number" && "$historical_event_head" != true ]]; then
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
     .pull_request.number == $number and
     (.pull_request.head.sha | type == "string" and test("^[0-9a-f]{40}$")) and
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
  if jq -e --arg event "$event_name" --arg action "$(jq -r '.action // ""' "$event_path")" --arg head "$head_sha" --arg security_heading_pattern "$security_heading_pattern" --arg clean_security_report_pattern "$security_clean_report_pattern" '
    def contains_security_heading:
      split("\n") | any(.[]; test($security_heading_pattern));
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
def clean_security_envelope:
  if test($clean_security_report_pattern) then
    (sub($clean_security_report_pattern; "")
  | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
  | gsub("\r"; "")
  | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
    def has_security_report_link:
      (ascii_downcase) as $lower
      | ($lower | contains("[view security finding report]("))
        and ((($lower | clean_security_envelope) | not)
             or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));
    def is_security_result:
      (contains_security_heading and has_security_report_link) or
       test("(?im)(?:\\A|\\n)[[:blank:]]*\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$") or
       test("(?is)\\A[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*(?:\\r?\\n|\\z)") or
       (contains_security_heading and
        test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$")) or
       (($event == "pull_request_review" and $action == "deleted") and
        test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$"));
    ([if $event == "pull_request_review" then .review.body else .comment.body end,
      .changes.body.from // ""] | any(is_security_result))' "$event_path" >/dev/null; then
    relayed_security_finding=true
  fi
  if [[ "$relayed_security_finding" == true ]] &&
     { [[ "$event_name" == pull_request_review ]] || jq -e '.comment.in_reply_to_id == null' "$event_path" >/dev/null; }; then
    if [[ "$event_name" == pull_request_review ]]; then
      relayed_review_id="$(jq -r '.review.id' "$event_path")"
    else
      relayed_review_id="$(jq -r '.comment.pull_request_review_id' "$event_path")"
    fi
    stamp_status "review-security-history" pending \
      "Security findings observed for PR #$pr_number on head $head_sha; review:$relayed_review_id; event:captured" >/dev/null
    record_security_event_origin "review:$relayed_review_id"
    if [[ "$(jq -r '.action' "$event_path")" != dismissed ]]; then
      security_withdrawal_unresolved=true
    fi
  fi
  if [[ "$event_name" == pull_request_review && "$(jq -r '.action' "$event_path")" != dismissed ]]; then
    relayed_review_id="$(jq -r '.review.id' "$event_path")"
    relayed_review_at="$(jq -r '.review.submitted_at' "$event_path")"
    while IFS= read -r encoded_body; do
      relayed_body="$(jq -r '.' <<< "$encoded_body")"
      relayed_evidence="$(regular_evidence "$relayed_body" "$relayed_review_id" review "$relayed_review_at")"
      if jq -e --arg id "$relayed_review_id" 'any(.deliveries[]; .source == "review" and .id == $id and (.clean | not) and .neutral != true)' <<< "$relayed_evidence" >/dev/null; then
        stamp_status "review-finding-history" pending \
          "Regular findings observed for PR #$pr_number on head $head_sha; review:$relayed_review_id; event:captured" >/dev/null
        edited_finding=true
      fi
    done < <(jq -c '[.review.body // "", .changes.body.from // ""] | unique[] | select(length > 0)' "$event_path")
  fi
fi

# A relayed inline review comment can be created, edited, or deleted after its
# original delivery was missed. Preserve the authenticated originating review
# as blocking history even when the mutable comment is no longer available.
if [[ "$event_name" == pull_request_review_comment && -f "$event_path" ]] &&
   jq -e --arg head "$head_sha" --argjson number "$pr_number" '
     .pull_request.number == $number and
     (.pull_request.head.sha | type == "string" and test("^[0-9a-f]{40}$")) and
     (.action == "created" or .action == "edited" or .action == "deleted") and
     .comment.user.id == 199175422 and .comment.user.type == "Bot" and
     .comment.user.login == "chatgpt-codex-connector[bot]" and
     (.comment.pull_request_review_id | type == "number" and . > 0) and
     .comment.original_commit_id == $head and
     (.comment.in_reply_to_id == null)' "$event_path" >/dev/null; then
  relayed_review_id="$(jq -r '.comment.pull_request_review_id' "$event_path")"
  relayed_review_event_at=""
  case "$(jq -r '.action' "$event_path")" in
    created) relayed_review_event_at="$(jq -r '.comment.created_at // .comment.updated_at // empty' "$event_path")" ;;
    edited) relayed_review_event_at="$(jq -r '.comment.updated_at // empty' "$event_path")" ;;
  esac
  if [[ -n "$relayed_review_event_at" ]]; then
    relayed_review_event_at="$(normalize_timestamp "$relayed_review_event_at")"
    relayed_review_event_suffix="; e:$(timestamp_event_tag "$relayed_review_event_at")"
  else
    relayed_review_event_suffix="; event:captured"
  fi
  if [[ "${relayed_security_finding:-false}" == true ]]; then
    stamp_status "review-security-history" pending \
      "Security findings observed for PR #$pr_number on head $head_sha; review:$relayed_review_id; event:captured" >/dev/null
    record_security_event_origin "review:$relayed_review_id"
    security_withdrawal_unresolved=true
  else
    stamp_status "review-finding-history" pending \
      "Regular findings observed for PR #$pr_number on head $head_sha; review:$relayed_review_id$relayed_review_event_suffix" >/dev/null
    edited_finding=true
  fi
fi

# Persist authenticated withdrawal deliveries even when their deleted body no
# longer exists in the API list. External watermarks are trusted finding history.
if [[ -n "$finding_after" ]]; then
  stamp_status "$REVIEW_REVIEW_CONTEXT" pending "Regular review invalidated at $finding_after; PR #$pr_number; withdrawn delivery" >/dev/null
fi
native_regular_candidate=false
if [[ "$native_event_head_bound" == true ]] && jq -e \
    '.action == "created" and (.comment.id | type == "number" and . > 0 and floor == .)' \
    "$event_path" >/dev/null 2>&1; then
  native_candidate_id="$(jq -r '.comment.id' "$event_path")"
  native_candidate_body="$(jq -r '.comment.body // empty' "$event_path")"
  native_candidate_at="$(jq -r '.comment.updated_at // .comment.created_at // empty' "$event_path")"
  native_candidate_base64="$(jq -r '.comment.body // "" | @base64' "$event_path")"
  # Do not put this call in a conditional: that disables inherited ERR handling
  # inside regular_evidence and could acknowledge an unclassified event.
  native_candidate_evidence="$(regular_evidence "$native_candidate_body" "$native_candidate_id" issue_comment "$native_candidate_at" "$native_candidate_base64")"
  if jq -e --arg id "issue-comment-$native_candidate_id" \
      'any(.deliveries[]; .source == "issue_comment" and .id == $id and (.clean | not) and .neutral != true)' \
      <<< "$native_candidate_evidence" >/dev/null; then
    native_regular_candidate=true
  fi
fi
  if [[ "$event_name" == issue_comment && -f "$event_path" ]] &&
   jq -e --arg head "$head_sha" --arg prefix "$head_prefix" --arg native_head_bound "$native_event_head_bound" --arg native_regular_candidate "$native_regular_candidate" --arg security_heading_pattern "$security_heading_pattern" --arg clean_security_report_pattern "$security_clean_report_pattern" '
     def contains_security_heading:
       split("\n") | any(.[]; test($security_heading_pattern));
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
def clean_security_envelope:
  if test($clean_security_report_pattern) then
    (sub($clean_security_report_pattern; "")
  | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
  | gsub("\r"; "")
  | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
     def coordinator_prelude:
       test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
     def coordinator_result_for_head:
       . as $body
       | if ($body | test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)")) then
           (capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head == $head)
         else false end;
     def has_security_report_link:
       (ascii_downcase) as $lower
       | ($lower | contains("[view security finding report]("))
         and ((($lower | clean_security_envelope) | not)
              or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));
     def contains_security_marker:
       test("(?im)(?:\\A|\\n)[[:blank:]]*\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$") or
       test("(?is)\\A[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*(?:\\r?\\n|\\z)") or
       (contains_security_heading and test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$"));
     def native_security_result:
       if coordinator_prelude then
         capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body
         | split("\n") as $lines
         | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern))] | .[0]) as $start
         | if $start == null then $lines | join("\n") else $lines[$start:] | join("\n") end
       else . end;
     def native_security_candidate:
       native_security_result as $result
       | ($result | contains_security_marker) or
         (($result | contains_security_heading) and ($result | has_security_report_link));
     def body_has_conflicting_head:
       ([scan("(?i)(?:^|\\n)[ \\t]*\\*{0,2}reviewed commit:\\*{0,2}[ \\t]*`([0-9a-f]{40}|[0-9a-f]{10})`(?:(?:\\r?\\n[ \\t]*)+\\[view security finding report\\]\\([^\\r\\n)]+\\)(?:[ \\t]*(?:\\r?\\n[ \\t]*)+_only the user who started this review can view the report in codex\\._)?(?:[ \\t]*(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?about codex security reviews in github</summary>[\\s\\S]*?</details>)?|(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?About Codex(?: reviews)? in GitHub</summary>[\\s\\S]*?</details>)?[ \\t]*(?:\\r?\\n[ \\t]*)*$") | .[0]]
        + (if coordinator_prelude then
             [capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head]
           else [] end))
       | map(ascii_downcase) | any(. != $head and . != $prefix);
     (.action == "deleted" or .action == "edited" or
      ($native_head_bound == "true" and .action == "created" and
       (.comment.body // "" | ((native_security_candidate and (body_has_conflicting_head | not)) or $native_regular_candidate == "true")))) and
     ([.comment.body // "", .changes.body.from // ""] | all(test("(?is)^[[:space:]]*<!--[[:space:]]*codex-pull-request-review-summary[[:space:]]*-->") | not)) and
     .comment.user.id == 199175422 and .comment.user.type == "Bot" and
     .comment.user.login == "chatgpt-codex-connector[bot]" and
     ([.comment.body // "", .changes.body.from // ""] | any(
       (($native_head_bound == "true") and ((native_security_candidate and (body_has_conflicting_head | not)) or $native_regular_candidate == "true")) or
       (coordinator_result_for_head) or
       ((contains("`" + $head + "`") or contains("`" + $prefix + "`")) and
        ((contains_security_heading and has_security_report_link) or test("(?im)(?:\\A|\\n)[[:blank:]]*(?:\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+)?<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$") or
         test("(?i)\\A[[:space:]]*(?:<!--[^>]*-->[[:space:]]*)?(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex[[:space:]]+review|review result)(?:[[:space:]]*:|[[:space:]]|$)")))))' "$event_path" >/dev/null; then
  edited_clean=false
  security_event=false
  security_event_states="$(jq -c --arg head "$head_sha" --arg prefix "$head_prefix" --arg native_head_bound "$native_event_head_bound" --arg security_heading_pattern "$security_heading_pattern" --arg clean_security_report_pattern "$security_clean_report_pattern" '
    def contains_security_heading:
      split("\n") | any(.[]; test($security_heading_pattern));
    def contains_security_marker:
      test("(?im)(?:\\A|\\n)[[:blank:]]*\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$") or
      test("(?is)\\A[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*(?:\\r?\\n|\\z)") or
      (contains_security_heading and test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$"));
    def coordinator_prelude:
      test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
    def coordinator_result_for_head:
      if coordinator_prelude then
        (capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head == $head)
      else false end;
    def body_has_conflicting_head:
      ([scan("(?i)(?:^|\\n)[ \\t]*\\*{0,2}reviewed commit:\\*{0,2}[ \\t]*`([0-9a-f]{40}|[0-9a-f]{10})`(?:(?:\\r?\\n[ \\t]*)+\\[view security finding report\\]\\([^\\r\\n)]+\\)(?:[ \\t]*(?:\\r?\\n[ \\t]*)+_only the user who started this review can view the report in codex\\._)?(?:[ \\t]*(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?about codex security reviews in github</summary>[\\s\\S]*?</details>)?|(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?About Codex(?: reviews)? in GitHub</summary>[\\s\\S]*?</details>)?[ \\t]*(?:\\r?\\n[ \\t]*)*$")[]]
       + (if coordinator_prelude then
            [capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head]
          else [] end))
      | map(ascii_downcase) | any(. != $head and . != $prefix);
    def coordinator_metadata:
      test("(?s)\\A[[:space:]]*(?:(?:Retry reason:[^\\r\\n]*|Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*)[[:space:]]*)*\\z") and (test("(?i)\\bP[0-3]\\b") | not) and ((test("(?i)codex-security-review-finding:v1") | not) or test("(?s)\\A[[:space:]]*(?:Retry reason:[^\\r\\n]*\\r?\\n[[:space:]]*)*Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*(?i:codex-security-review-finding:v1)[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*[[:space:]]*\\z")) and ((gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not);
    def security_result_sections:
      . as $body
      | if coordinator_prelude then
          capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body
          | split("\n") as $lines
          | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern))] | .[0]) as $first_security
          | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))] | .[0]) as $first_result
          | if $first_security != null and $first_result != null and ($lines[:$first_result] | join("\n") | coordinator_metadata) then
              [range(0; $lines | length) as $start
               | select($lines[$start] | test($security_heading_pattern))
               | ([range($start + 1; $lines | length)
                  | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))]
                 | .[0] // ($lines | length)) as $end
               | $lines[$start:$end] | join("\n")]
            else [$body] end
        else [$body] end;
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
def clean_security_envelope:
  if test($clean_security_report_pattern) then
    (sub($clean_security_report_pattern; "")
  | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
  | gsub("\r"; "")
  | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
    def has_security_report_link:
      (ascii_downcase) as $lower
      | ($lower | contains("[view security finding report]("))
        and ((($lower | clean_security_envelope) | not)
             or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));
    def is_security_event:
      contains_security_marker or
      (contains_security_heading and
       (has_security_report_link or ((ascii_downcase) | clean_security_envelope)));
    [.comment.body // "", .changes.body.from // .comment.body // ""] | map(
      . as $body
      | (((($native_head_bound == "true") and (body_has_conflicting_head | not)) or contains("`" + $head + "`") or contains("`" + $prefix + "`"))
         or ($body | coordinator_result_for_head))
        and ($body | security_result_sections | any(.[]; is_security_event)))
  ' "$event_path")"
  if jq -e 'any' <<< "$security_event_states" >/dev/null; then
    security_event=true
    # Suppress regular withdrawal only when the edited comment was a security
    # result before and remains one afterward. A regular clean result changing
    # into a security-only result withdraws its prior regular evidence.
    if [[ "$(jq -r '.action' "$event_path")" != edited ]] || jq -e '.[0] and .[1]' <<< "$security_event_states" >/dev/null; then
      edited_clean=true
    fi
  fi
  # Only actual regular evidence may revoke a regular verdict. Classify each
  # immutable body independently: a quota response is neutral, but replacing
  # a prior clean result or finding still withdraws that prior evidence.
  if jq -e \
      '.comment.id | type == "number" and . > 0 and floor == .' "$event_path" >/dev/null; then
    event_regular_evidence=false
    event_regular_finding=false
    event_comment_id="$(jq -r '.comment.id // empty' "$event_path")"
    event_comment_at="$(jq -r '.comment.updated_at // .comment.created_at // empty' "$event_path")"
    while IFS= read -r event_body_base64; do
      event_body="$(jq -nr --arg body "$event_body_base64" '$body | @base64d')"
      event_body_evidence="$(regular_evidence "$event_body" "$event_comment_id" issue_comment "$event_comment_at" "$event_body_base64")"
      if jq -e --arg id "issue-comment-$event_comment_id" \
          'any(.deliveries[]; .source == "issue_comment" and .id == $id)' \
          <<< "$event_body_evidence" >/dev/null; then
        event_regular_evidence=true
        if jq -e --arg id "issue-comment-$event_comment_id" \
            'any(.deliveries[]; .source == "issue_comment" and .id == $id and (.clean | not) and .neutral != true)' \
            <<< "$event_body_evidence" >/dev/null; then
          event_regular_finding=true
        fi
      fi
    done < <(jq -r '[.comment.body // "", .changes.body.from // ""] | unique[] | select(length > 0) | @base64' "$event_path")
    # Both immutable bodies matter: API visibility and lexical body ordering
    # must not hide a finding added by an edit or withdrawn from its prior body.
    if [[ "$native_event_head_bound" == true && "$event_regular_finding" == true ]]; then
      stamp_status "review-finding-history" pending \
        "Regular findings observed for PR #$pr_number on head $head_sha; issue-comment:$event_comment_id; event:captured" >/dev/null
      edited_finding=true
    fi
    if [[ "$(jq -r '.action' "$event_path")" == created && "$native_event_head_bound" == true ]]; then
      # Creation is not a withdrawal; only actual adverse evidence blocks it.
      edited_clean=true
    elif [[ "$event_regular_evidence" != true ]]; then
      edited_clean=true
    fi
  fi
  security_finding=false
  if [[ "$security_event" == true ]] && jq -e --arg head "$head_sha" --arg prefix "$head_prefix" --arg native_head_bound "$native_event_head_bound" --arg security_heading_pattern "$security_heading_pattern" --arg clean_security_report_pattern "$security_clean_report_pattern" '
    def contains_security_heading:
      split("\n") | any(.[]; test($security_heading_pattern));
    def contains_security_marker:
      test("(?im)(?:\\A|\\n)[[:blank:]]*\\[P[0-3]\\][^\\r\\n]*[[:blank:]]+<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$") or
      test("(?is)\\A[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*(?:\\r?\\n|\\z)") or
      (contains_security_heading and test("(?im)(?:\\A|\\n)[[:blank:]]*<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->[[:blank:]]*\\r?$"));
    def coordinator_prelude:
      test("(?is)\\A[[:space:]]*@codex review[ \\t]*\\r?\\n[[:space:]]*(?:Review current head \\x60[0-9a-f]{40}\\x60\\.(?: Report concrete correctness, security, and regression defects with their triggering conditions\\. Assess related cases together; omit style-only preferences\\.)?[ \\t]*\\r?\\n[[:space:]]*)?<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?:\\r?\\n|$)");
    def coordinator_result_for_head:
      if coordinator_prelude then
        (capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head == $head)
      else false end;
    def body_has_conflicting_head:
      ([scan("(?i)(?:^|\\n)[ \\t]*\\*{0,2}reviewed commit:\\*{0,2}[ \\t]*`([0-9a-f]{40}|[0-9a-f]{10})`(?:(?:\\r?\\n[ \\t]*)+\\[view security finding report\\]\\([^\\r\\n)]+\\)(?:[ \\t]*(?:\\r?\\n[ \\t]*)+_only the user who started this review can view the report in codex\\._)?(?:[ \\t]*(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?about codex security reviews in github</summary>[\\s\\S]*?</details>)?|(?:\\r?\\n[ \\t]*)+<details>[ \\t]*<summary>(?:ℹ️ )?About Codex(?: reviews)? in GitHub</summary>[\\s\\S]*?</details>)?[ \\t]*(?:\\r?\\n[ \\t]*)*$")[]]
       + (if coordinator_prelude then
            [capture("<!--[[:space:]]*review-request:v2[[:space:]]+head=(?<head>[0-9a-f]{40})[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->").head]
          else [] end))
      | map(ascii_downcase) | any(. != $head and . != $prefix);
    def coordinator_metadata:
      test("(?s)\\A[[:space:]]*(?:(?:Retry reason:[^\\r\\n]*|Root-cause diagnosis: private evidence SHA-256 [0-9a-f]{64}|Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*)[[:space:]]*)*\\z") and (test("(?i)\\bP[0-3]\\b") | not) and ((test("(?i)codex-security-review-finding:v1") | not) or test("(?s)\\A[[:space:]]*(?:Retry reason:[^\\r\\n]*\\r?\\n[[:space:]]*)*Root-cause diagnosis:[ \\t]*\\r?\\n[ \\t]*- rootCause:[^\\r\\n]*(?i:codex-security-review-finding:v1)[^\\r\\n]*\\r?\\n[ \\t]*- changes:[^\\r\\n]*\\r?\\n[ \\t]*- validation:[^\\r\\n]*[[:space:]]*\\z")) and ((gsub("`[^`]*`"; "") | test("(?is)<!--[[:blank:]]*codex-security-review-finding:v1[[:blank:]]*-->")) | not);
    def security_result_sections:
      . as $body
      | if coordinator_prelude then
          capture("(?s)<!--[[:space:]]*review-request:v2[[:space:]]+head=[0-9a-f]{40}[[:space:]]+base=[0-9a-f]{40}[[:space:]]*-->[[:space:]]*(?<body>.*)$").body
          | split("\n") as $lines
          | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern))] | .[0]) as $first_security
          | ([range(0; $lines | length) | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))] | .[0]) as $first_result
          | if $first_security != null and $first_result != null and ($lines[:$first_result] | join("\n") | coordinator_metadata) then
              [range(0; $lines | length) as $start
               | select($lines[$start] | test($security_heading_pattern))
               | ([range($start + 1; $lines | length)
                  | select($lines[.] | test($security_heading_pattern) or test("(?i)\\A[[:space:]]*(?:#{1,6}[[:space:]]+(?:[^[:alnum:]\\r\\n]+[[:space:]]+)?)?(?:codex review|review result)(?:[[:space:]]*:|[[:space:]]|$)"))]
                 | .[0] // ($lines | length)) as $end
               | $lines[$start:$end] | join("\n")]
            else [$body] end
        else [$body] end;
def clean_security_footer($summary; $findings_sentence):
  "\n\n" + ([
    "_only the user who started this review can view the report in codex._",
    "",
    "<details> <summary>" + $summary + "</summary>",
    "<br/>",
    "",
    "this is an experimental codex feature. reviews are triggered when:",
    "- you comment \"@codex security review\"",
    "- a regular code review gets triggered (for example, \"@codex review\" or when a pr is opened), and you\u2019re opted in so security review runs alongside code review",
    "",
    $findings_sentence,
    "",
    "",
    "</details>"
  ] | join("\n"));
def clean_security_envelope:
  if test($clean_security_report_pattern) then
    (sub($clean_security_report_pattern; "")
  | gsub("this is an experimental codex feature\\. security reviews are triggered when:"; "this is an experimental codex feature. reviews are triggered when:")
  | gsub("\r"; "")
  | gsub("^[[:space:]]+|[[:space:]]+$"; "")) as $tail
    | ($tail == ""
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings were found.") | gsub("^[[:space:]]+|[[:space:]]+$"; ""))
       or $tail == (clean_security_footer("ℹ️ about codex security reviews in github"; "once complete, codex will leave suggestions, or a comment if no findings are found.") | gsub("^[[:space:]]+|[[:space:]]+$"; "")))
  else false end;
    def has_security_report_link:
      (ascii_downcase) as $lower
      | ($lower | contains("[view security finding report]("))
        and ((($lower | clean_security_envelope) | not)
             or ($lower | test("(?im)(?:\\A|\\n)[[:space:]]*\\[P[0-3]\\]")));
    ([.comment.body // "", .changes.body.from // ""] | any(
      . as $body
      | (((($native_head_bound == "true") and (body_has_conflicting_head | not)) or contains("`" + $head + "`") or contains("`" + $prefix + "`"))
         or ($body | coordinator_result_for_head))
        and ($body | security_result_sections | any(.[]; . as $result
          | ($result | contains_security_marker) or
            (($result | contains_security_heading) and
             ($result | has_security_report_link))))))
  ' "$event_path" >/dev/null; then
    security_finding=true
  fi
  if [[ "$security_finding" == true ]]; then
    event_action="$(jq -r '.action' "$event_path")"
    comment_id="$(jq -r '.comment.id // empty' "$event_path")"
    if [[ "$event_action" == created ]]; then
      # Creation is an authenticated observation, not a withdrawal.  Preserve
      # it before the mutable comment can disappear from the live API scan.
      security_marker="issue-comment"
      if [[ "$comment_id" =~ ^[1-9][0-9]*$ ]]; then
        security_marker="issue-comment:$comment_id"
        record_security_event_origin "$security_marker"
      fi
      stamp_status "review-security-history" pending \
        "Security findings observed for PR #$pr_number on head $head_sha; $security_marker; event:captured" >/dev/null
      native_security_finding_observed=true
      edited_clean=true
    else
      withdrawal_at="$(jq -r '.comment.updated_at // empty' "$event_path")"
      withdrawal_at="${withdrawal_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
      security_marker="withdrawn delivery"
      if [[ "$comment_id" =~ ^[0-9]+$ ]]; then
        security_marker="withdrawn issue-comment:$comment_id"
      fi
      # A deleted mutable comment cannot clear an authenticated security
      # finding, even when its numeric origin can be persisted by a consumer.
      security_withdrawal_unresolved=true
      stamp_status "review-security-history" pending "Security invalidated; $security_marker for PR #$pr_number on head $head_sha" >/dev/null
      if [[ "$comment_id" =~ ^[1-9][0-9]*$ ]]; then
        record_security_event_origin "issue-comment:$comment_id"
      fi
      edited_clean=true
    fi
  fi
  if [[ "$security_event" != true && "$(jq -r '.action' "$event_path")" == deleted ]]; then
    prior_body="$(jq -r '.comment.body // empty' "$event_path")"
    prior_body_base64="$(jq -r '.comment.body // "" | @base64' "$event_path")"
    prior_id="$(jq -r '.comment.id // empty' "$event_path")"
    prior_at="$(jq -r '.comment.updated_at // .comment.created_at // empty' "$event_path")"
    prior_at="${prior_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    if [[ -n "$prior_body" && "$prior_id" =~ ^[1-9][0-9]*$ ]] && jq -e '
      .comment.user.login == "chatgpt-codex-connector[bot]" and
      .comment.user.id == 199175422 and .comment.user.type == "Bot"' \
      "$event_path" >/dev/null && body_targets_review_head "$prior_body" "$head_sha"; then
      prior_evidence="$(regular_evidence "$prior_body" "$prior_id" issue_comment "$prior_at" "$prior_body_base64")"
      if jq -e --arg id "issue-comment-$prior_id" 'any(.deliveries[]; .source == "issue_comment" and .id == $id and (.clean | not) and .neutral != true)' <<< "$prior_evidence" >/dev/null; then
        # Deleting a findings-bearing issue comment is not a dismissal.
        # Retain the origin on this head so a later clean result cannot erase it.
        stamp_status "review-finding-history" pending \
          "Regular findings observed for PR #$pr_number on head $head_sha; issue-comment:$prior_id; event:captured" >/dev/null
        edited_finding=true
      fi
    fi
  fi
  # The prior body must be classified independently. A replacement security
  # heading (or prose that merely resembles one) cannot erase a prior regular
  # finding before its creation event was recorded.
  if [[ "$(jq -r '.action' "$event_path")" == edited ]]; then
    prior_body="$(jq -r '.changes.body.from // empty' "$event_path")"
    prior_body_base64="$(jq -r '.changes.body.from // "" | @base64' "$event_path")"
    prior_id="$(jq -r '.comment.id // empty' "$event_path")"
    prior_at="$(jq -r '.comment.created_at // .comment.updated_at // empty' "$event_path")"
    if [[ -n "$prior_body" ]] && body_targets_review_head "$prior_body" "$head_sha"; then
      prior_evidence="$(regular_evidence "$prior_body" "$prior_id" issue_comment "$prior_at" "$prior_body_base64")"
      if jq -e --arg id "issue-comment-$prior_id" 'any(.deliveries[]; .id == $id and (.clean | not) and .neutral != true)' <<< "$prior_evidence" >/dev/null; then
        stamp_status "review-finding-history" pending \
          "Regular findings observed for PR #$pr_number on head $head_sha; issue-comment:$prior_id; event:captured" >/dev/null
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
    stamp_status "$REVIEW_REVIEW_CONTEXT" pending "Regular review invalidated at $withdrawal_at; PR #$pr_number; $withdrawal_marker" >/dev/null
    evidence_after="$(normalize_timestamp "$withdrawal_at")"
  fi
fi
if [[ -n "$event_path" ]]; then event_history_phase_done=true; fi
if [[ "$event_history_phase_done" == true && "${REVIEW_NATIVE_EVENT_ID:-}" =~ ^[1-9][0-9]*$ ]]; then
  stamp_status "review-native-event/$REVIEW_NATIVE_EVENT_ID" success \
    "Review event $REVIEW_NATIVE_EVENT_ID recorded for PR #$pr_number" >/dev/null
  echo "Review event $REVIEW_NATIVE_EVENT_ID recorded for PR #$pr_number"
fi

# Status receipts are created by the first event-job step, so an audit can
# otherwise observe a queued native event before its pending marker exists.
# After persisting this run's immutable event, elect the newest active event
# as reconciler and wait for older deliveries to finish their history writes.
# Start with a bounded active-run census, then poll known run IDs and search the
# current run's creation window for later events. Re-census at both publication
# boundaries to account for temporarily omitted preexisting runs. Active lists
# fail closed at saturation. Completed native events are always paginated from
# PR creation; candidate-mintable status contexts never advance that boundary.
REVIEW_GATE_QUIESCENCE_CENSUS_IDS=""
REVIEW_GATE_QUIESCENCE_ACTIVE_IDS=""
wait_for_active_review_events() {
  (( evidence_only_mode )) && return 0
  [[ "${REQUIRE_CLEAN_ISSUE_COMMENT_RECEIPT:-false}" == true ]] || return 0
  local gate_file="${REVIEW_GATE_WORKFLOW_FILE:-}"
  local sensor_file="${REVIEW_EVENT_SENSOR_WORKFLOW_FILE:-}"
  local receiver_file="${REVIEW_EVENT_RECEIVER_WORKFLOW_FILE:-}"
  local issue_comment_receipts_script="${ISSUE_COMMENT_RECEIPTS_SCRIPT:-$(dirname "${BASH_SOURCE[0]}")/issue_comment_receipts.py}"
  local gate_id sensor_id receiver_id current_run_id current_run_started_at
  local active_runs completed_sensor_runs known_active_ids next_known_ids
  local source_statuses persisted_sensor_ids persisted_gate_ids sensor_observed_ids gate_observed_ids
  local completed_gate_ids census_from settled_gate_ids
  local attestation_result completed_gate_discovered
  local attempt newer active_id completed_sensor_id fail_fast="${1:-false}"
  local force_census="${2:-false}"
  local unacknowledged_capture=false
  local initial_census_ids="${REVIEW_GATE_QUIESCENCE_CENSUS_IDS:- }"
  # Capture-only runs record event history but never publish review-gate
  # success. They do not need workflow IDs used by normal-run quiescence.
  [[ "${RECORD_EVENT_ONLY:-false}" == true ]] && return 0
  if [[ "$force_census" == true ]]; then
    # Re-enumerate preexisting active runs at publication boundaries. The
    # Actions API can temporarily omit a run from its first list response;
    # a cached workflow ID plus a current-run creation filter would never
    # rediscover that older event after the API catches up.
    initial_census_ids=" "
  fi
  trusted_workflow_id() {
    local file="$1" path id
    [[ "$file" =~ ^[A-Za-z0-9._-]+\.yml$ ]] || return 1
    path="$(gh api "repos/$REPO/contents/.github/workflows/$file?ref=$DEFAULT_BRANCH" --jq '.path')" || return 1
    [[ "$path" == ".github/workflows/$file" ]] || return 1
    id="$(gh api "repos/$REPO/actions/workflows/$file" --jq '.id | select(type == "number" and . > 0)')" || return 1
    [[ "$id" =~ ^[1-9][0-9]*$ ]] || return 1
    printf '%s' "$id"
  }
  append_completed_sensor_run() {
    local candidate_id="$1"
    [[ "$candidate_id" =~ ^[1-9][0-9]*$ ]] || return 0
    case $'\n'"$completed_sensor_runs"$'\n' in
      *$'\n'"$candidate_id"$'\n'*) return 0 ;;
    esac
    completed_sensor_runs+="${completed_sensor_runs:+$'\n'}$candidate_id"
  }
  is_attested_foreign_gate_run() {
    local candidate_id="$1" snapshot="${2:-}" title claimed_pr workflow_sha jobs expected_job expected_current_job human_request_marker=false attest_input attest_result attest_flag
    if [[ -z "$snapshot" ]]; then
      snapshot="$(gh api "repos/$REPO/actions/runs/$candidate_id")" || return 2
    fi
    jq -e --argjson workflow "$gate_id" --argjson run "$candidate_id" '
      type == "object" and .id == $run and .workflow_id == $workflow
      and (.pull_requests | type == "array")
      and (.display_title | type == "string")
      and (.status | type == "string")
    ' <<< "$snapshot" >/dev/null || return 2
    [[ "$(jq -r '.pull_requests | length' <<< "$snapshot")" == 0 ]] || return 1
    title="$(jq -r '.display_title' <<< "$snapshot")"
    if [[ "$title" =~ ^Review\ gate\ PR\ \#([1-9][0-9]*)\ \|\ review-origin=authorized-human-review-v1\ \|\ policy-workflow-sha=([0-9a-f]{40})$ ]]; then
      claimed_pr="${BASH_REMATCH[1]}"
      workflow_sha="${BASH_REMATCH[2]}"
      if [[ "$claimed_pr" == "$pr_number" ]]; then
        # A same-PR run is a current candidate, not a foreign run. Continue
        # through native_capture_proof so a failed connector run with a valid
        # receipt can settle; missing receipts remain blocking.
        return 1
      fi
      jq -e --arg run "$candidate_id" --arg workflow "$gate_id" '
        (.id | tostring) == $run and (.workflow_id | tostring) == $workflow
        and .event == "issue_comment" and .actor.type == "User"
        and (.actor.id | type) == "number" and .actor.id > 0
        and (.actor.login | type) == "string" and (.actor.login | length) > 0
      ' <<< "$snapshot" >/dev/null || return 1
      human_request_marker=true
    elif [[ "$title" =~ ^Review\ gate\ PR\ \#([1-9][0-9]*)$ ]]; then
      claimed_pr="${BASH_REMATCH[1]}"
      # Legacy titles bind the event to a PR number but carry no connector
      # receipt. Attribute an unassociated run only when its server-attested
      # actor and exact trusted workflow revision prove the matching path.
      [[ "$claimed_pr" != "$pr_number" ]] || return 1
      if jq -e --arg run "$candidate_id" --arg workflow "$gate_id" '
        (.id | tostring) == $run and (.workflow_id | tostring) == $workflow
        and .event == "issue_comment" and .actor.type == "User"
        and (.actor.id | type) == "number" and .actor.id > 0
        and (.actor.login | type) == "string" and (.actor.login | length) > 0
      ' <<< "$snapshot" >/dev/null; then
        attest_flag=--attest-legacy-human-run
      elif jq -e --arg run "$candidate_id" --arg workflow "$gate_id" '
        (.id | tostring) == $run and (.workflow_id | tostring) == $workflow
        and .event == "issue_comment" and .actor.type == "Bot"
        and .actor.id == 199175422 and .actor.login == "chatgpt-codex-connector[bot]"
      ' <<< "$snapshot" >/dev/null; then
        attest_flag=--attest-legacy-bot-run
      else
        return 1
      fi
      attest_input="$(jq -cn --argjson run "$snapshot" '{run:$run}')" || return 2
      if printf '%s' "$attest_input" | python3 "$issue_comment_receipts_script" \
          --repo "$REPO" --head "$head_sha" --pr "$claimed_pr" \
          --workflow-file "$gate_file" "$attest_flag"; then
        return 0
      else
        attest_result=$?
        [[ "$attest_result" == 3 ]] && return 1
        return 2
      fi
    else
      if [[ ! "$title" =~ ^Review\ gate\ PR\ \#([1-9][0-9]*)\ \|\ policy-workflow-sha=([0-9a-f]{40})$ ]]; then
        return 1
      fi
      claimed_pr="${BASH_REMATCH[1]}"
      workflow_sha="${BASH_REMATCH[2]}"
      if [[ "$claimed_pr" == "$pr_number" ]]; then
        # Do not skip same-PR connector runs just because Actions omitted the
        # pull_requests association; their exact receipt is checked downstream.
        return 1
      fi
    fi
    jobs="$(gh api "repos/$REPO/actions/runs/$candidate_id/jobs?per_page=100" --paginate --slurp)" || return 2
    jq -e '.[0].total_count as $expected
      | type == "array" and length > 0 and all(.[];
        type == "object" and (.jobs | type == "array")
        and .total_count == $expected
        and (.total_count | type == "number" and . >= 0)
        and .total_count >= (.jobs | length))
      and (map(.jobs | length) | add) == $expected' <<< "$jobs" >/dev/null || return 2
    expected_job="evaluate-review PR #$claimed_pr | policy-workflow-sha=$workflow_sha"
    expected_current_job="evaluate-review PR #$pr_number | policy-workflow-sha=$workflow_sha"
    local claimed_job_present=false current_job_present=false
    jq -e --arg name "$expected_job" 'any(.[].jobs[]?; .name == $name)' <<< "$jobs" >/dev/null \
      && claimed_job_present=true
    jq -e --arg name "$expected_current_job" 'any(.[].jobs[]?; .name == $name)' <<< "$jobs" >/dev/null \
      && current_job_present=true
    if [[ "$claimed_job_present" == true && "$current_job_present" == true ]]; then
      return 2
    fi
    if [[ "$current_job_present" == true ]]; then
      [[ "$human_request_marker" == false ]] || return 2
      return 1
    fi
    if [[ "$claimed_job_present" == true ]]; then return 0; fi
    if jq -e '[.[].jobs[]?] | length > 0' <<< "$jobs" >/dev/null; then
      return 2
    fi
    if [[ "$human_request_marker" == true ]] && \
        jq -e '(.status == "requested" or .status == "waiting" or .status == "pending"
          or .status == "queued" or .status == "in_progress")
          or (.status == "completed" and (.conclusion | type) == "string")' \
          <<< "$snapshot" >/dev/null; then
      return 0
    fi
    # A completed run that was cancelled before creating any job could not
    # have observed or acknowledged an event; do not persist it as this PR's.
    if jq -e '[.[].jobs[]?] | length == 0' <<< "$jobs" >/dev/null \
      && jq -e '.status == "completed" and .conclusion == "cancelled"' <<< "$snapshot" >/dev/null; then
      return 0
    fi
    return 2
  }
  is_attested_non_connector_issue_comment_gate_run() {
    local candidate_id="$1" snapshot="${2:-}" title claimed_pr workflow_sha attest_input attest_result
    if [[ -z "$snapshot" ]]; then
      snapshot="$(gh api "repos/$REPO/actions/runs/$candidate_id")" || return 2
    fi
    jq -e --arg workflow "$gate_id" --arg id "$candidate_id" '
      type == "object" and (.id | tostring) == $id
      and (.workflow_id | tostring) == $workflow
      and (.event | type) == "string"
      and (.display_title | type) == "string"
      and (.actor | type) == "object"
      and (.actor.id | type) == "number" and .actor.id > 0
      and (.actor.login | type) == "string" and (.actor.login | length) > 0
      and (.actor.type == "User" or .actor.type == "Bot")
      and (.pull_requests | type) == "array"
      and all(.pull_requests[]; type == "object" and (.number | type) == "number"
        and .number > 0 and .number == (.number | floor))
    ' <<< "$snapshot" >/dev/null || return 2
    [[ "$(jq -r '.event' <<< "$snapshot")" == issue_comment ]] || return 1
    [[ "$(jq -r '.actor.type' <<< "$snapshot")" == User ]] || return 1
    # Keep active human-request audits in the quiescence wait. They may still
    # write the review status even though they never emit connector receipts.
    [[ "$(jq -r '.status' <<< "$snapshot")" == completed ]] || return 1
    title="$(jq -r '.display_title' <<< "$snapshot")"
    if [[ "$title" =~ ^Review\ gate\ PR\ \#([1-9][0-9]*)\ \|\ review-origin=authorized-human-review-v1\ \|\ policy-workflow-sha=([0-9a-f]{40})$ ]]; then
      claimed_pr="${BASH_REMATCH[1]}"
      workflow_sha="${BASH_REMATCH[2]}"
      [[ "$claimed_pr" == "$pr_number" && "$workflow_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
      jq -e --arg pr "$pr_number" 'all(.pull_requests[]; .number == ($pr | tonumber))' \
        <<< "$snapshot" >/dev/null || return 1
      return 0
    fi
    if [[ "$title" =~ ^Review\ gate\ PR\ \#([1-9][0-9]*)\ \|\ policy-workflow-sha=([0-9a-f]{40})$ ]]; then
      claimed_pr="${BASH_REMATCH[1]}"
      workflow_sha="${BASH_REMATCH[2]}"
      [[ "$claimed_pr" == "$pr_number" && "$workflow_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
      jq -e --arg pr "$pr_number" 'all(.pull_requests[]; .number == ($pr | tonumber))' \
        <<< "$snapshot" >/dev/null || return 1
    elif [[ "$title" == *review-origin=* || "$title" == *policy-workflow-sha=* ]]; then
      return 1
    fi
    # Legacy titles do not bind a workflow run to its triggering comment.
    # Accept only the trusted old step log; a nearby request comment is not
    # immutable proof and could otherwise hide an unacknowledged deletion.
    attest_input="$(jq -cn --argjson run "$snapshot" '{run:$run}')" || return 2
    if printf '%s' "$attest_input" | python3 "$issue_comment_receipts_script" \
        --repo "$REPO" --head "$head_sha" --pr "$pr_number" \
        --workflow-file "$gate_file" --attest-legacy-human-run; then
      return 0
    else
      attest_result=$?
      [[ "$attest_result" == 3 ]] && return 1
      return 2
    fi
  }
  gate_id="$(trusted_workflow_id "$gate_file")" || {
    echo "Could not identify the trusted review workflow from the default branch; refusing to clear the gate." >&2
    return 2
  }
  sensor_id="$(trusted_workflow_id "$sensor_file")" || {
    echo "Could not identify the trusted review-event sensor from the default branch; refusing to clear the gate." >&2
    return 2
  }
  receiver_id="$(trusted_workflow_id "$receiver_file")" || {
    echo "Could not identify the trusted review-event receiver from the default branch; refusing to clear the gate." >&2
    return 2
  }
  current_run_id="${GITHUB_RUN_ID:-}"
  [[ "$current_run_id" =~ ^[1-9][0-9]*$ ]] || {
    echo "Could not bind event quiescence to the current workflow run." >&2
    return 2
  }
  current_run_started_at="$(gh api "repos/$REPO/actions/runs/$current_run_id" --jq '.created_at')" || {
    echo "Could not bind event discovery to the current workflow start time." >&2
    return 2
  }
  [[ "$current_run_started_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z$ ]] || {
    echo "The current workflow run returned an invalid creation timestamp." >&2
    return 2
  }
  current_run_started_at="$(normalize_timestamp "$current_run_started_at")" || return 2
  current_run_started_at="${current_run_started_at%.*}Z"
  source_statuses="$(gh api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || {
    echo "Could not read durable review-event observations; refusing to clear the gate." >&2
    return 2
  }
  # Commit statuses share the Actions bot identity with candidate workflows.
  # Never let a status checkpoint move the terminal-run scan forward: a
  # candidate can mint the same context and description. Re-scan from PR
  # creation; completed_gate_runs partitions the search window without
  # accepting GitHub's capped result count as complete.
  census_from="${pr_created_at%.*}Z"
  # Remember observed sensors on this exact head so a later audit still waits
  # for receiver acknowledgement if this run's bounded polling expires. Old
  # unscoped markers remain readable during rollout and are migrated below.
  persisted_sensor_ids="$(jq -r --arg pr "$pr_number" --arg head "$head_sha" '
    [.[][]
     | select((.context // "") | test("^review-event-observed/([1-9][0-9]*/)?[1-9][0-9]*$"))
     | select(.creator.login == "github-actions[bot]")
     | (.context | split("/") | last) as $id
     | select(.description == ("Sensor run " + $id + " observed active for PR #" + $pr + " on head " + $head)
         or .description == ("Capture receipt received for sensor run " + $id + " for PR #" + $pr + " on head " + $head)
         or .description == ("Foreign sensor run " + $id + "; no event receipt for PR #" + $pr + " on head " + $head))]
    | map(select(.state == "pending"))
    | unique_by(.context)
    | .[]
    | (.context | split("/")) as $parts
    | select(($parts | length) == 2 or $parts[1] == $pr)
    | $parts[-1] as $id
    | [$id, (if ($parts | length) == 2 then "legacy" else "scoped" end)]
    | @tsv
  ' <<< "$source_statuses")" || {
    echo "Could not validate durable review-event observations; refusing to clear the gate." >&2
    return 2
  }
  # Success statuses in commit contexts are candidate-mintable. They are a
  # hint only, never durable proof that a previously observed event was
  # settled. The complete terminal-run census below revalidates each source
  # run and its native receipt from PR creation on every evaluation.
  settled_gate_ids=""
  persisted_gate_ids="$(jq -r --arg pr "$pr_number" --arg head "$head_sha" '
    [.[][]
     | select((.context // "") | test("^review-gate-event-observed/" + $pr + "/[1-9][0-9]*$"))
     | select(.creator.login == "github-actions[bot]")
     | (.context | split("/") | last) as $id
     | select(.description == ("Gate run " + $id + " observed active for PR #" + $pr + " on head " + $head)
         or .description == ("Gate run " + $id + " completed successfully for PR #" + $pr + " on head " + $head)
         or .description == ("Gate run " + $id + " skipped event work for PR #" + $pr + " on head " + $head)
         or .description == ("Native receipt recorded for gate run " + $id + " for PR #" + $pr + " on head " + $head)
         or .description == ("Human review request run " + $id + "; no connector receipt for PR #" + $pr + " on head " + $head)
         or .description == ("Foreign gate run " + $id + "; no event receipt for PR #" + $pr + " on head " + $head))]
    | map(select(.state == "pending"))
    | unique_by(.context)
    | .[] | (.context | split("/") | last)
  ' <<< "$source_statuses")" || {
    echo "Could not validate durable gate-run observations; refusing to clear the gate." >&2
    return 2
  }
  unsettled_gate_ids=""
  while IFS= read -r candidate_id; do
    [[ "$candidate_id" =~ ^[1-9][0-9]*$ ]] || continue
    case $'\n'"$settled_gate_ids"$'\n' in
      *$'\n'"$candidate_id"$'\n'*) ;;
      *) unsettled_gate_ids+="${unsettled_gate_ids:+$'\n'}$candidate_id" ;;
    esac
  done <<< "$persisted_gate_ids"
  persisted_gate_ids="$unsettled_gate_ids"
  unset unsettled_gate_ids
  sensor_observed_ids=""
  gate_observed_ids="$persisted_gate_ids"
  known_active_ids="${REVIEW_GATE_QUIESCENCE_ACTIVE_IDS:-}"
  persist_sensor_observation() {
    local candidate_id="$1" marker_context marker_description trusted_pending
    [[ "$candidate_id" =~ ^[1-9][0-9]*$ ]] || return 0
    case $'\n'"$sensor_observed_ids"$'\n' in *$'\n'"$candidate_id"$'\n'*) return 0 ;; esac
    marker_context="review-event-observed/$pr_number/$candidate_id"
    marker_description="Sensor run $candidate_id observed active for PR #$pr_number on head $head_sha"
    trusted_pending="$(jq -e --arg context "$marker_context" --arg description "$marker_description" '
      [.[][] | select(.context == $context and .creator.login == "github-actions[bot]")]
      | max_by([(.created_at // .updated_at // ""), (.id // 0)])
      // {}
      | .state == "pending" and .description == $description
    ' <<< "$source_statuses" >/dev/null && echo true || echo false)"
    if [[ "$trusted_pending" != true ]]; then
      stamp_status "$marker_context" pending "$marker_description" >/dev/null || return 1
    fi
    sensor_observed_ids+="${sensor_observed_ids:+$'\n'}$candidate_id"
  }
  sensor_observation_pending() {
    local candidate_id="$1"
    case $'\n'"$sensor_observed_ids"$'\n' in *$'\n'"$candidate_id"$'\n'*) return 0 ;; esac
    return 1
  }
  persist_gate_observation() {
    local candidate_id="$1" marker_context marker_description trusted_pending
    [[ "$candidate_id" =~ ^[1-9][0-9]*$ ]] || return 0
    case $'\n'"$gate_observed_ids"$'\n' in *$'\n'"$candidate_id"$'\n'*) return 0 ;; esac
    marker_context="review-gate-event-observed/$pr_number/$candidate_id"
    marker_description="Gate run $candidate_id observed active for PR #$pr_number on head $head_sha"
    trusted_pending="$(jq -e --arg context "$marker_context" --arg description "$marker_description" '
      [.[][] | select(.context == $context and .creator.login == "github-actions[bot]")]
      | max_by([(.created_at // .updated_at // ""), (.id // 0)])
      // {}
      | .state == "pending" and .description == $description
    ' <<< "$source_statuses" >/dev/null && echo true || echo false)"
    if [[ "$trusted_pending" != true ]]; then
      stamp_status "$marker_context" pending "$marker_description" >/dev/null || return 1
    fi
    gate_observed_ids+="${gate_observed_ids:+$'\n'}$candidate_id"
  }
  gate_observation_pending() {
    local candidate_id="$1"
    case $'\n'"$gate_observed_ids"$'\n' in *$'\n'"$candidate_id"$'\n'*) return 0 ;; esac
    return 1
  }
  settle_human_review_request_gate_run() {
    local candidate_id="$1" marker_context marker_description
    gate_observation_pending "$candidate_id" || return 0
    marker_context="review-gate-event-observed/$pr_number/$candidate_id"
    marker_description="Human review request run $candidate_id; no connector receipt for PR #$pr_number on head $head_sha"
    stamp_status "$marker_context" success "$marker_description" >/dev/null || return 1
    gate_observed_ids="$(printf '%s\n' "$gate_observed_ids" | awk -v id="$candidate_id" '$0 != id')"
    case $'\n'"$settled_gate_ids"$'\n' in *$'\n'"$candidate_id"$'\n'*) ;;
      *) settled_gate_ids+="${settled_gate_ids:+$'\n'}$candidate_id" ;;
    esac
  }
  track_completed_gate_run() {
    local candidate_id="$1" attestation_result
    [[ "$candidate_id" =~ ^[1-9][0-9]*$ ]] || return 1
    [[ "$candidate_id" != "$current_run_id" ]] || return 0
    case $'\n'"$settled_gate_ids"$'\n' in *$'\n'"$candidate_id"$'\n'*) return 0 ;; esac
    if is_attested_non_connector_issue_comment_gate_run "$candidate_id"; then
      settle_human_review_request_gate_run "$candidate_id" || return 1
      return 0
    else
      attestation_result=$?
      if [[ "$attestation_result" -gt 1 ]]; then
        echo "Could not safely classify completed user issue-comment run $candidate_id; refusing to clear the gate." >&2
        return 1
      fi
    fi
    if is_attested_foreign_gate_run "$candidate_id"; then
      return 0
    else
      attestation_result=$?
      if [[ "$attestation_result" -gt 1 ]]; then
        echo "Could not safely attribute completed unassociated gate run $candidate_id; refusing to persist an observation or clear the gate." >&2
        return 1
      fi
    fi
    persist_gate_observation "$candidate_id" || return 1
    case $'\n'"$next_known_ids"$'\n' in *$'\n'"$candidate_id"$'\n'*) return 0 ;; esac
    next_known_ids+="${next_known_ids:+$'\n'}$candidate_id"
    completed_gate_discovered=true
  }
  while IFS=$'\t' read -r active_id marker_scope; do
    [[ "$active_id" =~ ^[1-9][0-9]*$ ]] || continue
    if sensor_observation_pending "$active_id"; then
      continue
    fi
    if [[ "$marker_scope" == legacy ]]; then
      capture_status="$(jq -c --arg scoped "review-event-capture/$pr_number/$active_id" \
          --arg legacy "review-event-capture/$active_id" '
        [.[][] | select(.context == $scoped)] as $scoped_statuses
        | if ($scoped_statuses | length) > 0 then $scoped_statuses
          else [.[][] | select(.context == $legacy)] end
        | if length == 0 then null else max_by([(.created_at // .updated_at // ""), (.id // 0)]) end' \
        <<< "$source_statuses")" || return 2
      if [[ "$(jq -r '.state // empty' <<< "$capture_status")" == success ]] \
          && capture_receipt_is_authenticated "$capture_status"; then
        sensor_observed_ids+="${sensor_observed_ids:+$'\n'}$active_id"
      else
        persist_sensor_observation "$active_id" || return 2
      fi
    else
      sensor_observed_ids+="${sensor_observed_ids:+$'\n'}$active_id"
    fi
    case $'\n'"$known_active_ids"$'\n' in *$'\n'"$active_id"$'\n'*) ;;
      *) known_active_ids+="${known_active_ids:+$'\n'}$active_id" ;;
    esac
  done <<< "$persisted_sensor_ids"
  while IFS= read -r active_id; do
    [[ "$active_id" =~ ^[1-9][0-9]*$ ]] || continue
    case $'\n'"$known_active_ids"$'\n' in *$'\n'"$active_id"$'\n'*) ;;
      *) known_active_ids+="${known_active_ids:+$'\n'}$active_id" ;;
    esac
  done <<< "$persisted_gate_ids"
  # A native event can finish unsuccessfully before any audit sees it active.
  # Reopening a PR does not erase that obligation. Do not trust success
  # settlements from shared commit-status contexts; inspect every adverse run
  # and require its source event receipt.
  completed_gate_ids="$(python3 "$issue_comment_receipts_script" --repo "$REPO" --head "$head_sha" \
    --pr "$pr_number" --completed-gate-workflow-id "$gate_id" --census-from "$census_from" \
    --census-through "$current_run_started_at")" || {
      echo "Could not completely discover terminal native review events; refusing to clear the gate." >&2
      return 2
  }
  completed_gate_ids="$(jq -er 'if type == "array" and all(.[]; type == "number" and . > 0 and . == floor)
      then map(tostring) | join("\n") else error("invalid completed event IDs") end' <<< "$completed_gate_ids")" || return 2
  next_known_ids="$known_active_ids"
  while IFS= read -r active_id; do
    [[ -n "$active_id" ]] || continue
    track_completed_gate_run "$active_id" || return 2
  done <<< "$completed_gate_ids"
  known_active_ids="$next_known_ids"
  attempt=0
  while true; do
    active_runs=""
    completed_sensor_runs=""
    next_known_ids=""
    completed_gate_discovered=false
    while IFS= read -r active_id; do
      [[ "$active_id" =~ ^[1-9][0-9]*$ ]] || continue
      local known_snapshot known_status known_workflow attestation_result
      known_snapshot="$(gh api "repos/$REPO/actions/runs/$active_id")" || {
        echo "Could not refresh a previously observed active review-event run; refusing to clear the gate." >&2
        return 2
      }
      if ! jq -e --arg id "$active_id" '(.id | tostring) == $id' <<< "$known_snapshot" >/dev/null; then
        echo "A previously observed run returned a different identity; refusing to clear the gate." >&2
        return 2
      fi
      if ! jq -e '(.pull_requests // []) | type == "array" and
          all(.[]; type == "object" and (.number | type) == "number"
            and .number > 0 and .number == (.number | floor))' <<< "$known_snapshot" >/dev/null; then
        echo "A previously observed run returned invalid PR associations; refusing to clear the gate." >&2
        return 2
      fi
      known_workflow="$(jq -r '.workflow_id | tostring' <<< "$known_snapshot")" || return 2
      if [[ "$known_workflow" == "$gate_id" ]]; then
        if is_attested_non_connector_issue_comment_gate_run "$active_id" "$known_snapshot"; then
          settle_human_review_request_gate_run "$active_id" || return 2
          continue
        else
          attestation_result=$?
          if [[ "$attestation_result" -gt 1 ]]; then
            echo "Could not safely classify persisted user issue-comment run $active_id; refusing to clear the gate." >&2
            return 2
          fi
        fi
      fi
      # A previous policy may have persisted another PR's run. Revalidate the
      # server identity before interpreting status or retiring that observation.
      # Sensor heads are candidate heads; gate/receiver heads can be main.
      if gate_observation_pending "$active_id" && [[ "$known_workflow" != "$gate_id" ]]; then
        echo "A durably observed gate run no longer matches its trusted workflow; refusing to clear the gate." >&2
        return 2
      fi
      if sensor_observation_pending "$active_id" && ! jq -e --arg workflow "$sensor_id" --arg head "$head_sha" \
          '(.workflow_id | tostring) == $workflow and .head_sha == $head' <<< "$known_snapshot" >/dev/null; then
        echo "A durably observed review sensor no longer matches its trusted workflow and exact head; refusing to clear the gate." >&2
        return 2
      fi
      if jq -e --arg id "$active_id" --arg gate "$gate_id" --arg sensor "$sensor_id" \
          --arg receiver "$receiver_id" --arg head "$head_sha" --arg pr "$pr_number" '
          (.id | tostring) == $id
          and ((.workflow_id | tostring) == $gate
            or ((.workflow_id | tostring) == $sensor and .head_sha == $head)
            or (.workflow_id | tostring) == $receiver)
          and (.pull_requests | type) == "array" and (.pull_requests | length) > 0
          and all(.pull_requests[]; .number != ($pr | tonumber))
        ' <<< "$known_snapshot" >/dev/null; then
        # This settles only a false observation, never capture or review evidence.
        if gate_observation_pending "$active_id"; then
          stamp_status "review-gate-event-observed/$pr_number/$active_id" success \
            "Foreign gate run $active_id; no event receipt for PR #$pr_number on head $head_sha" >/dev/null || return 2
          gate_observed_ids="$(printf '%s\n' "$gate_observed_ids" | awk -v id="$active_id" '$0 != id')"
        fi
        if sensor_observation_pending "$active_id"; then
          stamp_status "review-event-observed/$pr_number/$active_id" success \
            "Foreign sensor run $active_id; no event receipt for PR #$pr_number on head $head_sha" >/dev/null || return 2
          sensor_observed_ids="$(printf '%s\n' "$sensor_observed_ids" | awk -v id="$active_id" '$0 != id')"
        fi
        continue
      fi
      if gate_observation_pending "$active_id" && [[ "$known_workflow" == "$gate_id" ]] && \
          jq -e '(.pull_requests | length) == 0' <<< "$known_snapshot" >/dev/null; then
        if is_attested_foreign_gate_run "$active_id" "$known_snapshot"; then
          stamp_status "review-gate-event-observed/$pr_number/$active_id" success \
            "Foreign gate run $active_id; no event receipt for PR #$pr_number on head $head_sha" >/dev/null || return 2
          gate_observed_ids="$(printf '%s\n' "$gate_observed_ids" | awk -v id="$active_id" '$0 != id')"
          continue
        else
          attestation_result=$?
          if [[ "$attestation_result" -gt 1 ]]; then
            echo "Could not safely attribute persisted gate run $active_id; refusing to clear the gate." >&2
            return 2
          fi
        fi
      fi
      known_status="$(jq -r '.status // empty' <<< "$known_snapshot")" || return 2
      case "$known_status" in
        requested|waiting|pending|queued|in_progress)
          active_runs+="${active_runs:+$'\n'}$active_id"
          next_known_ids+="${next_known_ids:+$'\n'}$active_id"
          if jq -e --arg workflow "$gate_id" \
              '(.workflow_id | tostring) == $workflow' \
              <<< "$known_snapshot" >/dev/null; then
            persist_gate_observation "$active_id" || return 2
          fi
          if jq -e --arg workflow "$sensor_id" --arg head "$head_sha" \
              '(.workflow_id | tostring) == $workflow and .head_sha == $head' \
              <<< "$known_snapshot" >/dev/null; then
            persist_sensor_observation "$active_id" || return 2
          fi
          ;;
        completed)
          # A native event may acknowledge capture before a later audit dispatch
          # fails. Settle only from success or its exact latest trusted receipt;
          # failed-before-capture runs remain durable blockers across audits.
          if jq -e --arg workflow "$gate_id" \
              '(.workflow_id | tostring) == $workflow' \
              <<< "$known_snapshot" >/dev/null; then
            if gate_observation_pending "$active_id"; then
              local settlement_description
              settlement_description="Gate run $active_id completed successfully for PR #$pr_number on head $head_sha"
              if jq -e '.conclusion == "skipped"' <<< "$known_snapshot" >/dev/null; then
                settlement_description="Gate run $active_id skipped event work for PR #$pr_number on head $head_sha"
              elif ! jq -e '.conclusion == "success"' <<< "$known_snapshot" >/dev/null; then
                if ! jq -e '.event == "issue_comment"' <<< "$known_snapshot" >/dev/null ||
                   ! python3 "$issue_comment_receipts_script" --repo "$REPO" --head "$head_sha" \
                       --pr "$pr_number" --native-run-id "$active_id" --native-workflow-id "$gate_id" \
                       --workflow-file "$gate_file"; then
                  echo "A previously observed review-gate run completed without a successful event acknowledgement; refusing to clear the gate." >&2
                  return 2
                fi
                settlement_description="Native receipt recorded for gate run $active_id for PR #$pr_number on head $head_sha"
              fi
              stamp_status "review-gate-event-observed/$pr_number/$active_id" success \
                "$settlement_description" >/dev/null || return 2
              gate_observed_ids="$(printf '%s\n' "$gate_observed_ids" | awk -v id="$active_id" '$0 != id')"
              case $'\n'"$settled_gate_ids"$'\n' in *$'\n'"$active_id"$'\n'*) ;;
                *) settled_gate_ids+="${settled_gate_ids:+$'\n'}$active_id" ;;
              esac
            fi
          fi
          if jq -e --arg workflow "$sensor_id" --arg head "$head_sha" \
              --arg title "Review capture PR #$pr_number" --arg pr_number "$pr_number" '
              (.workflow_id | tostring) == $workflow
              and .head_sha == $head
              and (((.pull_requests // []) | length) == 0
                or any(.pull_requests[]?; .number == ($pr_number | tonumber)))
              and (((.display_title // "") == $title)
                or ((.display_title // "") | startswith($title + " | source-workflow-sha="))
                or any(.pull_requests[]?; .number == ($pr_number | tonumber))
                or ((.pull_requests // [] | length) == 0))
            ' <<< "$known_snapshot" >/dev/null; then
            append_completed_sensor_run "$active_id"
          elif sensor_observation_pending "$active_id"; then
            echo "A durably observed review sensor no longer matches its trusted workflow and exact head; refusing to clear the gate." >&2
            return 2
          fi
          ;;
        *)
          if sensor_observation_pending "$active_id" || gate_observation_pending "$active_id"; then
            echo "A durably observed review-event run returned an unknown status; refusing to clear the gate." >&2
            return 2
          fi
          ;;
      esac
    done <<< "$known_active_ids"
    scan_workflow_events() {
      local workflow_id="$1" title="$2" events="$3" collect_completed="${4:-false}"
      local event_name run_status run_snapshot page_runs completed_runs saturated include_untargeted_active match_head_sha attestation_result
      include_untargeted_active="${5:-false}"
      match_head_sha="${6:-false}"
      case "$initial_census_ids" in
        *" $workflow_id "*) ;;
        *)
        for run_status in requested waiting pending queued in_progress; do
          run_snapshot="$(gh api \
            "repos/$REPO/actions/workflows/$workflow_id/runs?status=$run_status&per_page=100")" || {
              echo "Could not prove review-event run quiescence; refusing to clear the gate." >&2
              return 1
          }
          saturated="$(jq -r '(.total_count // (.workflow_runs | length)) > 100' <<< "$run_snapshot")" || return 1
          if [[ "$saturated" == true ]]; then
            echo "More than 100 active runs match a review-event status; refusing to clear the gate from a truncated snapshot." >&2
            return 1
          fi
          page_runs="$(jq -r --arg title "$title" --arg pr_number "$pr_number" --arg current "$current_run_id" \
            --arg events "$events" --arg include_untargeted "$include_untargeted_active" \
            --arg head "$head_sha" --arg match_head "$match_head_sha" '
            .workflow_runs[]?
            | select(((.pull_requests // []) | length) == 0
              or any(.pull_requests[]?; .number == ($pr_number | tonumber)))
            | select((.display_title // "") == $title
              or ((.display_title // "") | startswith($title + " | source-workflow-sha="))
              or any(.pull_requests[]?; .number == ($pr_number | tonumber))
              or ($match_head == "true" and .head_sha == $head
                and ((.pull_requests // []) | length) == 0)
              or ($include_untargeted == "true"
                and ((.pull_requests // []) | length) == 0
                and (.event as $event | ($events | split(" ") | index($event)) != null)))
            | select((.id | tostring) != $current)
            | [(.id | tostring), (.head_sha // "")]
            | @tsv
          ' <<< "$run_snapshot")" || return 1
          while IFS=$'\t' read -r active_id active_head; do
            [[ "$active_id" =~ ^[1-9][0-9]*$ ]] || continue
            if [[ "$workflow_id" == "$gate_id" ]]; then
              if is_attested_non_connector_issue_comment_gate_run "$active_id"; then
                settle_human_review_request_gate_run "$active_id" || return 1
                continue
              else
                attestation_result=$?
                if [[ "$attestation_result" -gt 1 ]]; then
                  echo "Could not safely classify active user issue-comment run $active_id; refusing to clear the gate." >&2
                  return 1
                fi
              fi
            fi
            if [[ "$include_untargeted_active" == true ]]; then
              if is_attested_foreign_gate_run "$active_id"; then
                continue
              else
                attestation_result=$?
                if [[ "$attestation_result" -gt 1 ]]; then
                  echo "Could not safely attribute unassociated gate run $active_id; refusing to persist an observation or clear the gate." >&2
                  return 1
                fi
              fi
            fi
            case "$active_runs"$'\n' in *$'\n'"$active_id"$'\n'*) continue ;; esac
            if [[ "$workflow_id" == "$sensor_id" && "$active_head" == "$head_sha" ]]; then
              persist_sensor_observation "$active_id" || return 1
            fi
            if [[ "$workflow_id" == "$gate_id" ]]; then
              persist_gate_observation "$active_id" || return 1
            fi
            active_runs+="${active_runs:+$'\n'}$active_id"
            next_known_ids+="${next_known_ids:+$'\n'}$active_id"
          done <<< "$page_runs"
        done
        initial_census_ids+="$workflow_id "
        if [[ "$collect_completed" == true ]]; then
          run_snapshot="$(gh api \
            "repos/$REPO/actions/workflows/$workflow_id/runs?status=completed&head_sha=$head_sha&per_page=100")" || {
              echo "Could not prove completed review-event capture state; refusing to clear the gate." >&2
              return 1
          }
          saturated="$(jq -r '(.total_count // (.workflow_runs | length)) > 100' <<< "$run_snapshot")" || return 1
          if [[ "$saturated" == true ]]; then
            echo "More than 100 completed sensor runs match this head; refusing to clear the gate from a truncated snapshot." >&2
            return 1
          fi
          completed_runs="$(jq -r --arg title "$title" --arg pr_number "$pr_number" \
            --arg head "$head_sha" --arg pr_opened_at "$pr_opened_at" '
            .workflow_runs[]?
            | select(((.pull_requests // []) | length) == 0
              or any(.pull_requests[]?; .number == ($pr_number | tonumber)))
            | select((.display_title // "") == $title
              or ((.display_title // "") | startswith($title + " | source-workflow-sha="))
              or any(.pull_requests[]?; .number == ($pr_number | tonumber))
              or (.head_sha == $head and .created_at >= $pr_opened_at
                and ((.pull_requests // []) | length) == 0))
            | .id
          ' <<< "$run_snapshot")" || return 1
          while IFS= read -r completed_sensor_id; do
            append_completed_sensor_run "$completed_sensor_id"
          done <<< "$completed_runs"
        fi
        ;;
      esac
      for event_name in $events; do
        run_snapshot="$(gh api \
          "repos/$REPO/actions/workflows/$workflow_id/runs?event=$event_name&created=%3E%3D$current_run_started_at&per_page=100")" || {
            echo "Could not prove review-event run quiescence; refusing to clear the gate." >&2
            return 1
        }
        saturated="$(jq -r '(.total_count // (.workflow_runs | length)) > 100' <<< "$run_snapshot")" || return 1
        if [[ "$saturated" == true ]]; then
          echo "More than 100 recent runs match a review-event workflow; refusing to clear the gate from a truncated snapshot." >&2
          return 1
        fi
        page_runs="$(jq -r --arg title "$title" --arg pr_number "$pr_number" --arg current "$current_run_id" \
          --arg events "$events" --arg include_untargeted "$include_untargeted_active" \
          --arg head "$head_sha" --arg match_head "$match_head_sha" '
          .workflow_runs[]?
          | select(((.pull_requests // []) | length) == 0
            or any(.pull_requests[]?; .number == ($pr_number | tonumber)))
          | select((.display_title // "") == $title
            or ((.display_title // "") | startswith($title + " | source-workflow-sha="))
            or any(.pull_requests[]?; .number == ($pr_number | tonumber))
            or ($match_head == "true" and .head_sha == $head
              and ((.pull_requests // []) | length) == 0)
            or ($include_untargeted == "true"
              and ((.pull_requests // []) | length) == 0
              and (.event as $event | ($events | split(" ") | index($event)) != null)))
          | select((.id | tostring) != $current)
          | select(.status as $status
              | ["requested", "waiting", "pending", "queued", "in_progress"] | index($status) != null)
          | [(.id | tostring), (.head_sha // "")]
          | @tsv
        ' <<< "$run_snapshot")" || return 1
        while IFS=$'\t' read -r active_id active_head; do
          [[ "$active_id" =~ ^[1-9][0-9]*$ ]] || continue
          if [[ "$workflow_id" == "$gate_id" ]]; then
            if is_attested_non_connector_issue_comment_gate_run "$active_id"; then
              settle_human_review_request_gate_run "$active_id" || return 1
              continue
            else
              attestation_result=$?
              if [[ "$attestation_result" -gt 1 ]]; then
                echo "Could not safely classify active user issue-comment run $active_id; refusing to clear the gate." >&2
                return 1
              fi
            fi
          fi
          if [[ "$include_untargeted_active" == true ]]; then
            if is_attested_foreign_gate_run "$active_id"; then
              continue
            else
              attestation_result=$?
              if [[ "$attestation_result" -gt 1 ]]; then
                echo "Could not safely attribute unassociated gate run $active_id; refusing to persist an observation or clear the gate." >&2
                return 1
              fi
            fi
          fi
          case "$active_runs"$'\n' in *$'\n'"$active_id"$'\n'*) continue ;; esac
          if [[ "$workflow_id" == "$sensor_id" && "$active_head" == "$head_sha" ]]; then
            persist_sensor_observation "$active_id" || return 1
          fi
          if [[ "$workflow_id" == "$gate_id" ]]; then
            persist_gate_observation "$active_id" || return 1
          fi
          active_runs+="${active_runs:+$'\n'}$active_id"
          next_known_ids+="${next_known_ids:+$'\n'}$active_id"
        done <<< "$page_runs"
        if [[ "$workflow_id" == "$gate_id" ]]; then
          completed_runs="$(jq -r --arg pr "$pr_number" --arg current "$current_run_id" '
            .workflow_runs[]?
            | select(.status == "completed" and .conclusion != "success" and .conclusion != "skipped")
            | select(((.pull_requests // []) | length) == 0 or any(.pull_requests[]?; .number == ($pr | tonumber)))
            | select((.id | tostring) != $current) | .id
          ' <<< "$run_snapshot")" || return 1
          while IFS= read -r active_id; do
            [[ -n "$active_id" ]] || continue
            track_completed_gate_run "$active_id" || return 1
          done <<< "$completed_runs"
        fi
        if [[ "$collect_completed" == true ]]; then
          completed_runs="$(jq -r --arg title "$title" --arg head "$head_sha" --arg pr_number "$pr_number" \
            --arg match_head "$match_head_sha" --arg pr_opened_at "$pr_opened_at" '
            .workflow_runs[]?
            | select(((.pull_requests // []) | length) == 0
              or any(.pull_requests[]?; .number == ($pr_number | tonumber)))
            | select((.display_title // "") == $title
              or ((.display_title // "") | startswith($title + " | source-workflow-sha="))
              or any(.pull_requests[]?; .number == ($pr_number | tonumber))
            or ($match_head == "true" and .head_sha == $head
              and .created_at >= $pr_opened_at
              and ((.pull_requests // []) | length) == 0))
            | select(.status == "completed" and .head_sha == $head)
            | .id
          ' <<< "$run_snapshot")" || return 1
          while IFS= read -r completed_sensor_id; do
            append_completed_sensor_run "$completed_sensor_id"
          done <<< "$completed_runs"
        fi
      done
    }
    scan_workflow_events "$gate_id" "Review gate PR #$pr_number" "issue_comment pull_request_target" false true || return 2
    scan_workflow_events "$sensor_id" "Review capture PR #$pr_number" "pull_request_review pull_request_review_comment" true false true || return 2
    scan_workflow_events "$receiver_id" "Review capture PR #$pr_number" "workflow_run" || return 2
    REVIEW_GATE_QUIESCENCE_CENSUS_IDS="$initial_census_ids"
    REVIEW_GATE_QUIESCENCE_ACTIVE_IDS="$next_known_ids"
    known_active_ids="$next_known_ids"
    # A completed sensor can disappear from the active-run lists before its
    # workflow_run receiver starts. Its durable acknowledgement is the capture
    # status for this run and PR on the exact source head; absence is pending.
    if [[ -n "$completed_sensor_runs" ]]; then
      # Refresh after the Actions census: the trusted receiver can publish its
      # acknowledgement while that census is in flight.
      rm -f "$REVIEW_READ_CACHE/"*.json
      source_statuses="$(gh_uncached api "repos/$REPO/commits/$head_sha/statuses?per_page=100" --paginate --slurp)" || {
        echo "Could not read the review-event capture acknowledgement; refusing to clear the gate." >&2
        return 2
      }
      while IFS= read -r active_id; do
        [[ "$active_id" =~ ^[1-9][0-9]*$ ]] || continue
        capture_status="$(jq -c --arg scoped "review-event-capture/$pr_number/$active_id" \
            --arg legacy "review-event-capture/$active_id" '
          [.[][] | select(.context == $scoped)] as $scoped_statuses
          | if ($scoped_statuses | length) > 0 then $scoped_statuses
            else [.[][] | select(.context == $legacy)] end
          | if length == 0 then null else max_by([(.created_at // .updated_at // ""), (.id // 0)]) end' \
          <<< "$source_statuses")" || return 2
        if [[ "$(jq -r '.state // empty' <<< "$capture_status")" == success ]] \
            && capture_receipt_is_authenticated "$capture_status"; then
          if sensor_observation_pending "$active_id"; then
            stamp_status "review-event-observed/$pr_number/$active_id" success \
              "Capture receipt received for sensor run $active_id for PR #$pr_number on head $head_sha" >/dev/null || return 2
            sensor_observed_ids="$(printf '%s\n' "$sensor_observed_ids" | awk -v id="$active_id" '$0 != id')"
          fi
        else
          unacknowledged_capture=true
        fi
      done <<< "$completed_sensor_runs"
    fi
    if [[ "$unacknowledged_capture" == true ]]; then
      stamp_review_gate pending "A completed review event is awaiting authenticated capture"
      return 1
    fi
    # Newly discovered terminal runs need the same identity/capture validation
    # as tracked active runs, but cannot be elected as a future reconciler.
    [[ "$completed_gate_discovered" == true ]] && continue
    newer=false
    while IFS= read -r active_id; do
      [[ -z "$active_id" ]] && continue
      [[ "$active_id" =~ ^[1-9][0-9]*$ ]] || return 2
      if (( active_id > current_run_id )); then
        newer=true
        break
      fi
    done <<< "$active_runs"
    if [[ "$fail_fast" == true && -n "$active_runs" ]]; then
      stamp_review_gate pending "Review event became active during success publication"
      return 1
    fi
    if [[ "$newer" == true ]]; then
      stamp_review_gate pending "A newer review event will reconcile after its history is recorded"
      return 1
    fi
    if [[ -z "$active_runs" ]]; then
      return 0
    fi
    if (( attempt >= 20 )); then
      stamp_review_gate pending "Review-event history has not quiesced; gate remains pending"
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
}
quiescence_result=0
wait_for_active_review_events || quiescence_result=$?
if (( quiescence_result == 2 )); then
  stamp_review_gate pending "Could not verify review-event quiescence" || true
  exit 1
elif (( quiescence_result == 1 )); then
  gate_pending
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
if [[ "$historical_event_head" != true ]] && ! head_prefix_resolves; then
  stamp_review_gate pending "Could not uniquely resolve the abbreviated head on $head_prefix"
  echo "The abbreviated head marker did not resolve uniquely to the exact pull request head."
  gate_pending
fi
refresh_review_timeline_watermark
gate_snapshot="$(read_gate_snapshot)"
reconcile_clean_regular_history "$gate_snapshot"
reconcile_clean_security_history
if [[ "$history_reconciled" == true ]]; then
  gate_snapshot="$(read_gate_snapshot)"
fi
require_clean_regular_snapshot "$gate_snapshot"
if [[ "${RECORD_EVENT_ONLY:-false}" == true ]]; then
  event_history_phase_done=true
  echo "Review event history recorded; candidate proof still owns success publication."
  gate_pending
fi

# Re-read every merge-relevant input immediately before success. This
# catches a new result, finding, comment, head, or base change that
# arrived while the first snapshot was being evaluated.
final_pr_snapshot="$(read_pr_snapshot)"
IFS=$'\t' read -r final_head_sha final_pr_opened_at final_base_sha final_base_ref final_is_draft final_pr_node_id final_auto_merge_enabled final_pr_state final_pr_author_login final_head_repo final_created_at <<< "$final_pr_snapshot"
final_pr_opened_at="$(normalize_timestamp "$final_pr_opened_at")"
final_created_at="$(normalize_timestamp "$final_created_at")"
if [[ "$final_pr_state" != "OPEN" ]]; then
  echo "The PR was closed during evaluation; it was not marked successful."
  gate_pending
fi
if [[ "$final_head_sha" != "$head_sha" || "$final_pr_opened_at" != "$pr_opened_at" || "$final_pr_author_login" != "$pr_author_login" || "$final_head_repo" != "$head_repo" || "$final_created_at" != "$pr_created_at" ]]; then
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
IFS=$'\t' read -r last_head_sha last_pr_opened_at last_base_sha last_base_ref last_is_draft last_pr_node_id last_auto_merge_enabled last_pr_state last_pr_author_login last_head_repo last_created_at <<< "$last_pr_snapshot"
last_pr_opened_at="$(normalize_timestamp "$last_pr_opened_at")"
last_created_at="$(normalize_timestamp "$last_created_at")"
if [[ "$last_head_sha" != "$head_sha" || "$last_pr_opened_at" != "$pr_opened_at" || "$last_base_sha" != "$base_sha" || "$last_base_ref" != "$DEFAULT_BRANCH" || "$last_is_draft" != "false" || "$last_auto_merge_enabled" != "false" || "$last_pr_state" != "OPEN" || "$last_pr_author_login" != "$pr_author_login" || "$last_head_repo" != "$head_repo" || "$last_created_at" != "$pr_created_at" ]]; then
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
# Recheck immediately before publishing success; a queued event can appear
# after the initial quiescence scan and while the final snapshots are read.
quiescence_result=0
wait_for_active_review_events true true || quiescence_result=$?
if (( quiescence_result == 2 )); then
  stamp_review_gate pending "Could not verify review-event quiescence before success"
  exit 1
elif (( quiescence_result == 1 )); then
  gate_pending
fi
stamp_review_gate success "Clean regular review for $head_prefix; evidence $evidence_marker"
trap 'stamp_review_gate pending "Review state could not be revalidated after publication"; exit 1' ERR
refresh_review_timeline_watermark
post_success_snapshot="$(read_gate_snapshot)"
require_clean_regular_snapshot "$post_success_snapshot"
post_snapshot="$(read_pr_snapshot)"
post_node="$(cut -f6 <<< "$post_snapshot")"
post_auto="$(cut -f7 <<< "$post_snapshot")"
if [[ "$post_auto" == true ]]; then
  disable_auto_merge "$post_node"
  stamp_review_gate pending "Automatic merge was enabled during publication"
  gate_pending
fi
if [[ "$post_success_snapshot" != "$final_gate_snapshot" || "$post_snapshot" != "$last_pr_snapshot" || "$(shared_open_head_owner)" != "$pr_number" ]]; then
  stamp_review_gate pending "Review state changed while publishing success"
  gate_pending
fi
# And once more after publication/readback. If an event appeared during that
# window, revoke this success so no stale green status remains visible.
quiescence_result=0
wait_for_active_review_events true true || quiescence_result=$?
if (( quiescence_result == 2 )); then
  stamp_review_gate pending "Could not verify review-event quiescence after success"
  exit 1
elif (( quiescence_result == 1 )); then
  stamp_review_gate pending "Review event became active during success publication"
  gate_pending
fi
echo "The exact pull request head has an affirmative clean regular review."
echo "Security findings are independently blocking and never qualify as regular-review evidence."
echo "This workflow never enables or performs a merge."
