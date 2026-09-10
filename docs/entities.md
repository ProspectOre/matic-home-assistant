# Entities and controls

[Documentation](README.md) · [Automations](automation.md)

Each robot has 55 fixed entities — 23 sensors, 13 binary sensors, 5 buttons,
4 switches, 4 selects, 1 number, 2 cameras, 1 event, 1 update, and 1 vacuum —
plus two opt-in statistics sensors per mapped room.

## Controls

| Entity | Use |
| --- | --- |
| Vacuum | Start/resume, pause, stop, dock, and room or Area cleaning |
| Cleaning mode | Default vacuum, mop, or vacuum-and-mop mode |
| Coverage | Default Quick, Optimal, or Heavy Duty coverage |
| Saved cleaning plan | Select the default plan |
| Custom cleaning area | Select a saved outline |
| Plan buttons | Run the selected plan, use rotation, run top-to-bottom, or stop |
| Clean selected area | Run the selected custom area |
| Setting switches | Child lock, pet-waste avoidance, Matic Cues, double-pass mopping |
| Water flow | Adjust the robot's water-flow setting |

## Maps

`camera.matic_map` provides a labeled room map for dashboards. The photographic
SLAM camera is disabled by default; enable it from the device's entity list if
needed. Administrators can use the interactive **Matic Map** sidebar panel.

## State and diagnostics

Sensors cover activity, battery, rooms, current area, active/next plan room,
cleaning history, run duration, Cues lifecycle, firmware, update state, Wi-Fi,
schedules, dock/sink counts, and coverage time.

Binary sensors expose cleaning, paused, returning, charging, low charge,
fully charged, problem, update available, active session, Matter pairing,
robot SSH permission, robot diagnostic upload, and following-person state.
**Fully charged** is on when the battery is full.

The firmware update entity is read-only; Matic manages its own updates. The
latest version may be unknown while an update is pending. Diagnostic entities
are generally disabled by default.

If **Problem** turns on, inspect `sensor.matic_activity`:

- `errors` and `primary_error` identify reported conditions.
- `hermes_error_codes` preserves numeric codes; unknown meanings appear as `error_code_<n>`.

Errors must persist across two normal polls before they appear, filtering brief
firmware pulses. Recorded activity can help diagnose an error after it clears.

## Room statistics and the recorder

Each room's **Last cleaned** and **Last clean duration** sensors are disabled
by default. Enable them to retain room-specific history and duration statistics.
**Last run duration** is recorded by default.

Room lists, SSID, schedules, detailed session results, and plan history remain
available to templates through `state_attr()` but are excluded from Recorder
attributes. See [privacy](privacy.md) for stored data and event payloads.

## Matic Cues

Voice and gesture sensors, a following-person binary sensor, and the Cues event
entity expose robot-reported lifecycle changes. The integration receives no
transcripts, media, or pointing coordinates. Enabling the Cues switch also
activates [Matic's voice processing](privacy.md#matic-cues).

## Entity IDs

Examples use IDs such as `vacuum.matic` and `camera.matic_map`. Substitute the
IDs shown on your device page. The one-time 0.2 migration renamed older numbered
IDs where possible; subsequent user-assigned names are preserved.

## Read-only operations

Administrator-only MCP tools provide live runner status, plan order/settings,
recent native history, and recent events: `MaticGetOperations`, `MaticGetPlan`,
`MaticGetNativeHistory`, and `MaticGetRecentEvents`.
Recent events include the [command and raw-state observation trail](activity-diagnostics.md).
Dust-bag observations are currently available through `MaticGetOperations` only.
