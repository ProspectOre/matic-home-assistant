# Review and manual merge

[Contributing](../CONTRIBUTING.md#changes-and-pull-requests) · [Testing](testing.md) ·
[All guides](README.md)

Every change merges by pull request, after a complete review and the required
checks, and the designated owner merges it by hand. Automatic merge and force
pushes stay off.

## Review

- Request `@codex review` on each opened or pushed pull request head. Check
  first that the same head and base don't already have a request.
- The review must cover the whole diff between that head and its intended
  base. A review of only the last commit doesn't count.
- Answer every actionable finding with a fix or a reason before resolving its
  thread. A resolved thread is not a clean review.

## Merge

- Test, Browser UI and Validate must pass on the head being merged.
- Just before merging, the owner checks the head, base, review, findings,
  required checks and branch protections again. If any of them changed, or
  could not be read, the merge waits.
- The pull request records the head and base commits, the review, the findings,
  the CI runs and the merge result.

## Branches and releases

`main` holds the latest stable release and its hotfixes, which land by pull
request. The next release and its betas live on `release/X.Y`, which merges
into `main` for the stable release and is then deleted.
[Contributing](../CONTRIBUTING.md#releasing) has the release steps.

Passing review and CI says the source is ready. Installing a candidate,
checking it on a real Home Assistant host, trying it on a robot and approving
a stable release are separate steps ([testing](testing.md#what-runs-by-hand)).

Earlier gaps in review records stay recorded as they are, in
[#216](https://github.com/ProspectOre/matic-home-assistant/issues/216) and
[#219](https://github.com/ProspectOre/matic-home-assistant/issues/219). Don't
backfill them or present a new review as covering them.
