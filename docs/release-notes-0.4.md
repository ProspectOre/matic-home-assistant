# 0.4.0

A new map-based cleaning workspace brings one-time room cleaning, saved plans,
and custom areas together.

## Highlights

- Draw custom areas by placing perimeter points. Outlines close automatically;
  points remain editable with dragging, insertion, deletion, and undo/redo.
- Improved phone and tablet layouts, map controls, saved-area recovery, and
  navigation in the Home Assistant companion app.
- More reliable live maps and robot position when changing floors or returning
  to a previously mapped floor.
- Stop remains available while a cleaning request is starting. Threshold-based
  stops finish only the active room when its progress qualifies.
- Managed plans verify their original native session through cleaning, pause,
  and recharge. An unrelated task cannot be adopted as a resumed plan.
- Native history separates vacuum and mop outcomes and durations. Partial or
  unattempted work cannot earn full completion credit; partial work still
  updates rotation priority.
- Improved setup, reauthentication, recovery, and compatibility with the
  minimum supported Home Assistant version.

## Updating

Back up Home Assistant, ensure the robot is idle, install 0.4.0 through HACS,
and restart Home Assistant. Confirm the live map, robot position, and available
entities before starting a clean. Keep the backup until operation is verified.

Home Assistant 2026.7 or newer is required. Existing saved plans and areas are
preserved; an area whose map binding has changed may need confirmation or redrawing.
See [installation](../README.md#install) for setup and recovery guidance.

## Known limits

Firmware 172.15/protocol 25 localization behavior, live network-loss recovery,
and Container reauthentication remain unverified on their affected setups.
Separate iPad and broader assistive-technology coverage is incomplete.
The final history correction was verified against a recorded mission;
new-run validation and a controlled OEM-task replacement retest remain open.
Older stable versions may not render maps from newer firmware.
See [compatibility and validation](acceptance-0.4.md).
