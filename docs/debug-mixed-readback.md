# Mixed-room readback diagnostic candidate

Version `0.4.8.dev1` is a local diagnostic candidate based on `v0.4.7` for
[issue #218](https://github.com/ProspectOre/matic-home-assistant/issues/218).
It adds bounded, redacted readback diagnostics and preserves a specific timeout
error. It does not fix or establish the cause of the reported mixed-room abort.
The eight-second bound, goal matching, ownership checks, and recovery behavior
remain in place. This is not a published HACS version or an accepted release.

## Before installing

Use the candidate only after its source review and required checks are complete.
Confirm that the robot is docked and idle, with no cleaning task, automation, or
script about to start it. Record the installed integration and robot firmware
versions. Back up Home Assistant and keep a separate copy of the complete
installed `custom_components/matic_robot` directory outside that directory.
Preserve the supplied archive checksum and per-file manifest for verification.

## Manual installation

The ZIP contains a single top-level `matic_robot/` directory. Replace the existing
`config/custom_components/matic_robot/` directory with it; do not nest a second
`matic_robot` directory or merge it with leftover files from another version.
Do not change the integration's configuration, credentials, plans, or schedules.
Restart Home Assistant and verify the loaded integration reports `0.4.8.dev1`.
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
