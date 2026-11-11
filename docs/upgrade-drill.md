# Upgrade and rollback drill

[Testing](testing.md) · [Simulated robot](e2e-harness.md) · [Installed check](installed-check.md)

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

## What 0.5.0 to 0.6 does

- Map history moves from version 1 to version 2 on upgrade. 0.5 refuses to read
  version 2 and leaves it untouched, so going back means restoring the Home
  Assistant backup made before the update, not reinstalling 0.5 in place.
- The plan store stays at version 1.12 in both releases. 0.6 only adds keys,
  such as `run_history` and the per-run `skipped_room_ids` and `held_rooms`.
- 0.6 settles the run that 0.5.0 left cleaning as unverified
  (`restart_native_mission_changed_or_ended`) and then runs the plan normally.
- 0.5.0 runs on a plan store 0.6 wrote. It keeps `run_history` but does not add
  to it, so runs made after going back in place are missing from the history
  if you upgrade again.
- Restoring the pre-upgrade backup brings back the 0.5.0 state exactly,
  including the interrupted run, which 0.5.0 settles the same way.

The last recorded run passed all four phases on October 31, 2026, before the
map-history migration existed. Run the drill again before a 0.6 release.

## Not covered

- The stores are synthetic, so the drill says nothing about a particular
  home's custom areas or saved maps.
- A plan that mixes rooms and custom areas is covered by the
  [simulated robot tests](e2e-harness.md), not here.
- Restoring a backup on a real host is a separate step and needs the owner's
  go.
