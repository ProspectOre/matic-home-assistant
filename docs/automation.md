# Entity and automation reference

[Documentation home](README.md) · [Project overview](../README.md) ·
[Get support](README.md#support)

The integration exposes Home Assistant entities and actions for robot state,
settings, cleaning, and saved plans.

## Entity contract

One configured robot creates 48 fixed entities — 21 sensors, 12 binary
sensors, 4 buttons, 4 switches, 3 selects, 1 number, 1 camera, 1 update, and
1 vacuum — plus two opt-in statistics sensors per mapped room.

- `vacuum`: primary robot state plus start/resume, pause, stop, dock, Area
  cleaning, named-room segments, and supported commands.
- `camera`: visible-by-default local map rendered from room geometry and robot
  pose. It contains no optical camera frames. Add it to a dashboard with Home
  Assistant's Picture Entity card.
- `select`: default cleaning mode, default coverage, and default cleaning plan.
- `button`: run the default plan, intelligent-rotation override,
  top-to-bottom override, and stop-plan-and-dock.
- `sensor`: activity, battery, rooms, cleaning history, active plan, next room,
  firmware/protocol/update/compatibility state, current area, Wi-Fi state and
  signal, schedules, local sessions, last run duration, dock/sink, coverage,
  and two opt-in statistics sensors per mapped room (see
  [Room statistics](#room-statistics-and-the-recorder)).
- `update`: a read-only firmware surface in Home Assistant's update UI. The
  robot manages its own OTA installs and never reports the target version, so
  a pending update shows with an unknown latest version.
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

The integration assigns descriptive canonical IDs such as
`sensor.matic_software_version` and `camera.matic_map`. Before 1.0, setup migrates
older numbered IDs to this model when the destination is free. Stable unique IDs
continue to anchor every registry entity.

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
5. Optionally enable **Finish the current room when stopping** and choose its
   estimated progress threshold.
6. Submit once; the same screen edits every room and plan setting later.

A plan defines **what** to clean. Home Assistant schedules, presence
automations, buttons, and scripts decide **when** it runs.

## Intelligent rotation

Use **Intelligent rotation** for large plans and short or unpredictable cleaning
windows. Instead of beginning with the same first room every time, it starts
with rooms that have never completed, then rooms that have waited longest. The
saved room order breaks ties. Failed, cancelled, timed-out, or
restart-interrupted rooms remain due because history advances only after
verified completion.

The finish-current-room policy estimates progress from elapsed time versus
successful managed runs of the same room with the same cleaning settings. A
stop below the configured threshold remains immediate; at or above it, the
current room completes, the next room is never started, and the robot docks.
Until the plan has learned a duration for that room, enabling the policy means
the current room finishes. Set the threshold to `0%` to always finish it. This
is a time-based estimate because the robot does not expose live mapped-area
completion percentage.

Use **Run all — top to bottom** when every selected room should always clean in
the visible saved order regardless of history.

## Plan actions

- `matic_robot.run_selected_plan`: run the default or named plan using its
  saved default behavior.
- `matic_robot.intelligent_clean`: run intelligent rotation as a per-run
  override.
- `matic_robot.clean_entire_plan`: clean every selected room in saved order as a
  per-run override.
- `matic_robot.stop_intelligent_cleaning`: apply the plan's immediate-or-finish
  stop policy, never start another room, and dock.
- `matic_robot.preview_plan`: return the exact next order and per-room settings
  without sending a robot command or changing history.
- `matic_robot.reset_plan_history`: clear successful-room tracking without
  deleting plans or room settings.
- `matic_robot.list_plans`, `save_plan`, `select_plan`, `delete_plan`,
  `save_plan_room`, `move_plan_room`, and `delete_plan_room`: management API for
  scripts, backup/restore, provisioning, and advanced automations.

Plan actions accept human names or stable IDs where appropriate. Action fields
are defined in `custom_components/matic_robot/services.yaml`.

## Payload-free endpoint inspection

`matic_robot.inspect_hermes_endpoint` returns a bounded fingerprint snapshot of
one allowlisted non-credential Hermes property or collection. It requires
exactly one Matic robot. Fields:

- `endpoint` (required): the property or collection to read, chosen from the allowlist in
  `services.yaml` (for example `wifi_status`, `schedule_events`, or
  `map_semantics`).
- `limit` (default `32`, range 1–256): maximum entries to return.

The response contains endpoint kind/sensitivity plus key/value sizes and SHA-256
hashes. Raw bytes are never returned through the public Home Assistant action.
The typed registry routes single-value properties correctly instead of treating
every name as a collection stream.

## Firmware snapshots

`matic_robot.firmware_snapshot` checks all 40 known non-credential endpoints
with four-way bounded concurrency. It stores up to 52 payload-free snapshots in
Home Assistant and returns:

- firmware and protocol versions;
- populated, empty, and failed endpoint counts;
- endpoint kind, sensitivity, status, sizes, and hashes;
- availability/transport changes separately from ordinary content changes.

When the coordinator observes a new firmware version, the integration fires
`matic_robot_firmware_changed` with previous and current firmware/protocol
values. A Home Assistant Repair is created only when the subsequent snapshot
finds endpoint availability or transport drift; normal weekly OTAs remain
silent. Snapshotting never promotes a firmware to control-verified; physical
write validation remains deliberate.

## Room statistics and the recorder

Template-visible attributes and recorded history follow one deliberate model:

- **Live attributes, never recorded.** The vacuum's `rooms` map, the rooms
  sensor's `room_names`/`segments`, the Wi-Fi sensor's `ssid`, schedule
  definitions, the latest session's rooms and per-room durations, and full
  plan/history detail are all available to templates, dashboards, and
  conditions through `state_attr()`. Every one of these attributes is excluded
  from Home Assistant's recorder, so home context never accumulates in the
  history database.
- **Opt-in room statistics sensors.** Each mapped room gets a
  `{room} last clean duration` sensor (long-term statistics; compare cleaning
  time across firmware updates) and a `{room} last cleaned` timestamp sensor.
  Both are disabled by default because enabling them intentionally records the
  room's name and cleaning history; enable them per room under the device's
  entity list when you want durable per-room trends.
- **Always-recorded run metrics.** The `Last run duration` sensor records
  numeric long-term statistics for every session without any room context, so
  whole-run OTA comparisons work out of the box.

## Events and observability

Room execution emits `matic_robot_room_started`,
`matic_robot_room_completed`, `matic_robot_room_failed`, and
`matic_robot_room_cancelled`. The Cleaning history sensor exposes per-room
safe completion/failure totals. Exact plan and room details remain available
through the response-only plan preview and management actions instead of being
written into recorder-backed attributes.

When the robot finishes a cleaning session the integration fires
`matic_robot_cleaning_finished` with the session's start/end timestamps,
duration, completion flag, rooms, per-room durations, the firmware version
that produced the run, and the `device_id`/`entry_id` of the robot — one
payload for post-clean notifications or custom logging.
`matic_robot_firmware_changed` likewise carries `device_id`/`entry_id` so
multi-robot homes can tell which robot updated.

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
