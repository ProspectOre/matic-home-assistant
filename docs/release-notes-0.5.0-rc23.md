# v0.5.0-rc23

RC23 makes the Home Assistant surfaces read as one plain thing about the robot.
Entity IDs and unique IDs stay the same, so dashboards and automations keep
working; only names, defaults and four duplicate entities change.

## Entity changes

### Renamed

Only the names Home Assistant shows change; each entity ID stays as it was.

| Entity ID | Old name | New name |
| --- | --- | --- |
| `button.matic_run_selected_plan` | Start default plan | Run plan |
| `button.matic_intelligent_clean` | Start intelligent rotation | Run intelligent rotation |
| `button.matic_clean_entire_plan` | Clean all rooms in default plan | Run saved order |
| `button.matic_stop_intelligent_cleaning` | Stop plan and dock | Stop cleaning |
| `sensor.matic_current_area` | Current area | Current room |
| `sensor.matic_cleaning_history` | Plan room completions | Rooms cleaned by plans |
| `sensor.matic_last_run_duration` | Last run duration | Last clean duration |
| `sensor.matic_local_cleaning_sessions` | Local cleaning sessions | Robot cleaning runs |
| `sensor.matic_firmware_compatibility` | Firmware compatibility | Firmware check status |
| `binary_sensor.matic_ssh_tunnel_permission` | Robot SSH tunnel permission | Support tunnel permission |
| `binary_sensor.matic_diagnostic_upload` | Robot diagnostic upload | Diagnostic upload |
| `switch.matic_voice_assistant` | Matic Cues | Cues voice assistant |

IDs assume a robot named "Matic". A robot that reports no name is now called
"Matic (Unofficial)" followed by the last four characters of its host name, and
the device model reads "Robot".

### Removed

The first start of this release removes four duplicate entities, once.
Automations that still use them show them as unavailable; switch to the
replacement.

| Removed entity | Use instead |
| --- | --- |
| `binary_sensor.matic_active_cleaning_session` (Active cleaning session) | `binary_sensor.matic_cleaning` (Cleaning) |
| `binary_sensor.matic_update_available` (Update available) | `update.matic_firmware` (Firmware) |
| `sensor.matic_software_version` (Software version) | the device's software version |
| `sensor.matic_hardware_revision` (Hardware revision) | the device's hardware version |

To restore them, downgrade to RC22.

### States, units and defaults

- Activity, Firmware check status, Update status, Wi-Fi status and both Cues
  statuses list their states, so the automation editor offers a pick list.
  Cues and firmware states use plain words ("Command understood", "Checks
  recorded for comparison", "Some robot reads are failing", "Up to date").
- Coverage time is a duration and shows as time; Mopping water flow shows "×".
- Disabled by default for new installs: Paused, Returning to dock and Fully
  charged (they repeat Activity), Update channel and Protocol version.
  Scheduled cleanings, Robot cleaning runs and the Cues statuses move to
  Diagnostic.
- While the robot reports a pending update, the Firmware entity says the robot
  installs it itself.

Existing installs keep their current enabled or disabled choices.
