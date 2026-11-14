# AGENTS

## Review contract

Follow the [review and manual-merge checklist](docs/maintenance-reviews.md). Every candidate requires the configured `prospectore-review` GitHub App's required `review` status on the current head, meaningful required CI, disposition of findings, resolution of review conversations, and the designated owner's manual merge. The shared [review policy](https://github.com/ProspectOre/dev-workspace/blob/main/scripts/review/REVIEW.md) defines the review contract. Do not request standalone `@codex review` in place of the configured gate. Preserve historical review gaps and keep runtime, physical, release and human approval boundaries separate.

## Workspace and writing

- Inherit the shared [AGENTS.md](https://github.com/ProspectOre/dev-workspace/blob/main/AGENTS.md) (`/Users/alec/Dev/AGENTS.md` when present; native `xcode-tools` preference included); this file adds repository facts only.
- Before substantive work, at material milestones and at handoff, follow the canonical [Linear work-tracking workflow](https://github.com/ProspectOre/wiki/blob/main/workflows/linear-work-tracking.md). When local ancestor or wiki files are absent, read the linked canonical sources through existing authorized session connectors as that workflow requires; report unavailable routes separately.
- Write commits, PR text, reviews, comments and docs as plain, specific, human-quality prose: no AI slop such as filler, hype, restated summaries or decorative emoji. Never add AI/tool attribution or co-author trailers. Commit as the account owner; name branches by purpose.

## OEM app and protocol research

Learn from the installed Matic OEM app on the Samsung tablet or an equivalent
authorized device before declaring a capability or protocol field unavailable.
Decompilation and reverse engineering are authorized research techniques. Follow
the [OEM research workflow](https://github.com/ProspectOre/wiki/blob/main/workflows/oem-protocol-research.md)
(`/Users/alec/Dev/wiki/workflows/oem-protocol-research.md` locally): verify installed
app and artifact identity, trace wire fields through the OEM decoder and UI, and
distinguish parser omissions from absent protocol evidence. Keep private captures
and vendor binaries out of the public tree; device changes and physical acceptance
remain separate from read-only research and synthetic tests.

## Release candidate cleanup

After publishing a new RC, keep only its RC GitHub release and remote/local tag.
Remove superseded RC releases/tags, retaining reviewed commit IDs in qualification
receipts and preserving rollback copies. When publishing stable, retire its RC
release/tag; preserve stable releases and tags.

## CI

- Follow the [delivery contract](https://github.com/ProspectOre/wiki/blob/main/workflows/delivery-contract.md); `.github/delivery-contract.json` allow-lists every workflow and `.github/scripts/delivery-contract.py` runs first in Test.
- Test (`ci` job), Browser UI and Validate run on free hosted `ubuntu-latest` for every PR and push to main; `windows-assistive-qualification.yml` is manual only.
- `release.yml` is manual and publishes the branch it is run on. It needs `scripts/release.py`, which only `release/0.6` has. `nightly.yml` tests `release/0.6` each day until that branch merges.
