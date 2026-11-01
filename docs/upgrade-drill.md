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
| seed | older | Saves plans and a version-1 map-history sample, finishes a run, then stops Home Assistant mid-clean. The stores are copied as the pre-upgrade backup. |
| upgrade | this checkout | Migrates map history to v2, creates automatic, kept and trash records, settles the interrupted run and finishes the plan. |
| downgrade | older | Checks the version-1 map-history reader refuses v2 and leaves its bytes unchanged; reads the newer plan store without starting a run. |
| restore | older | Runs the plan on the matching pre-upgrade version-1 backup. |

The drill also saves and executes a separate custom-area plan. It checks area identity,
geometry and binding, saved plans and completion history across phases, plus the map-history
migration, refusal and restored backup. No run starts during the refused downgrade phase.

## 0.5.0 to 0.6 (October 31, 2026)

All four phases passed against release/0.6 at `d357cdc`. This is a historical
receipt: the later [map candidate](map-experience-implementation.md) migrates
history storage to v2 and requires a fresh drill and matching-backup restore proof.

- The plan store stays at version 1.12 in both releases, so the upgrade runs no store migration. That build only
  added plan-store keys, such as `run_history` and the per-run `skipped_room_ids` and `held_rooms`.
- 0.6 settles the run that 0.5.0 left cleaning as unverified (`restart_native_mission_changed_or_ended`)
  and then runs the plan normally.
- 0.5.0 runs normally on stores 0.6 wrote. It keeps 0.6's `run_history` but does not add to it, so runs made
  after an in-place downgrade are missing from 0.6's history if you upgrade again. Restoring the backup
  avoids this.
- Restoring the pre-upgrade backup brings back the 0.5.0 state exactly, including the interrupted run, and
  0.5.0 settles it the same way.

## Not covered

- The stores are synthetic. This does not qualify the owner's existing areas or map history, or an
  interleaved room-and-area plan; the latter is a separate managed-run scenario.
- The binary tile store (PRO-71) was not in that build. If it lands, its separate migration
  needs an interrupted-migration phase; the current candidate already migrates history storage.
- This is an isolated run. A restore on the owner's host is a separate step and needs the owner's go.
