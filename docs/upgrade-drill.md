# Upgrade and rollback drill

`scripts/upgrade_drill.py` upgrades from an older release to this checkout and rolls back, all against the
[simulated robot](e2e-harness.md). The older release runs its own integration code from a temporary Git
worktree, with this checkout's simulator copied in. Every phase runs in its own process on real store
files, so the stores carry over between phases and code versions the same way they do on a host.

```sh
git fetch origin tag v0.5.0
.venv/bin/python scripts/upgrade_drill.py v0.5.0
```

| Phase | Code | What it does |
| --- | --- | --- |
| seed | older | Saves "Evening" (Kitchen with mop every 3rd clean, then Study) and finishes one run. It then starts a second run and stops Home Assistant mid-clean. The stores are copied as the pre-upgrade backup. |
| upgrade | this checkout | Loads the older stores, settles the interrupted run, then runs the plan to a verified finish. |
| downgrade | older | Runs the plan on the stores the newer code wrote, with no restore. |
| restore | older | Runs the plan on the pre-upgrade backup. |

The drill fails if any phase fails, if the saved plan (rooms, settings and schedule) differs from the seed,
or if a room has fewer completed runs than it had at the seed.

## 0.5.0 to 0.6 (October 31, 2026)

All four phases passed against release/0.6 at `d357cdc`.

- The plan store stays at version 1.12 in both releases, so the upgrade runs no store migration. 0.6 only
  adds keys, such as `run_history` and the per-run `skipped_room_ids` and `held_rooms`.
- 0.6 settles the run that 0.5.0 left cleaning as unverified (`restart_native_mission_changed_or_ended`)
  and then runs the plan normally.
- 0.5.0 runs normally on stores 0.6 wrote. It keeps 0.6's `run_history` but does not add to it, so runs made
  after an in-place downgrade are missing from 0.6's history if you upgrade again. Restoring the backup
  avoids this.
- Restoring the pre-upgrade backup brings back the 0.5.0 state exactly, including the interrupted run, and
  0.5.0 settles it the same way.

## Not covered

- Custom areas: the simulator has no drawn-area store, so the drill saves no areas. Areas live in the same
  plan store, which carries over whole.
- The binary tile store (PRO-71) is not in 0.6. If it lands, it brings the first real migration, and the
  drill needs an interrupted-migration phase.
- This is an isolated run. A restore on the owner's host is a separate step and needs the owner's go.
