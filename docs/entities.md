# Entities and controls

[Documentation](README.md) · [Automations](automation.md)

Build dashboards, adjust settings, and use cleaning results in automations.
Enable per-room statistics to track when each room was last cleaned and how
long successful cleaning took.

Each robot has 51 fixed entities — 21 sensors, 11 binary sensors, 5 buttons,
4 switches, 4 selects, 1 number, 2 cameras, 1 event, 1 update, and 1 vacuum —
plus two opt-in statistics sensors per mapped room.

## Names and entity IDs

Home Assistant shows each name after the device name. Entity IDs come from a
fixed key, not the name, so renaming an entity never changes its ID. The IDs
below assume a robot named "Matic"; substitute the device name shown on your
device page. A robot that reports no name is called "Matic (Unofficial)"
followed by the last four characters of its host name. Entities marked "off"
are disabled by default; enable them from the device's entity list.

| Name | Entity ID | Default |
| --- | --- | --- |
| (the robot) | `vacuum.matic` | on |
| Run plan · Stop cleaning | `button.matic_run_selected_plan` · `button.matic_stop_intelligent_cleaning` | on |
| Run intelligent rotation · Run saved order | `button.matic_intelligent_clean` · `button.matic_clean_entire_plan` | off |
| Clean custom area | `button.matic_clean_selected_area` | on |
| Default cleaning mode · Default vacuum coverage | `select.matic_cleaning_mode` · `select.matic_coverage` | on |
| Default cleaning plan · Custom cleaning area | `select.matic_saved_cleaning_plan` · `select.matic_custom_cleaning_area` | on |
| Child lock · Pet-waste avoidance | `switch.matic_child_lock` · `switch.matic_pet_waste_avoidance` | on |
| Cues voice assistant · Double-pass mopping | `switch.matic_voice_assistant` · `switch.matic_deep_mop` | on |
| Mopping water flow (×) | `number.matic_water_flow` | on |
| Map · 3D photo map | `camera.matic_map` · `camera.matic_photorealistic_map` | on · off |
| Cues | `event.matic_cues` | on |
| Firmware | `update.matic_firmware` | on |
| Activity · Battery · Rooms | `sensor.matic_activity` · `sensor.matic_battery` · `sensor.matic_rooms` | on |
| Current room | `sensor.matic_current_area` | on |
| Rooms cleaned by plans | `sensor.matic_cleaning_history` | on |
| Active cleaning plan · Next room to clean | `sensor.matic_active_cleaning_plan` · `sensor.matic_next_cleaning_room` | on |
| Last clean duration | `sensor.matic_last_run_duration` | on |
| Firmware check status · Update status | `sensor.matic_firmware_compatibility` · `sensor.matic_update_state` | on |
| Cues voice status · Cues gesture status | `sensor.matic_cues_voice_status` · `sensor.matic_cues_gesture_status` | on |
| Wi-Fi status · Wi-Fi signal | `sensor.matic_wifi_state` · `sensor.matic_wifi_signal` | off |
| Update channel · Protocol version | `sensor.matic_update_channel` · `sensor.matic_protocol_version` | off |
| Coverage time · Scheduled cleanings | `sensor.matic_coverage_time` · `sensor.matic_scheduled_cleanings` | off |
| Robot cleaning runs | `sensor.matic_local_cleaning_sessions` | off |
| Dock detections · Sink summon locations | `sensor.matic_dock_detections` · `sensor.matic_sink_summon_locations` | off |
| Cleaning · Charging · Low charge · Problem | `binary_sensor.matic_cleaning` · `_charging` · `_low_charge` · `_problem` | on |
| Following a person | `binary_sensor.matic_following_person` | on |
| Paused · Returning to dock · Fully charged | `binary_sensor.matic_paused` · `_returning` · `_fully_charged` | off |
| Matter pairing mode | `binary_sensor.matic_matter_pairing_mode` | off |
| Support tunnel permission · Diagnostic upload | `binary_sensor.matic_ssh_tunnel_permission` · `_diagnostic_upload` | off |

