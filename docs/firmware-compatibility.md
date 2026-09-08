# Firmware compatibility

[Compatibility](acceptance-0.4.md) · [Protocol endpoints](firmware-endpoint-map.md)

Matic updates can change the local protocol. These records describe the
firmware and workflows checked on real robots.

## Recorded checks

| Firmware | Date | Integration | Checked behavior |
| --- | --- | --- | --- |
| v173.10 | 2026-09-08 | 0.4.0 | Map and state recovery after restart; native vacuum/mop history decoding |
| [v172.9](firmware-versions/v172.md) | 2026-08-13 | Development | Core reads, Cues setting, voice/gesture lifecycle, following, and endpoint analysis |
| [v171.10](firmware-versions/v171.md) | 2026-08-09 | 0.3.4 | Initial pairing on HA Container with local BlueZ; state, telemetry, map, rooms, and pose |
| [v169.9](firmware-versions/v169.md) | 2026-07-27 | 0.3.0 | Maps, quick/standard cleaning in all three modes, saved plans, stop thresholds, and custom areas |
| [v168.11](firmware-versions/v168.md) | 2026-07-20–23 | 0.2.0–0.2.3 | Core reads, upload-setting decoding, and selected room-plan, stop, and dock workflows |

## Automatic checks

After a firmware or protocol change, the integration compares a local snapshot
of 40 allowlisted endpoints. **Firmware compatibility** shows the result.
A Home Assistant Repair appears for endpoint availability or transport changes;
ordinary content changes and new field shapes stay in diagnostics.

Snapshots contain versions, status, counts, sizes, hashes, and value-free wire
paths. They do not test pairing or cleaning controls. Run
[`matic_robot.firmware_snapshot`](actions.md#firmware-snapshot) for a fresh
comparison; the latest 52 snapshots are retained.

Use `matic_robot_firmware_changed` for update notifications and
`matic_robot_firmware_analyzed` for comparison results. Both identify the robot.
See the [event reference](automation.md#events-and-observability).

## Adding a firmware record

Use the [template](firmware-versions/template.md) to record versions, observed
changes, and the workflows actually checked. Keep raw diagnostics and home data
out of the repository. New protocol commands follow the requirements in
[Contributing](../CONTRIBUTING.md#changes-and-pull-requests).
