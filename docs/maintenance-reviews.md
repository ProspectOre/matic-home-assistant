# Review and manual merge

The owner-approved process replaces Matic's bespoke status gate with authentic
complete review, required CI and a designated-owner manual merge. The canonical
[workspace checklist](https://github.com/ProspectOre/wiki/blob/main/workflows/pr-gates.md)
owns the shared process.

## Candidate evidence

Freeze the full candidate head and intended base OIDs. Obtain an authentic Codex
review of their complete diff; a final-commit-only review is insufficient. Resolve
an abbreviated footer uniquely to its full commit and verify comparison provenance.
Native review requires unchanged source hashes before and after the live capture;
archival receipts cannot authorize a later invocation.

Disposition every actionable finding with evidence before resolving its thread.
A resolved thread is not itself a clean review. Reuse a pending or delivered review
request for an unchanged comparison instead of posting duplicates.

Run Test, Browser and Validate through the configured public GitHub-hosted route.
Retain all required contexts and native branch protections except the explicitly
removed custom `review-gate` context. Never enable automatic merge or force pushes.
Before retiring an automatic-merge sweep, verify repository auto-merge is disabled
and every open PR has no queued auto-merge request; disarm any existing requests
and verify again before deleting the sweep. Record the complete inventory on the PR.

Immediately before manual merge, the designated owner rechecks head, base, review,
findings, required checks and native protections. Changed inputs invalidate the
comparison; failed or incomplete reads cannot authorize merge. Record the full
head/base, review provenance, findings, CI links and actual merge result on the PR.

## Maintenance and release

`main` is the 0.5 line; `release/0.4` includes the merged 0.4.8 firmware features.
The owner-authorized `release/0.4.7-hotfix` target starts at stable `v0.4.7`
and carries only the diagnostic/hotfix scope for #218, with strict Test, Browser,
HACS and Hassfest checks and administrator/conversation protections. Its builds
exclude the separate maintenance firmware features. A new protected target
requires explicit authority and verified protections.

The gate migration does not close historical evidence gaps: the 19 original
review-event runs retained in the #216 investigation lack required receipt proof,
and the #219 gap remains recorded. Do not backfill acknowledgements, invent green
statuses, or claim a new clean review supplies missing historical coverage.

The full-visibility outage remains explicit: if current-head and association reads
fail while a comment names an older commit, current-head revocation is unproven.
Fresh successful reads at the owner merge decision are required.

RC installation, configuration preservation, runtime fingerprints, physical
acceptance and stable-release approval remain separate from source qualification.
