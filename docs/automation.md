# Entity and automation reference

[Documentation home](README.md) · [Project overview](../README.md) ·
[Get support](README.md#support)

The integration exposes Home Assistant entities and actions for robot state,
settings, cleaning, and saved plans.

## Entity contract

One configured robot creates 49 fixed entities — 21 sensors, 12 binary
sensors, 4 buttons, 4 switches, 3 selects, 1 number, 2 cameras, 1 update, and
1 vacuum — plus two opt-in statistics sensors per mapped room.

- `vacuum`: primary robot state plus start/resume, pause, stop, dock, Area
  cleaning, named-room segments, and supported commands.
- `camera`: a visible-by-default labeled room map rendered from geometry and
  pose, plus a default-disabled photographic SLAM map. The latter contains
  private accumulated color/structure map data, so enable it only for users and
  dashboards that should see the interior map.
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

## Drawn custom areas

Open the integration's **Configure** flow, choose **Custom cleaning areas**, and
draw over the exact part of the local map that should be cleaned. A saved area
can cross room boundaries and keeps its own cleaning mode and coverage default.
Home Assistant stores the geometry locally and the action accepts only its
name. The saved record also binds it to the exact coverage mission, standard
partition, and canonical room geometry it was drawn on. A legacy unbound area,
remap, floor change, or geometry mismatch is blocked before any robot command.
Home Assistant raises one privacy-safe Repair with only the number of affected
areas and directs an administrator to **Configure → Custom cleaning areas**.
Editing preserves name/mode/coverage but requires redrawing on the live map; no
automatic coordinate transform or cross-floor migration is attempted. A
temporarily unavailable live map reports that condition without creating or
clearing mismatch state.

For example, after saving an area named `Litter box`, this automation cleans
only that footprint when a litter box reports that its cycle completed:

```yaml
alias: Clean around litter box after cycle
triggers:
  - trigger: state
    entity_id: binary_sensor.litter_box_cycle
    from: "on"
    to: "off"
conditions: []
actions:
  - action: matic_robot.clean_area
    target:
      entity_id: vacuum.matic
    data:
      area: Litter box
mode: single
```

Replace the two entity IDs with the entities from the litter box and Matic
devices. If the litter box exposes a dedicated “cycle completed” event instead
of an on/off sensor, use that as the trigger and keep the action unchanged.
Optional `cleaning_mode` and `coverage_setting` fields override the defaults
saved with the area for that run.

## Map Studio

Administrators can open **Matic Map** from the Home Assistant sidebar. Its
three views use the same local map coordinate system:

- **3D** renders the accumulated color and structural point cloud with orbit,
  pan, pinch, twist, and tilt gestures.
- **Top-down** provides an orthographic plan view for precise exploration.
- **Rooms** provides the stable labeled geometry fallback when photographic
  pages are absent or unhealthy.

Fit, refresh, full-screen, pointer, touch, and keyboard controls are available.
Robot pose updates and map-page updates have different cadences, so a marker or
scene can briefly lag the physical robot. A content revision or health change
asks the viewer to reload a bounded scene; 0.3 does not send point-level deltas
or expose a guaranteed last-scanned timestamp.

The admin-only Map Studio catalog reports a content-free map health state:
`empty`, `collecting`, `incomplete`, `ready`, `truncated`, or `degraded`, plus
layer/drop/invalid counts, stream state, and lifetime stream failures. Any
storage-limit eviction marks the current mission `truncated` and forces
`map_complete` false. Retention favors spatial coverage and matched photo/
structure pages, but neither `ready` nor balanced counts prove that every
physical surface was scanned.

The photographic camera is disabled by default and the Map Studio is
administrator-only. Enabling the camera makes its image available under Home
Assistant's normal camera/entity permissions; use a geometric room-map card for
ordinary dashboards when photographic household detail is unnecessary.

## Intelligent rotation

Use **Intelligent rotation** for large plans and short or unpredictable cleaning
windows. Instead of beginning with the same first room every time, it starts
with rooms that have never completed, then rooms that have waited longest. The
saved room order breaks ties. Failed, cancelled, timed-out, or
restart-interrupted rooms remain due because history advances only after
verified completion.

Room history advances only after the managed runner positively matches the end
of the commanded room. Returning, idle, or docked state alone is not completion:
a low-charge return is suspended and waits for the robot's automatic resume;
an unexplained stop receives no credit. The private protocol does not yet expose
a verified refill-specific signal. After a verified room completion, the
runner can send the next room before the robot reaches the dock; only the final
room returns all the way to the dock.

Motion commands are serialized per robot. An independent Home Assistant clean,
custom-area clean, stop, or dock revokes the managed plan before that command is
sent; pause and resume are serialized without revoking the resumable plan.
Commands sent by another client cannot be arbitrated before they reach the
robot, so an unexplained terminal transition is treated as interrupted rather
than completed.

The finish-current-room policy estimates progress from elapsed time versus
successful managed runs of the same room with the same cleaning settings. A
stop below the configured threshold remains immediate; at or above it, the
current room completes, the next room is never started, and the robot docks.
Until the plan has learned a duration for that room, enabling the policy means
the current room finishes. Set the threshold to `0%` to always finish it. This
is a time-based estimate, not a measured area percentage; pauses, recharge, and
other delays can reduce its accuracy.

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
  whole-run OTA comparisons work out of the box. Some robot firmware leaves
  its native session-history collection stale; the integration therefore
  reconstructs newer runs from the verified Cleaning and Current area states.
  Brief disconnects are ignored, firmware phrases such as `the Living Room`
  are matched to the mapped room name, and an active run is recovered from
  Recorder after an integration or Home Assistant restart. Robot-native
  session summaries now retain their explicit completed/interrupted outcome;
  interrupted summaries never update per-room last-cleaned or duration sensors.

## Events and observability

Room execution emits `matic_robot_room_started`,
`matic_robot_room_completed`, `matic_robot_room_failed`, and
`matic_robot_room_cancelled`, plus `matic_robot_room_interrupted` when the task
is replaced/stopped and `matic_robot_room_ended_unverified` when operational
handoff is safe but the native completion ledger does not prove success. Only
`room_completed` advances last-cleaned, successful duration samples, completed
run totals, or intelligent rotation. Exact plan and room details remain
available through the response-only plan preview and management actions instead
of being written into recorder-backed attributes.

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
`hermes_error_codes` while also exposing automation-safe `errors` and
`primary_error` attributes such as `error_code_207`. These labels preserve the
exact robot value without guessing a meaning from the app's unrelated enum
ordering. A code must appear in two consecutive 30-second polls before the
Activity and Problem entities expose it; one-poll firmware pulses stay in debug
logs instead of creating misleading Logbook error entries.
