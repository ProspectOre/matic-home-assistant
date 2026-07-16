# Entity and automation reference

The integration exposes Home Assistant entities and actions for robot state,
settings, cleaning, and saved plans.

## Entity contract

One configured robot creates 44 entities: 18 sensors, 12 binary sensors, 4
buttons, 4 switches, 3 selects, 1 number, 1 camera, and 1 vacuum.

- `vacuum`: primary robot state plus start/resume, pause, stop, dock, Area
  cleaning, named-room segments, and supported commands.
- `camera`: visible-by-default local map rendered from room geometry and robot
  pose. It contains no optical camera frames. Add it to a dashboard with Home
  Assistant's Picture Entity card.
- `select`: default cleaning mode, default coverage, and default cleaning plan.
- `button`: run the default plan, intelligent-rotation override,
  top-to-bottom override, and stop-plan-and-dock.
- `sensor`: activity, battery, rooms, cleaning history, active plan, next room,
  firmware/protocol/update state, current area, Wi-Fi, schedules, local
  sessions, dock/sink, and coverage.
- `binary_sensor`: cleaning, paused, returning, charging, low charge, fully
  charged, problem, update available, Matter pairing mode, active cleaning
  session, robot SSH tunnel permission, and robot diagnostic upload.
- `switch` and `number`: robot settings such as child lock,
  pet-waste avoidance, Hey Matic, double-pass mopping, and water flow.

Camera and microphone recording, clip retrieval and caching, recording
metadata, and vendor share or discard decisions are not included in the entity
or action contract. See
[Recording-related protocol notes](recording-protocol.md) for the observed but
unavailable protocol semantics.

Home Assistant owns entity IDs and registry customization. Stable unique IDs
preserve user renames across restarts.

**Fully charged** is a plain boolean with explicit `Fully charged` / `Not fully
charged` states and a battery-check icon. It intentionally does not use Home
Assistant's battery binary-sensor device class, whose generic on/off labels
would invert the meaning and display a fully charged robot as `Low`.

## Complete cleaning action

`matic_robot.clean` supports any room subset or sequence,
`vacuum`/`mop`/`vacuum_and_mop`, quick/standard coverage, and
ordered/unordered execution. Omitted rooms clean the whole floor; room names
and stable room IDs are both accepted.

```yaml
actions:
  - action: matic_robot.clean
    target:
      entity_id: vacuum.matic
    data:
      rooms: [Kitchen, Study]
      cleaning_mode: vacuum_and_mop
      coverage_setting: standard
      ordered: true
```

## Saved plans

The integration **Configure** flow creates and edits plans in one screen. No
rooms are selected until the user chooses them:

1. Name the plan and choose its default cleaning order.
2. Review the vertical list of mapped rooms directly underneath.
3. Leave unwanted rooms off; turn on rooms to reveal mode and coverage
   dropdowns, defaulting to Vacuum and Standard.
4. Drag rooms or use arrow buttons to save the exact top-to-bottom order.
5. Submit once; the same screen edits every room and plan setting later.

A plan defines **what** to clean. Home Assistant schedules, presence
automations, buttons, and scripts decide **when** it runs.

## Intelligent rotation

Use **Intelligent rotation** for large plans and short or unpredictable cleaning
windows. Instead of beginning with the same first room every time, it starts
with rooms that have never completed, then rooms that have waited longest. The
saved room order breaks ties. Failed, cancelled, timed-out, or
restart-interrupted rooms remain due because history advances only after
verified completion.

Use **Run all — top to bottom** when every selected room should always clean in
the visible saved order regardless of history.

## Plan actions

- `matic_robot.run_selected_plan`: run the default or named plan using its
  saved default behavior.
- `matic_robot.intelligent_clean`: run intelligent rotation as a per-run
  override.
- `matic_robot.clean_entire_plan`: clean every selected room in saved order as a
  per-run override.
- `matic_robot.stop_intelligent_cleaning`: leave the active room due and dock.
- `matic_robot.preview_plan`: return the exact next order and per-room settings
  without sending a robot command or changing history.
- `matic_robot.reset_plan_history`: clear successful-room tracking without
  deleting plans or room settings.
- `matic_robot.list_plans`, `save_plan`, `select_plan`, `delete_plan`,
  `save_plan_room`, `move_plan_room`, and `delete_plan_room`: management API for
  scripts, backup/restore, provisioning, and advanced automations.

Plan actions accept human names or stable IDs where appropriate. Action fields
are defined in `custom_components/matic_robot/services.yaml`.

## Raw collection reads

`matic_robot.fetch_hermes_collection` returns a bounded snapshot of one
allowlisted non-credential Hermes collection. It requires exactly one Matic
robot. Fields:

- `collection` (required): the collection to read, chosen from the allowlist in
  `services.yaml` (for example `wifi_status`, `schedule_events`, or
  `map_semantics`).
- `limit` (default `32`, range 1–256): maximum entries to return.
- `include_payload` (default `false`): when false, each entry returns only
  key/value sizes and their SHA-256 hashes. Enable it to include the raw bytes.
- `payload_format` (`base64` default, or `hex`): encoding for included payloads.
- `max_bytes` (default `65536`, range 0–1048576): truncates each included key
  and value; the response flags any truncation.

The hash-only default limits routine inspection to sizes and hashes. Raw payload
access requires explicit opt-in and may expose private device or home data.

## Events and observability

Room execution emits `matic_robot_room_started`,
`matic_robot_room_completed`, `matic_robot_room_failed`, and
`matic_robot_room_cancelled`. The Cleaning history sensor exposes per-room
completion timestamps, plan history, active plan, interrupted plan, and
completion/failure/cancellation counts.

Use ordinary state triggers and conditions on any telemetry, setting, Activity,
or binary sensor. This keeps automations composable with schedules, presence,
weather, energy prices, quiet hours, doors, alarms, helpers, templates, scenes,
scripts, and dashboards.

## Ready-to-import blueprints

- [Clean when everyone leaves](../blueprints/automation/matic_robot/clean_when_away.yaml)
- [Quiet-hours cleaning](../blueprints/automation/matic_robot/quiet_hours.yaml)
- [Pet-aware cleaning](../blueprints/automation/matic_robot/pet_aware.yaml)
- [Scheduled intelligent cleaning](../blueprints/automation/matic_robot/room_rotation.yaml)

Each blueprint calls the saved-plan actions and can be edited after import.

## Fault semantics

The Activity sensor preserves numeric `hermes_state_codes` and
`hermes_error_codes` while also exposing normalized snake-case `errors` and
`primary_error` attributes such as `bag_full`, `brush_roll_jammed`,
`mop_roll_worn_out`, `solvent_low`, or `vacuum_filter_clogged`. Unknown future
codes remain available as `unknown_<code>` instead of being dropped.
