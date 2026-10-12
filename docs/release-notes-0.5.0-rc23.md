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

## Requirements

Home Assistant 2026.10 or later.

## Setup, Reconfigure and Repairs

- Adding a robot shows progress while it searches, skips robots already added,
  and asks only to turn on Pairing mode; the code field accepts the six-digit
  code directly. Errors name one cause and one next step.
- Reconfigure gains **Robot was reset**. It pairs the robot again over
  Bluetooth with a fresh code and keeps plans, custom areas and history. The
  "Can't confirm this is …" Repair now has a Fix button that leads there.
  Nothing is saved until the robot accepts the new pairing, and a different
  robot is never accepted in its place
  ([details](hermes-pairing.md#robot-was-reset)).
- Configure: reset room cleaning history for one plan or for all plans, each
  with its own confirmation; live updates move under **Advanced**.

## Actions and automations

- Everyday actions use the button names (Run plan, Stop cleaning, …);
  developer actions start with "Advanced:". Run and preview IDs are Advanced
  fields. Action errors are plain translated messages.
- New device triggers: Room finished, Plan finished and Cleaning finished.
- The five blueprints are renamed "Matic: …", describe every input, count a
  named zone as away, and run only when the robot is docked or idle. Re-import
  them to pick up the changes.

## Assistants

- "Matic: Robot status (administrators only)" can also run a plan, clean
  rooms, stop and reset a room schedule, through the same checks as Matic Map,
  and is offered to Assist. Firmware claim and complete move to a separate
  "Matic: Firmware research (administrators only)" API; agents that used them
  must select it.
- Non-administrators get no tools and a plain explanation.
