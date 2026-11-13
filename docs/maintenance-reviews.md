# Review and manual merge

The shared `prospectore-review` app is Matic's required code-review gate. It
reviews the complete diff against the intended base and publishes a result on
the exact PR head. The canonical
[workspace checklist](https://github.com/ProspectOre/wiki/blob/main/workflows/pr-gates.md)
owns the shared process. Do not require a separate native Codex review request.

## Candidate evidence

Freeze the full candidate head and intended base OIDs. Require a complete
`prospectore-review` result for that comparison; a final-commit-only review is
insufficient. Resolve abbreviated commit IDs uniquely and verify comparison
provenance. A later push invalidates the earlier result.

Disposition every actionable finding with evidence before resolving its thread.
A resolved thread is not itself a clean review. The shared gate records one result
per exact head; retries must not duplicate findings or reuse stale results.

Run Test, Browser and Validate through the configured public GitHub-hosted route.
Require the `review` status from `prospectore-review` alongside required CI and
native branch protections. Never enable automatic merge or force pushes.

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
