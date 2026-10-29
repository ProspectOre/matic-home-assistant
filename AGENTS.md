# AGENTS

## Review contract

Follow the [review and manual-merge checklist](docs/maintenance-reviews.md). Every candidate requires an authentic complete Codex review bound to its exact head and intended base, meaningful required CI, finding dispositions and a designated-owner manual merge. The request coordinator and bespoke custom status gate are retired by owner approval. Request regular `@codex review` directly on each opened or pushed PR head; check existing requests to avoid duplicates. Preserve historical review gaps and keep runtime, physical, release and human approval boundaries separate.

## Workspace and writing

- Inherit the shared [AGENTS.md](https://github.com/ProspectOre/dev-workspace/blob/main/AGENTS.md) (`/Users/alec/Dev/AGENTS.md` when present; native `xcode-tools` preference included); this file adds repository facts only.
- Before substantive work, at material milestones and at handoff, follow the canonical [Linear work-tracking workflow](https://github.com/ProspectOre/wiki/blob/main/workflows/linear-work-tracking.md). When local ancestor or wiki files are absent, read the linked canonical sources through existing authorized session connectors as that workflow requires; report unavailable routes separately.
- Write commits, PR text, reviews, comments and docs as plain, specific, human-quality prose: no AI slop such as filler, hype, restated summaries or decorative emoji. Attribution trailers and tool footers are tolerated here, overriding the shared rule, and nothing checks for them. Commit as the account owner; name branches by purpose.

## Release candidate cleanup

After publishing a new RC, keep only its RC GitHub release and remote/local tag.
Remove superseded RC releases/tags, retaining reviewed commit IDs in qualification
receipts and preserving rollback copies. When publishing stable, retire its RC
release/tag; preserve stable releases and tags.

## CI

- Follow the [delivery contract](https://github.com/ProspectOre/wiki/blob/main/workflows/delivery-contract.md); `.github/delivery-contract.json` allow-lists every workflow and `.github/scripts/delivery-contract.py` runs first in Test.
- Test (`ci` job), Browser UI and Validate run on free hosted `ubuntu-latest` for every PR and push to main; `windows-assistive-qualification.yml` is manual only.
