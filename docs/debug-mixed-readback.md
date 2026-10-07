# Mixed-room readback correction candidate

Version `0.4.8rc2` is a diagnostic prerelease based on `v0.4.7` for
[issue #218](https://github.com/ProspectOre/matic-home-assistant/issues/218).
It corrects the native double-pass switch mapping, sends Standard mop goals
independently of vacuum strength, and recognizes only observed complete-group
readback transformations. The bounded, redacted diagnostics remain available.
Native-app comparisons and standalone-client readbacks support the correction;
completed cleaning on this installed HA candidate remains a separate gate.
This is a prerelease, not a stable release.

## Before installing

This candidate is for 0.4.x installations. Do not downgrade a 0.5 prerelease: its
newer saved-plan storage is incompatible with 0.4.x.

Use the candidate only after its source review and required checks are complete.
Confirm that the robot is docked and idle, with no cleaning task, automation, or
script about to start it. Record the installed integration and robot firmware
versions. Back up Home Assistant and keep a separate copy of the complete
installed `custom_components/matic_robot` directory outside that directory.
Preserve the supplied archive checksum and per-file manifest for verification.

## HACS installation

Enable beta/prerelease versions for Matic, choose `v0.4.8-rc2` in Redownload,
and restart Home Assistant. Confirm the integration reports `0.4.8rc2`.
Do not select the separate 0.5 prerelease for this diagnostic test.

## Manual installation

The ZIP contains a single top-level `matic_robot/` directory. Replace the existing
`config/custom_components/matic_robot/` directory with it; do not nest a second
`matic_robot` directory or merge it with leftover files from another version.
Do not change the integration's configuration, credentials, plans, or schedules.
Restart Home Assistant and verify the loaded integration reports `0.4.8rc2`.
Confirm normal startup and map readiness before arranging the diagnostic run.

## Collect the comparison

Record the previous logging level, then enable only this logger with the
Home Assistant `logger.set_level` action:

```yaml
action: logger.set_level
data:
  custom_components.matic_robot.client.api: debug
```

Once a run is explicitly agreed, reproduce the same failing room order, modes,
and coverage settings once, with Stop available. Do not disable guards or repeat
an uncertain start. Record the firmware version, candidate version, settings,
approximate time, and observed outcome.

If verification times out, copy only the line beginning
`Mixed coverage readback timed out:` and its timestamp. It reports the interrupted
stage, sample status, goal counts, and missing/unexpected tuples of
`(room_ordinal, setting, floor, mode, behavior, count)`. Room ordinals are local to
the attempt. Each delta is capped at 32 entries with an omitted-entry count.
The latest completed sample can precede a stalled read; it is not a completion
or physical-safety receipt. If the line is absent, report that fact and the error
message rather than uploading all logs.

Restore the previous logger level immediately afterward using `logger.set_level`
(normally `info` if no explicit override was previously configured). Review the
selected lines before posting. Do not share raw protocol payloads, maps, room or
session IDs, credentials, addresses, or unrelated Home Assistant logs.

## Rollback

Wait for the robot to be idle. Replace the entire candidate integration directory
with the saved original directory, restart Home Assistant, and verify the
original version, successful startup, and normal map/robot availability. Restore
the recorded logging level. Keep configuration and saved plans intact. A HACS
redownload of the original stable version is another supported restore route.
