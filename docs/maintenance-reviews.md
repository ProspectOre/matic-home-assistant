# Maintenance reviews

Matic supports review against `main` and the exact `release/0.4` maintenance
branch. The latter keeps the installed 0.4 integration separate from 0.5 work.
Both routes require protected, manual merges, resolved conversations, current
CI, and a qualifying review of the exact candidate commit. Maintenance heads
must include the current release base. A retargeted PR or rewritten maintenance
base requires a new PR with a fresh comparison; reopening is insufficient.

## Workflow installation

Install the generated evaluator, helper, manifest and managed workflows on
`main`. Review-event routers dispatch the evaluator using the repository's
default branch. Supporting a maintenance **comparison** does not authorize
execution of a generated evaluator workflow from the maintenance branch.
Do not copy the generated gate workflow onto `release/0.4`: its trusted-source
guard requires the default-branch workflow ref. Such an installation needs a
separately reviewed canonical routing change first.

The repo-owned `review-base-advance.yml` is different: a push executes the
workflow from the pushed branch. Its maintenance invalidation change must land
on both `main` and `release/0.4`. Deploy the trusted main policy first, then
carry the invalidator and its regression test through the maintenance PR.
Read back both installed files before claiming release pushes are covered.
The invalidator selects PRs targeting the branch that advanced and dispatches
their evaluator on `main`.

Maintain administrator enforcement and conversation resolution on both branches.
Maintenance additionally requires strict checks for `hacs`, `hassfest`,
`test (3.14)`, `browser`, and `review-gate`. Keep automatic merging and force
pushes disabled. Existing failed or cancelled review events still need their
authenticated capture evidence; a clean review does not erase that history.

## Local review evidence

The [canonical native review contract](https://github.com/ProspectOre/dev-workspace/blob/8e6f497acf97990760540cb10f7b3d8d49b712d4/scripts/review-gate/NATIVE.md)
requires a fresh live review for each local qualification invocation, verified
installed source hashes, and native-aware trusted publishers. Saved receipt or
thread JSON is archival evidence and cannot authorize a later invocation.
An advisory capture alone does not qualify the installed gate.

A scheduled Actions audit has no fresh local review result. It can therefore
return a native-only qualification to pending even when the source is unchanged.
This is the intended fresh-review boundary, not permission to replay an archive
or preserve success without current evidence. Recheck the actual required gate,
head, base, CI and findings immediately before a manual merge.

Generated policy remains owned by the canonical repository. Change its source,
review and merge that change, then render the consumer from the frozen revision.
