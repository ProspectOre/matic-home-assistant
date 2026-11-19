#!/usr/bin/env bash
# Report the last code run of a required check for this PR head.
#
# Usage: last-code-run.sh CHECK_NAME   (in a pull_request edit run)
# A title or body edit changes no code, so its run passes or fails with the
# newest earlier run of CHECK_NAME on the same head, once every earlier run of
# this workflow on the head has ended. A run waits only on older runs, so no two
# wait on each other; cancelled and skipped runs are not results. Needs GH_TOKEN
# with checks:read and actions:read, and HEAD_SHA.
set -euo pipefail
check=$1
read -r own workflow < <(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
  --jq '"\(.check_suite_id) \(.workflow_id)"')
for _ in $(seq 110); do
  # A re-run or a job still waiting on its needs has no new check run yet, so
  # nothing counts until every earlier run of this workflow on the head ends.
  unfinished=$(gh api --paginate --method GET \
    "repos/$GITHUB_REPOSITORY/actions/workflows/$workflow/runs" \
    -f head_sha="$HEAD_SHA" -f per_page=100 --jq "
    .workflow_runs[] | select(.id < $GITHUB_RUN_ID and .status != \"completed\")
    | .id")
  if [ -n "$unfinished" ]; then
    sleep 30
    continue
  fi
  prior=$(gh api --paginate --method GET \
    "repos/$GITHUB_REPOSITORY/commits/$HEAD_SHA/check-runs" \
    -f check_name="$check" -f filter=all -f per_page=100 --jq "
    .check_runs[] | select(.app.slug == \"github-actions\" and .check_suite.id < $own
      and .conclusion != \"cancelled\" and .conclusion != \"skipped\")
    | \"\(.id) \(.conclusion) \(.html_url)\"" | sort -n | tail -n 1)
  if [ -z "$prior" ]; then
    echo "No code run of '$check' for this head; push or reopen the PR to run CI."
    exit 1
  fi
  read -r _ conclusion url <<<"$prior"
  echo "Last code run of '$check': $conclusion ($url)"
  [ "$conclusion" = success ]
  exit
done
echo "The last code run of '$check' did not finish in time."
exit 1
