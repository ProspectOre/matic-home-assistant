# Compatibility

[Install](../README.md#install) · [Pairing](hermes-pairing.md) · [Troubleshooting](troubleshooting.md)

[What you need](../README.md#what-you-need) is in the project overview. This
page covers robot firmware and the limits known today.

## Robot firmware

The robot installs its own firmware updates. The integration talks to it the
way the Matic app does, and Matic doesn't publish that, so an update can
change what works. These are the versions checked on a real robot so far. A
version that isn't listed has not been tried, which is not the same as broken.

| Firmware | Checked | With | What was checked |
| --- | --- | --- | --- |
| v181.10 | 2026-11-01 | 0.5.1 | The robot's cleaning history: floors, rooms and vacuum and mop results |
| v178.8 | 2026-10 | Development | Every combination of cleaning mode, vacuum coverage and double-pass mopping started, stopped and docked |
| v173.10 | 2026-09-08 | 0.4.0 | Map and state after a restart; vacuum and mop results in the robot's history |
| v172.9 | 2026-08-13 | Development | The Cues setting, voice and gesture stages, and following a person |
| v171.10 | 2026-08-09 | 0.3.4 | First pairing on Home Assistant Container; state, map, rooms and position |
| v169.9 | 2026-07-27 | 0.3.0 | Reconnecting after the update without pairing again; maps and map history; Quick and Optimal coverage in all three cleaning modes; pause, resume, stop and dock; a two-room plan; a custom area; Smart Stop |
| v168.11 | 2026-07-20 | 0.2.0 to 0.2.3 | State, map, rooms, position, schedules and history; a two-room plan without docking in between; stopping in the second room kept the first room's result |

## Automatic firmware checks

After a firmware update, the integration reads 40 kinds of robot data and
compares what comes back with the previous firmware. The **Firmware check
status** sensor shows the result.

- A Repair appears when the same read fails repeatedly and clears once it
  works again. A first failure stays pending.
- A field seen for the first time is recorded as new, with its meaning unknown.
  It never turns on a control.
- The comparison keeps versions, counts, sizes and checksums, never the data
  itself. The latest 52 comparisons are kept.
- It doesn't test pairing or cleaning.

Run [`matic_robot.firmware_snapshot`](actions.md#firmware-snapshot) for a fresh
comparison. `matic_robot_firmware_changed` fires when the version changes and
`matic_robot_firmware_analyzed` when a comparison finishes
([events](automation-events.md)). For phone alerts and research on what
changed, see [firmware alerts](firmware-intelligence.md).

## Known limits

- Pairing needs Bluetooth on the Home Assistant host. Pasting a pairing made on
  another computer is [experimental](hermes-pairing.md#pair-on-another-device)
  and relies on a community tool this project has not tested.
- Removing the integration does not remove Home Assistant's access on the
  robot itself ([removal](../README.md#remove)).
- Matic Map and its messages are in English only.
- Assist can run a plan or stop only with a conversation agent that can use
  tools. Home Assistant's built-in sentence agent can't.
- Not tried yet on real hardware: pairing a second robot to the same Home
  Assistant, a Windows screen reader or High Contrast, restoring a full Home
  Assistant backup, a real firmware change alert from start to finish, and
  running for weeks without a restart.
- Going back to an earlier release needs the Home Assistant backup made before
  the update ([updating](../README.md#updating)).

## Add a firmware check

Add a row to the table with the date, the integration version and only what
you checked yourself. Mention the Home Assistant version and how it is
installed when pairing was part of the check. Keep diagnostics files and
anything about your home out of the repository. New robot commands follow
[Contributing](../CONTRIBUTING.md#changes-and-pull-requests).
