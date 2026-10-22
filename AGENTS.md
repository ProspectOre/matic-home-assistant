# AGENTS

## Review contract

Follow the [review and manual-merge checklist](docs/maintenance-reviews.md). Every candidate requires an authentic complete Codex review bound to its exact head and intended base, meaningful required CI, finding dispositions and a designated-owner manual merge. The request coordinator and bespoke custom status gate are retired by owner approval. Request regular `@codex review` directly on each opened or pushed PR head; check existing requests to avoid duplicates. Preserve historical review gaps and keep runtime, physical, release and human approval boundaries separate.

## Workspace and attribution

- Inherit `/Users/alec/Dev/AGENTS.md` when present (native `xcode-tools` preference included); this file adds repository facts only.
- No AI attribution: no AI co-author or `Assisted-by` trailers, agent session links, "Generated with/by" footers or AI sign-offs in commits, PR titles or bodies, reviews or comments; commit as the account owner; name branches by purpose. `.github/scripts/attribution.py` enforces it in Test.

## Release candidate cleanup

After publishing a new RC, keep only its RC GitHub release and remote/local tag.
Remove superseded RC releases/tags, retaining reviewed commit IDs in qualification
receipts and preserving rollback copies. When publishing stable, retire its RC
release/tag; preserve stable releases and tags.

## CI

- Follow the [delivery contract](https://github.com/ProspectOre/wiki/blob/main/workflows/delivery-contract.md); `.github/delivery-contract.json` allow-lists every workflow and `.github/scripts/delivery-contract.py` runs first in Test.
- Test (`ci` job), Browser UI and Validate run on free hosted `ubuntu-latest` for every PR and push to main; `windows-assistive-qualification.yml` is manual only.
