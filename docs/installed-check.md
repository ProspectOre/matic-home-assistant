# Installed check

`scripts/installed_check.py` installs a release candidate on a real Home Assistant host and writes one
receipt per run. It replaces most of the hand-run [0.5 walkthrough](owner-walkthrough-0.5.md) checks that
needed a live host. The [simulated robot tests](e2e-harness.md) cover behaviour; this check covers what
was actually installed and loaded.

## What it does

Steps run in order and the first failure stops the run. Every step is recorded as passed, failed or
skipped.

| Step | What it checks |
| --- | --- |
| `backup` | Takes a backup with the host's automatic settings and checks every agent stored it encrypted. Fails if no new backup appears. |
| `install` | Downloads the tag through HACS, restarts Home Assistant and waits until it is running again. |
| `served_assets` | The loaded manifest version matches the tag. The icon and Matic Map URLs are content-addressed, so a 200 with the tag's exact bytes shows the running process loaded these files. |
| `installed_files` | With `--ssh`, hashes every installed file on the host and compares the set with the tag (missing, extra and changed files). |
| `entities` | Exactly one Matic vacuum, and no enabled Matic entity is missing or unavailable. |
| `actions` | The registered `matic_robot` actions are exactly the ones in `services.yaml` at the tag. |
| `assistant_tools` | With `--aspenos`, calls each home-mcp `matic_get_*` tool through its stdio bridge. |
| `physical` | With `--physical --room NAME`, vacuums one room on Quick, waits for the dock, then makes one sink trip. |

Without `--skip-install`, `backup` and `install` always run. With it, the check reads back whatever is
installed now.

## Running it

Run it from the repository's virtual environment on a machine that can reach the host, with the tag
fetched locally (`git fetch origin tag v0.6.0b1`):

```sh
HA_TOKEN=... .venv/bin/python scripts/installed_check.py v0.6.0b1 \
  --url http://homeassistant.local:8123 \
  --receipts ~/Dev/sources/matic/qualification \
  --ssh homeassistant \
  --aspenos "node /path/to/home-mcp/src/bridge.mjs"
```

Add `--physical --room Kitchen` for the physical steps.

## Boundaries

- Installing a candidate and sending robot commands both need the owner's go for that candidate. Only one
  session drives the robot at a time.
- The physical step checks the robot is docked, then waits for the owner to type the room name. Any other
  answer stops the run before anything is sent. The sink trip waits for the owner to refill the robot and
  press Enter once it is docked again.
- The script never restores a backup. A rollback is a separate step (PRO-75).
- Receipts include entity counts and backup IDs, and the token is never written. Keep receipts in the
  private sources tree, not in this repository. Each receipt names its tag, commit and Home Assistant
  version.
