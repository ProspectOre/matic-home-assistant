# Review and manual merge

The required review is the configured `prospectore-review` GitHub App's
`review` status for the current pull request head. Passing CI, that review
status, resolved review conversations and the designated-owner manual merge
are separate requirements. The canonical
[review policy](https://github.com/ProspectOre/dev-workspace/blob/main/scripts/review/REVIEW.md)
defines its exact-head behavior; the shared
[workspace checklist](https://github.com/ProspectOre/wiki/blob/main/workflows/pr-gates.md)
owns the general process.

The configured reviewer processes PR changes automatically. Use its documented
maintainer `/review` command when the shared policy makes a retry eligible.
Standalone provider reviews are supplemental and do not satisfy the
required app status.

## Candidate evidence

Freeze the full candidate head and intended base OIDs. Require the configured
review status to report a clean verdict for that candidate; a final-commit-only
review is insufficient. Resolve an abbreviated footer uniquely to its full
commit and verify comparison provenance. Native review requires unchanged source
hashes before and after the live capture; archival receipts cannot authorize a
later invocation.

Disposition every actionable finding with evidence before resolving its thread.
A resolved thread is not itself a clean review. Reuse a pending or delivered review
request for an unchanged comparison instead of posting duplicates.

Run Test, Browser and Validate through the configured public GitHub-hosted route.
Retain all required contexts and native branch protections, including the
configured `review` status. Never enable automatic merge or force pushes.

Immediately before manual merge, the designated owner rechecks head, base, review,
findings, required checks and native protections. Changed inputs invalidate the
comparison; failed or incomplete reads cannot authorize merge. Record the full
head/base, review provenance, findings, CI links and actual merge result on the PR.

## Maintenance and release

`main` holds production code: the latest stable release and its hotfixes, which
land by PR. The next release and its betas live on `release/X.Y` (now
`release/0.6`), which merges into `main` for the stable release and is then
deleted. `release/0.4` includes the merged 0.4.8 firmware features.
A build from that maintenance branch must not be described as a narrow 0.4.7
diagnostic. Resolve release composition before publishing a candidate. A new
protected release target requires explicit authority and verified protections.

The gate migration does not close historical evidence gaps: the 19 original
review-event runs retained in the #216 investigation lack required receipt proof,
and the #219 gap remains recorded. Do not backfill acknowledgements, invent green
statuses, or claim a new clean review supplies missing historical coverage.

The full-visibility outage remains explicit: if current-head and association reads
fail while a comment names an older commit, current-head revocation is unproven.
Fresh successful reads at the owner merge decision are required.

RC installation, configuration preservation, runtime fingerprints, physical
acceptance and stable-release approval remain separate from source qualification.
