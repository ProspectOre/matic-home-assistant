# Entity and automation reference

[Documentation home](README.md) · [Project overview](../README.md) ·
[Get support](README.md#support)

The integration exposes Home Assistant entities and actions for robot state,
settings, cleaning, and saved plans.

## Entity contract

One configured robot creates 55 fixed entities — 23 sensors, 13 binary sensors,
5 buttons, 4 switches, 4 selects, 1 number, 2 cameras, 1 event, 1 update, and
1 vacuum — plus two opt-in statistics sensors per mapped room.

- `vacuum`: primary robot state plus start/resume, pause, stop, dock, Area
  cleaning, named-room segments, and supported commands.
- `camera`: a visible-by-default labeled room map rendered from geometry and
  pose, plus a default-disabled photographic SLAM map. The latter contains
  private accumulated color/structure map data, so enable it only for users and
  dashboards that should see the interior map.
- `select`: default cleaning mode, default coverage, default cleaning plan, and
  selected custom cleaning area.
- `button`: run the default plan, intelligent-rotation override,
  top-to-bottom override, stop-plan-and-dock, and clean the selected custom area.
- `sensor`: activity, battery, rooms, cleaning history, active plan, next room,
  firmware/protocol/update/compatibility state, current area, Wi-Fi state and
  signal, schedules, local sessions, last run duration, dock/sink, coverage,
  Cues voice status, Cues gesture status, and two opt-in statistics sensors per
  mapped room (see [Room statistics](#room-statistics-and-the-recorder)).
- `update`: a read-only firmware surface in Home Assistant's update UI. The
  robot manages its own OTA installs and never reports the target version, so
  a pending update shows with an unknown latest version.
- `binary_sensor`: cleaning, paused, returning, charging, low charge, fully
  charged, problem, update available, Matter pairing mode, active cleaning
  session, robot SSH tunnel permission, robot diagnostic upload, and whether
  Cues is following a person.
- `switch` and `number`: robot settings such as child lock,
  pet-waste avoidance, Matic Cues, double-pass mopping, and water flow.
- `event`: live Cues voice, intent, gesture, and following transitions. Intent
  attributes are available to automations but excluded from Recorder history.

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

## Matic Cues

The **Matic Cues** switch controls the robot's verified local
`voice_enabled_command` setting. Enabling it is also consent to the robot's
separate Cues data handling: Matic documents wake-word, direction, and gesture
processing as on-device, audio after the chime as sent to Google Gemini, and
video as never sent. Read Matic's [Cues overview](https://maticrobots.com/hey-matic)
and [voice-data explanation](https://maticrobots.com/blog/how-your-voice-data-is-handled)
before automating the switch.

The integration subscribes to `kabuki_state` over the authenticated LAN session
and exposes only these bounded values:

- `sensor.matic_cues_voice_status`: disabled, ready for the wake word,
  listening, processing, classified, or rejected;
- `sensor.matic_cues_gesture_status`: target selection, target acceptance,
  no-target, facing-user, person-not-found, or following lifecycle;
- `binary_sensor.matic_following_person`: whether the robot reports active
  following;
- `event.matic_cues`: the most recent lifecycle transition.

The `matic_robot_cues` bus event carries `device_id`, `entry_id`, `event_type`,
and, only for `intent_classified`, an `intent`. Event types are `disabled`,
`ready`, `wake_word_detected`, `intent_processing`, `intent_classified`,
`intent_rejected`, `gesture_awaiting_pointed_target`,
`gesture_pointed_target_accepted`, `gesture_no_target_found`,
`gesture_facing_user`, `gesture_person_not_found`, `gesture_following`,
`following_started`, and `following_stopped`. Automation-safe intents are
`clean`, `clean_all`, `dock`, `go_away`, `navigate`, `pause`,
`redo_last_clean`, `resume`, `sink_summon`, `stop`, `follow_person`,
`point_to_clean`, and `unknown`.

For example, turn on a light while Matic is following someone:

```yaml
triggers:
  - trigger: event
    event_type: matic_robot_cues
    event_data:
      event_type: following_started
actions:
  - action: light.turn_on
    target:
      entity_id: light.hallway
```

Home Assistant never receives a transcript, audio, image, video, person
identity, pointing coordinate, or rejection detail. Recording-only intent
variants are withheld as `unknown`; recording and clip features remain outside
the integration.

## Complete cleaning action

`matic_robot.clean` supports any room subset or sequence,
`vacuum`/`mop`/`vacuum_and_mop`, Quick/Optimal/Heavy Duty coverage, and
ordered/unordered execution. The YAML values are `quick`, `standard`, and
`heavy_duty`; `standard` remains stable for compatibility while the UI uses
Matic's current Optimal label. Omitted rooms clean the whole floor; room names
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
   dropdowns, defaulting to Vacuum and Optimal.
4. Drag rooms or use arrow buttons to save the exact top-to-bottom order.
5. Optionally enable **Finish the current room when stopping** and choose its
   estimated progress threshold.
6. Submit once; the same screen edits every room and plan setting later.

A plan defines **what** to clean. Home Assistant schedules, presence
automations, buttons, and scripts decide **when** it runs.

## Painted custom areas

Open **Matic Map** from the Home Assistant sidebar, choose **Custom areas**,
and paint over the exact part of the private Photo or Rooms map that
should be cleaned. Use Erase for corrections and Move to navigate without
changing the selection. The same editor remains available through the integration's
**Configure → Custom cleaning areas** flow. A saved area
can cross room boundaries and keeps its own cleaning mode and coverage default.
Home Assistant stores the geometry locally and the action accepts only its
name. The saved record also binds it to the exact coverage mission, standard
partition, and canonical room geometry it was drawn on. A legacy unbound area,
remap, floor change, or geometry mismatch is blocked before any robot command.
Newly confirmed areas also retain a private signature of mapped geometry in
the union of a 25 cm margin around each painted mark, with a 10 mm guard band
for source-boundary selection. Supporting wall geometry is compared inside
those local neighborhoods with the same explicit 10 mm tolerance, so changes
elsewhere on the floor and sub-centimeter boundary jitter revalidate
automatically while mission,
partition, and nearby-geometry changes still fail closed. An exactly current
legacy v1 or hash-only v2 binding upgrades to the v3 scoped signature safely at
integration startup, so an area does not need to be repainted just to migrate.
Home Assistant raises
one privacy-safe Repair with only the number of affected areas and directs an
administrator to **Matic Map → Custom areas**. A same-mission area whose saved
marks remain valid is shown for review and can be rebound with **Confirm on
current map** without repainting. A mission or partition change, invalid
geometry, or marks outside the current floor still requires a redraw; no
automatic coordinate transform or cross-floor migration is attempted. A
temporarily unavailable live map reports that condition without creating or
clearing mismatch state.

The robot device page exposes the saved definitions through **Custom cleaning
area** and **Clean selected area**. Select an area once, then use the button in a
dashboard or automation without handling coordinates. Creating and changing
geometry remains in the private Matic Map workspace.

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

Administrators can open **Matic Map** from the Home Assistant sidebar. Its two
primary views use the same local map coordinate system:

- **3D** renders the accumulated color and structural point cloud. Mouse drag
  orbits; right-, middle-, or Shift-drag pans; and the wheel zooms. A trackpad
  uses two-finger pan, pinch zoom, twist rotation, and Option-scroll tilt.
- **2D** provides an aligned orthographic plan view for precise
  exploration. It supports pan, zoom, and rotation while remaining planar and
  keeps its framing separate from 3D. Its appearance selector switches between
  the photographic map and a centered labeled room map.

The compact map toolbar keeps Fit, the **Rooms** boundary-and-label overlay,
and **Custom areas** visible;
refresh, full screen, help, and 2D appearance live in the overflow menu.
The overlay repairs sparse self-intersections and separates discontinuous dense
cell-edge traces before projecting them over the photographic scene.
**Fit map** or `0` safely recenters the scene. Mouse movement stops on
release; touch retains momentum. Camera targets remain bounded so the house
cannot be stranded off-screen, and a transient refresh failure keeps the last
good 3D scene visible while the viewer reconnects. Full-screen, pointer, touch,
and keyboard controls are also available. If WebGL is unavailable or its
context is lost, the labeled local camera map stays visible across refreshes;
the retained 3D scene returns without another download when rendering recovers.
Clicking, dragging, or scrolling the map gives it keyboard focus, so the arrow
keys and shortcuts work immediately after mouse navigation without an extra
click. The studio loads one coherent scene, then holds a bounded authenticated
long-poll and applies compressed binary deltas. A stale base or inefficient
delta falls back to a complete scene in the same request. Select
**History · Live** beneath the map to open the scrubber above the control, browse
private time-spaced checkpoints, and return to live updates with **Live**. The
panel remains discoverable and explains when no checkpoints have been saved yet.
Checkpoints are capped at 12 items and 48 MiB compressed.

Multiple entries keep scene, pose, ETag, timeline, and fallback state isolated.
Unload clears browser buffers and backend scene caches. Catalog, scene, delta,
history, pose, and camera requests are time-bounded; the last usable map remains
visible during a transient failure. Pose and map pages have different cadences,
so the marker can briefly lag the robot. No guaranteed last-scanned timestamp is
available.

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
with the room least recently given a confirmed cleaning opportunity. Priority
changes only after the robot reports the commanded room as its current cleaning
area; a rejected command or the previous room's lingering `cleaning` state does
not move it. A successful clean also updates shared last-cleaned history. Failed,
cancelled, timed-out, or restart-interrupted rooms remain due, but a confirmed
start moves them behind rooms that waited longer so one problem room cannot
monopolize short runs. Saved room order breaks ties.

Room history advances only after the managed runner positively matches the end
of the commanded room. Returning, idle, or docked state alone is not completion:
a low-charge return is suspended and waits for the robot's automatic resume;
an unexplained stop receives no credit. The private protocol does not yet expose
a verified refill-specific signal. Consecutive rooms that share one cleaning
mode and coverage run as a single native mission (a leg), so the robot glides
room to room without docking. Room history still advances per room from the
leg's one native record: a room is credited only with its own completed status
and a positive duration, partial legs credit exactly their verified subset, and
everything else stays due. Between legs — current firmware queues a command
sent during a return — the runner dispatches the next leg at the observed
return and the robot briefly touches the dock. An unverified leg stops any
started next leg and receives no further credit, no next leg is prepared while
a native stop countdown settles, and only the final leg returns all the way to
the dock.

Motion commands are serialized per robot. An independent Home Assistant clean,
custom-area clean, stop, or dock revokes the managed plan before that command is
sent; pause and resume are serialized without revoking the resumable plan.

Stopping ends the robot's task with the OEM STOP command, because a DOCK sent
while a task is still running is reinterpreted as recharge-and-resume. Firmware
would then hold the robot in place for a ten-minute graceful countdown before
returning, so the integration watches that stop and sends DOCK as soon as the
task actually settles: the robot heads home in seconds instead. Docking is
withheld unless the robot is idle, its own session reports no active task, and
that stop still owns the robot, so a replacement clean, an unreadable robot, or
a return already under way all leave the firmware countdown in charge.
Commands sent by another client cannot be arbitrated before they reach the
robot, so an unexplained terminal transition is treated as interrupted rather
than completed.

The finish-current-room policy estimates progress from elapsed time versus
successful managed runs of the same stable room with the same cleaning mode and
coverage. Compatible samples are shared across plans on the same robot, so a new
plan does not need to relearn an unchanged room. Stored aggregate duration data
from earlier integration versions remains usable only when it represents at
least three successful runs. A stop below the configured threshold remains
immediate; at or above it, the current room completes and the robot docks: the
next leg is never dispatched, and inside a leg the managed STOP is sent at the
observed room boundary so later rooms remain due. Until a confident compatible duration exists,
enabling the policy means the current room finishes. Set the threshold to `0%`
to always finish it. This is a time-based estimate, not a measured area
percentage; pauses, recharge, and other delays can reduce its accuracy.

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

Plan actions accept human names or stable IDs where appropriate. Stable IDs take
precedence over colliding display names; ambiguous names are rejected rather
than resolved by map order. Action fields are defined in
`custom_components/matic_robot/services.yaml`.

## Payload-free endpoint inspection

`matic_robot.inspect_hermes_endpoint` returns a bounded fingerprint snapshot of
one allowlisted non-credential Hermes property or collection. It requires
exactly one Matic robot. Fields:

- `endpoint` (required): the property or collection to read, chosen from the allowlist in
  `services.yaml` (for example `wifi_status`, `schedule_events`, or
  `map_semantics`).
- `limit` (default `32`, range 1–256): maximum entries to return.

The response contains endpoint kind/sensitivity plus key/value sizes, SHA-256
hashes, and an optional value-free protobuf wire shape. A wire shape contains
only unique field-number/wire-type paths; repeated occurrences collapse, and
raw bytes are never returned through the public Home Assistant action. Nested
inspection is restricted to audited Kabuki lifecycle message paths and stops
before classified intent, rejection details, targets, coordinates, and media.
The typed registry routes single-value properties correctly instead of treating
every name as a collection stream.

## Firmware snapshots

`matic_robot.firmware_snapshot` checks all 40 known non-credential endpoints
with four-way bounded concurrency. It stores up to 52 payload-free snapshots in
Home Assistant and returns:

- firmware and protocol versions;
- populated, empty, and failed endpoint counts;
- endpoint kind, sensitivity, status, sizes, and hashes;
- availability/transport changes separately from ordinary content changes;
- newly added, bounded protobuf wire shapes as capability candidates.

When the coordinator observes a new firmware version, the integration fires
`matic_robot_firmware_changed` with previous and current firmware/protocol
values and starts the snapshot in the background. After comparison it fires the
silent `matic_robot_firmware_analyzed` event with compatibility counts, safe
candidate endpoint names, and their new wire paths. The Firmware compatibility
diagnostic sensor exposes the analysis version, structural totals, and candidate
counts. A checker-format upgrade causes one silent re-baseline snapshot on the
current firmware.

Structural candidates do not change the sensor from `compatible`, create a
Repair, send a persistent notification, or log a warning. A Home Assistant
Repair is created only when the snapshot finds endpoint availability or
transport drift, so ordinary weekly OTAs remain quiet. A structural candidate
means only that a field shape is new; it still requires synthetic fixtures and
human protocol evidence before becoming a decoded entity or command.
Snapshotting never promotes firmware to control-verified; physical write
validation remains deliberate.

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
  session summaries keep visited rooms separate from rooms whose native mode
  status proves completion. Interrupted and unknown room results never update
  per-room last-cleaned or duration sensors. Verified managed-room completion
  writes both sensors immediately, and storage migration repairs older global
  records from the newest verified per-plan completion without crediting an
  unverified room.

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
duration, completion flag, visited rooms, verified completed rooms, per-room
durations, the firmware version that produced the run, and the
`device_id`/`entry_id` of the robot — one payload for post-clean notifications
or custom logging.
`matic_robot_firmware_changed` likewise carries `device_id`/`entry_id` so
multi-robot homes can tell which robot updated.
`matic_robot_firmware_analyzed` is the silent post-snapshot result with safe
compatibility counts plus structural-candidate endpoint names and wire paths.
`matic_robot_cues` carries the same identifiers for safe voice/gesture lifecycle
and classified-intent automations; see [Matic Cues](#matic-cues).

Use ordinary state triggers and conditions on any telemetry, setting, Activity,
or binary sensor. This keeps automations composable with schedules, presence,
weather, energy prices, quiet hours, doors, alarms, helpers, templates, scenes,
scripts, and dashboards.

## Ready-to-import blueprints

- [Clean when everyone leaves](../blueprints/automation/matic_robot/clean_when_away.yaml)
- [Quiet-hours cleaning](../blueprints/automation/matic_robot/quiet_hours.yaml)
- [Pet-aware cleaning](../blueprints/automation/matic_robot/pet_aware.yaml)
- [Scheduled intelligent cleaning](../blueprints/automation/matic_robot/room_rotation.yaml)

Each blueprint calls the saved-plan actions and can be edited after import. The
**Clean when everyone leaves** blueprint rechecks that everyone is away after
its settle period and starts only while Matic is `docked` or `idle`; it never
replaces a cleaning already in progress.

## Fault semantics

The Activity sensor preserves numeric `hermes_state_codes` and
`hermes_error_codes` while also exposing automation-safe `errors` and
`primary_error` attributes such as `error_code_207`. These labels preserve the
exact robot value without guessing a meaning from the app's unrelated enum
ordering. A code must appear in two consecutive 30-second polls before the
Activity and Problem entities expose it; one-poll firmware pulses stay in debug
logs instead of creating misleading Logbook error entries.