Paused, Returning to dock and Fully charged repeat **Activity**, so they start
disabled. The status sensors (Activity, Firmware check status, Update status,
Wi-Fi status, both Cues statuses) offer their states as a pick list in the
automation editor. Durations are reported in seconds and shown as time.

## Controls

The plan buttons have the same names as their actions: **Run plan** runs the
default plan with its saved behavior, **Run intelligent rotation** cleans the
rooms that have waited longest first, and **Run saved order** cleans them top to
bottom. **Stop cleaning** never asks for confirmation; the plan's saved stop
policy decides whether the current room finishes before the robot docks.

## Maps

`camera.matic_map` provides a labeled room map for dashboards. The photographic
SLAM camera is disabled by default; enable it from the device's entity list if
needed. Administrators can use the interactive **Matic Map** sidebar panel.

## Firmware

The firmware update entity is read-only; the robot installs updates itself.
While the robot reports an update, the latest version reads "Newer than" the
installed version (or "Newer firmware" if that is unknown), in Home Assistant's
language; the robot does not publish the new version number in advance. **Skip**
hides the update only while that text stays the same: it shows again after the
robot installs firmware (the installed version changes) or when Home Assistant's
language changes, but a second update offered before the robot installs the
first stays skipped. With no installed version the text stays "Newer firmware"
and Home Assistant shows the update's state as unknown, so there is nothing to
skip. The device page shows the software and hardware versions.

If **Problem** turns on, inspect `sensor.matic_activity`:

- `errors` and `primary_error` identify reported conditions.
- `hermes_error_codes` preserves numeric codes; unknown meanings appear as `error_code_<n>`.

Errors must persist across two normal polls before they appear, filtering brief
firmware pulses. Recorded activity can help diagnose an error after it clears.

## Room statistics and the recorder

Each room's **Last cleaned** and **Last clean duration** sensors are disabled
by default. Enable them to retain room-specific history and duration statistics.
The robot-wide **Last clean duration** is recorded by default.

Room lists, SSID, schedules, detailed session results, and plan history remain
available to templates through `state_attr()` but are excluded from Recorder
attributes. See [privacy](privacy.md) for stored data and event payloads.

## Matic Cues

Voice and gesture sensors, a following-person binary sensor, and the Cues event
entity expose robot-reported lifecycle changes. The integration receives no
transcripts, media, or pointing coordinates. Enabling the Cues voice assistant
switch also activates [Matic's voice processing](privacy.md#matic-cues).

## Entity ID history

The one-time 0.2 migration renamed older numbered IDs where possible. 0.5
removed four duplicate entities once, on its first start; see the
[release notes](release-notes-0.5.0-rc23.md#entity-changes) for replacements.
User-assigned names and IDs are preserved.

## Assistant tools

Two LLM APIs serve Assist conversation agents and Home Assistant's MCP server.
Only administrators get tools; anyone else gets no tools and a one-line prompt
to ask an administrator.

**Matic: Robot status (administrators only)** reads robot status, a plan's next
run, robot-reported history, recent events and command activity
(`MaticGetOperations`, `MaticGetPlan`, `MaticGetNativeHistory`,
`MaticGetRecentEvents`, `MaticGetActivity`, `MaticGetFirmware`). Its write tools
use Matic Map's own actions and checks: `MaticRunPlan` (a plan name or the
default plan), `MaticCleanRooms` (room names and a cleaning mode),
`MaticStopCleaning` and `MaticResetSchedule` (mopping or vacuum rotation progress
for one room or a whole plan). When Matic Map would refuse, the tool returns the
same reason instead. Assist agents get these tools, prefixed `matic_robot__`,
when the robot is exposed to Assist.
Recent events keep room and final-state evidence separate from the
[command and raw-state observation trail](activity-diagnostics.md).
Dust-bag observations are available through `MaticGetOperations` only.

**Matic: Firmware research (administrators only)** reads the
[firmware intelligence inbox](firmware-intelligence.md) (`MaticGetFirmware`) and
claims and completes research (`MaticClaimFirmwareInvestigation`,
`MaticCompleteFirmwareInvestigation`). It writes research records only, never a
robot command, and is reachable only from an MCP client that selects it.
