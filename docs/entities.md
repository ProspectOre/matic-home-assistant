# Entities and controls

[Documentation](README.md) · [Automations](automation.md)

Build dashboards, adjust settings, and use cleaning results in automations.
Enable per-room statistics to track each room’s last clean and successful duration.

Each robot has 54 fixed entities — 24 sensors, 11 binary sensors, 5 buttons,
4 switches, 4 selects, 1 number, 2 cameras, 1 event, 1 update, and 1 vacuum,
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
| Run plan · Stop cleaning | `button.matic_run_selected_plan` · `button.matic_stop_intelligent_cleaning` | off |
| Run Smart Order · Run saved order | `button.matic_intelligent_clean` · `button.matic_clean_entire_plan` | off |
| Clean custom area | `button.matic_clean_selected_area` | off |
| Default cleaning mode · Default vacuum coverage | `select.matic_cleaning_mode` · `select.matic_coverage` | on |
| Default cleaning plan · Custom cleaning area | `select.matic_saved_cleaning_plan` · `select.matic_custom_cleaning_area` | off |
| Child lock · Pet-waste avoidance | `switch.matic_child_lock` · `switch.matic_pet_waste_avoidance` | on |
| Cues voice assistant · Double-pass mopping | `switch.matic_voice_assistant` · `switch.matic_deep_mop` | on |
| Wi-Fi survey · Clear Wi-Fi survey | `switch.matic_wifi_survey` · `button.matic_clear_wifi_survey` | on |
| Mopping water flow (0.5× to 2.0×) | `number.matic_water_flow` | on |
| Map · 3D photo map | `camera.matic_map` · `camera.matic_photorealistic_map` | on · off |
| Cues | `event.matic_cues` | on |
| Firmware | `update.matic_firmware` | on |
| Activity · Battery · Rooms | `sensor.matic_activity` · `sensor.matic_battery` · `sensor.matic_rooms` | on |
| Current room | `sensor.matic_current_area` | on |
| Rooms cleaned by plans | `sensor.matic_cleaning_history` | on |
| Active cleaning plan · Next room to clean | `sensor.matic_active_cleaning_plan` · `sensor.matic_next_cleaning_room` | on |
| Current room active cleaning time | `sensor.matic_current_room_active_time` | on |
| Current room expected duration | `sensor.matic_current_room_expected_duration` | on |
| Current room estimated progress | `sensor.matic_current_room_estimated_progress` | on |
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

Wi-Fi survey is off until you turn it on. While it is on and the robot is
off the dock, the robot runs one Wi-Fi scan every 30 seconds, the same scan the
Matic app runs while its Wi-Fi screen is open. Each signal reading is stored
against the robot's map position and shown in Matic Map: open **Map options** and turn on
**Wi-Fi signal**. A reading is kept only if the robot moved less than two metres
during the scan, which takes about seven seconds. Clear Wi-Fi survey deletes
the readings, for example after you move your router.

Paused, Returning to dock and Fully charged repeat **Activity**, so they start
disabled. The status sensors (Activity, Firmware check status, Update status,
Wi-Fi status, both Cues statuses) offer their states as a pick list in the
automation editor. Duration sensors store seconds: room timing and coverage time
suggest minutes, Last clean duration suggests hours, and you can choose another
unit. Existing unit choices stay, and fields ending in `_seconds` stay seconds.

The three current-room sensors refresh together every five seconds, without
extra robot requests. They cover the room a plan or a one-time room clean from
Matic Map is cleaning, while the robot reports it as the current room; active
time excludes pauses. Expected duration is the median of up to seven successful
samples, with at least three required. Samples can come from different plans
but must match the room, cleaning mode and vacuum coverage; each combination
keeps its own estimate across restarts and setting changes. Double-pass mopping
and water flow don't split estimates. Without that history, expected duration
and percentage stay unknown. Matic Map and Smart Stop use the same estimate,
which can be up to five seconds behind. Even **Estimated 100%** does not prove
completion, so use confirmed room results for completion automations. A custom
area, or a run Home Assistant can't match to the current room, has no estimate.

## Controls

Use Matic Map for plans, room selection, and custom areas, or the standard vacuum
controls for a full-floor clean, pause/resume, Stop, and dock; the vacuum's Stop
follows a running plan's Smart Stop setting. Default mode and coverage appear
under **Configuration**. The five specialized buttons and the plan/area selectors
are opt-in dashboard and automation shortcuts; existing enabled choices and
entity IDs are preserved.

The plan buttons have the same names as their actions: **Run plan** runs the
default plan the way it is saved, **Run Smart Order** cleans the rooms and
custom areas that have waited longest first, and **Run saved order** cleans
them top to bottom; a plan runs in one or more [parts](cleaning.md#how-a-plan-runs).
They are unavailable until the map is ready and the default plan can run. **Stop
cleaning** is available only while a plan or a one-time room clean from Matic
Map runs, and never asks for confirmation; the plan's Smart Stop setting decides
whether the current room finishes first. **Clean custom area** cleans the area
chosen in **Custom cleaning area**, so enable both. **Next room to clean** names
the first room or custom area of the default plan's next run; its `preview`
attribute holds the whole preview.

## Maps

`camera.matic_map` provides a labeled room map for dashboards. The photographic
SLAM camera is disabled by default; enable it from the device's entity list if
needed. Both return PNG images. Administrators also get the **Matic Map** panel.

## Firmware

The firmware update entity is read-only; the robot installs updates itself and
doesn't publish the new version number in advance. While it reports an update,
the latest version reads "Newer than" the installed version (or "Newer
firmware" if that is unknown), in Home Assistant's language. **Skip** lasts
until that text changes: after the robot installs firmware or when Home
Assistant's language changes. A second update offered before the robot installs
the first stays skipped. With no installed version, Home Assistant shows the
update's state as unknown, so there is nothing to skip. The device page shows
the software and hardware versions.

If **Problem** turns on, `sensor.matic_activity` names the reported conditions
in `errors` and `primary_error` and keeps their numeric codes in
`hermes_error_codes`; a code with no known meaning appears as `error_code_<n>`.
An error must persist across two normal polls before it appears, which filters
brief firmware pulses. Recorded activity can help diagnose an error after it clears.

## Room statistics and the recorder

Each room's **Last cleaned** and **Last clean duration** sensors are disabled
by default. Enable them to retain room-specific history and duration statistics.
The robot-wide **Last clean duration** is recorded by default. Room sensors
show the latest confirmed result, whatever its cleaning mode and coverage.

Room lists, SSID, schedules, detailed run results, and plan history remain
available to templates through `state_attr()` but are excluded from Recorder
attributes. See [privacy](privacy.md) for stored data and event data.

## Matic Cues

Voice and gesture sensors, a following-person binary sensor, and the Cues event
entity expose robot-reported lifecycle changes. The integration receives no
transcripts, media, or pointing coordinates. Enabling the Cues voice assistant
switch also activates [Matic's voice processing](privacy.md#matic-cues).

## Entity ID history

The one-time 0.2 migration renamed older numbered IDs where possible. 0.5
removed four duplicate entities once, on its first start; see the
[release notes](release-notes-0.5.0.md#before-you-update) for replacements.
User-assigned names and IDs are preserved.

## Assistant tools

See [Assistant and MCP tools](assistant-tools.md) for administrator access,
status and cleaning actions, and the separate firmware research tools.
