# Upgrade and rollback drill

[Testing](testing.md) · [Simulated robot](e2e-harness.md) · [Installed check](installed-check.md)

`scripts/upgrade_drill.py` upgrades from an older release to this checkout and rolls back, all against the
[simulated robot](e2e-harness.md). The older release runs its own integration code from a temporary Git
worktree, with this checkout's simulator copied in. Every phase runs in its own process on real store
files, so the stores carry over between phases and code versions the same way they do on a host. The
test Home Assistant starts with empty registries, so each phase recreates the mapped Area and the
vacuum's entity options from the previous phase's registry files.

0.5.4 is the oldest release 0.6 updates from, and the one to drill, with 0.5.5:

```sh
git fetch origin tag v0.5.4
.venv/bin/python scripts/upgrade_drill.py v0.5.4
```

| Phase | Code | What it does |
| --- | --- | --- |
| seed | older | Saves plans and a version-1 map-history sample, finishes a run, then stops Home Assistant mid-clean. It adds a second area with the whole-floor v1 binding 0.3 wrote to the stored file. The stores are copied as the pre-upgrade backup. |
| upgrade | this checkout | Converts the 0.5 area binding to v7 and leaves the v1 one as saved and invalid, migrates map history to v2, creates automatic, kept and trash records, settles the interrupted run and finishes the plan. |
| downgrade | older | Starts the integration on the newer stores without starting a run. Requires no error, Matic Map listing the converted area as invalid without circles and the v1 area as current after 0.5.4 converts it, and the version-1 map-history reader leaving v2 unread with its bytes unchanged (0.5.4 keeps a temporary, empty history). |
| restore | older | Runs the plan on the matching pre-upgrade version-1 backup. |

The drill also saves and executes a separate custom-area plan. It checks area identity,
geometry and binding, saved plans and completion history across phases, plus the map-history
migration, refusal and restored backup. No run starts during the downgrade phase.
The seed maps a Home Assistant Area to a room, and the drill checks that the upgrade moves
the floor catalogs into `matic_robot.floor_catalogs.<entry>` while leaving 0.5's copy, less
its floor scope, in the vacuum's entity options. 0.5.4 restores its floor scope when it starts
in the downgrade phase, and the restored backup still has the catalogs.

## Below the floor

0.6 reads two saved versions to tell what ran last: the config entry (1.3 in
every 0.5 release, 1.2 in 0.4) and the plan file (1.13 from 0.5.1 on, 1.12 in
0.5.0, 1.5 in 0.4.8). An entry below 1.3 or a plan file below 1.13 stops the
integration with a Repair asking for 0.5.4, before it writes any store. The
other stores 0.5 keeps (firmware, map cache, map history) are version 1 in
every 0.4 and 0.5 release and show nothing. So 0.6 cannot tell 0.5.1 to 0.5.3
from 0.5.4, nor 0.5.0 from 0.5.4 when no plan was ever saved, and starts on
those.

`scripts/upgrade_drill.py v0.5.0` drills the refusal. When the seed leaves a
plan file below 1.13 the script runs three phases instead: seed, then
`refused` on this checkout (the integration does not start and raises the
Repair; every `matic_robot.*` store file must be byte for byte as seeded),
then restore on the same files, where 0.5.0 settles its interrupted run and
runs the plan. 0.4.8 cannot be seeded: the simulator harness does not load on
its code. Its refusal, with and without a plan file, is covered on written
store files by `tests/e2e/test_minimum_upgrade.py`.

## What 0.5.4 to 0.6 does

- Map history moves from version 1 to version 2 on upgrade. 0.5 refuses to read
  version 2 and leaves it untouched, so going back means restoring the Home
  Assistant backup made before the update, not reinstalling 0.5 in place.
- The plan store stays at version 1.13 in both releases. 0.6 only adds keys,
  such as `run_history` and the per-run `skipped_room_ids` and `held_rooms`.
  It repairs fields older releases saved, such as duration scalars and run
  `trigger`, in memory once per start and saves them with its next write.
- At startup 0.6 converts every custom-area binding 0.5 wrote (v3 with room
  snapshots, v4 and v6) that it can verify on the current floor to v7, the
  only format it writes. 0.5.4 does not read v7: it starts normally but hides
  a converted area and refuses plans that use it until the area is redrawn. A
  binding 0.6 cannot verify yet keeps its old format and its Repair.
- An area saved before 0.5 that never re-verified (v1, v2, v5, or v3 without
  room snapshots) reads as invalid in 0.6 and must be redrawn. 0.6 leaves its
  record as saved.
- 0.6 settles the run that 0.5.4 left cleaning as unverified
  (`restart_native_mission_changed_or_ended`) and then runs the plan normally.
- 0.5.4 runs on a plan store 0.6 wrote. It keeps `run_history` but does not add
  to it, so runs made after going back in place are missing from the history
  if you upgrade again.
- Restoring the pre-upgrade backup brings back the 0.5.4 state exactly,
  including the interrupted run, which 0.5.4 settles the same way.

The last recorded runs, on November 20, 2026: v0.5.4 and v0.5.5 passed all
four phases and v0.5.0 passed the refusal drill. Run the drill again before a 0.6 release.

## Not covered

- The stores are synthetic, so the drill says nothing about a particular
  home's custom areas or saved maps.
- A plan that mixes rooms and custom areas is covered by the
  [simulated robot tests](e2e-harness.md), not here.
- Restoring a backup on a real host is a separate step and needs the owner's
  go.
