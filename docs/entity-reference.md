# Entity reference

[Entities and controls](entities.md) · [Automations](automation.md)

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
| Take photo · Latest photo | `button.matic_take_photo` · `image.matic_latest_photo` | on |
| Robot schedules | `calendar.matic_native_schedules` | on |
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
| Cleaning phase · Run progress · Time remaining | `sensor.matic_cleaning_phase` · `sensor.matic_run_progress` · `sensor.matic_time_remaining` | on |
| Firmware check status · Update status | `sensor.matic_firmware_compatibility` · `sensor.matic_update_state` | on |
| Cues voice status · Cues gesture status | `sensor.matic_cues_voice_status` · `sensor.matic_cues_gesture_status` | on |
| Wi-Fi status · Wi-Fi signal | `sensor.matic_wifi_state` · `sensor.matic_wifi_signal` | off |
| Update channel · Protocol version | `sensor.matic_update_channel` · `sensor.matic_protocol_version` | off |
| Coverage time · Scheduled cleanings | `sensor.matic_coverage_time` · `sensor.matic_scheduled_cleanings` | off |
| Robot cleaning runs | `sensor.matic_local_cleaning_sessions` | off |
| Dock detections · Sink summon locations | `sensor.matic_dock_detections` · `sensor.matic_sink_summon_locations` | off |
| Cleaning · Charging · Low charge · Problem | `binary_sensor.matic_cleaning` · `_charging` · `_low_charge` · `_problem` | on |
| Robot alert · Bag full · Bag missing | `sensor.matic_robot_alert` · `binary_sensor.matic_bag_full` · `_bag_missing` | on |
| Following a person | `binary_sensor.matic_following_person` | on |
| Maintenance suggested | `binary_sensor.matic_maintenance_suggested` | on |
| Bag pass ends | `sensor.matic_bag_pass_expires` | on |
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
disabled. The status sensors (Activity, Cleaning phase, Firmware check status, Update
status, Wi-Fi status, both Cues statuses) offer their states as a pick list in the
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

Cleaning phase, Run progress and Time remaining come from the robot and cover
any clean, including one started in the Matic app or by a robot schedule. They
are unknown when no clean is under way. Cleaning phase names the part of the
room being cleaned: interior, edges or toekicks. Time remaining is the robot's
own estimate for the whole clean, read every 30 seconds; Run progress is the
time spent so far as a share of that time plus the time remaining. Adding rooms
to a running clean raises the estimate, so Run progress can step back.
