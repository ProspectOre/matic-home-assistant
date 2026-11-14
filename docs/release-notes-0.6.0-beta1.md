# Matic 0.6 beta 1

Unpublished candidate from `release/0.6`; publication needs owner testing and approval.
Guides: [Matic Map](map.md), [features](features.md), [actions](actions.md) and [entities](entities.md).

## Highlights

- **Cleaning history and the robot trail.** Matic Map lists recent cleans, how
  each one ended and the path the robot took.
- **Hold occupied rooms.** A plan can skip rooms whose occupancy or presence
  sensor is on when the run starts.
- **Sink refill and Go to room.** Send the robot to its sink location or to any
  room without cleaning it.
- **Change a running clean.** Skip a room, clean one next or clean one again
  while the robot is cleaning.
- **More of the Matic app.** Robot schedules on a calendar, no-go zones on the
  map, named robot alerts, maintenance reminders and an opt-in Wi-Fi signal map.

## Matic Map

- **3D robot.** The live robot is drawn as a 3D model that turns with the
  robot's heading.
- **Cleaning history.** Open **Cleaning history** to see recent cleans, newest
  first, with each room and custom area marked done, partly done, stopped or not
  started. Cleans started in the Matic app or by a robot schedule are listed
  too. Open history refreshes as delayed results arrive.
- **Map of each clean.** A clean in Cleaning history shows the robot's own map
  picture of it, for the recent cleans the robot still keeps.
- **How a clean ended.** A run says whether it finished, was stopped, ended
  after the current room with Smart Stop, ran low on battery, hit a robot
  problem or was taken over by another task.
- **Robot trail.** **Show trail on map** draws the path the robot took during a
  clean. The trail of a clean in progress grows as the robot moves.
- **No-go zones.** Zones set in the Matic app show on the map, read only, and a
  custom area that overlaps one says so.
- **Wi-Fi signal.** Turn on **Wi-Fi survey**, and the robot scans Wi-Fi every
  30 seconds while it's away from the dock. Open **Map options** and turn on
  **Wi-Fi signal** to see sampled locations, from green for strong to red for
  weak. Rings mark older, coarser readings; blank areas are unmeasured.
  **Clear Wi-Fi survey** starts over, for example after you move your router.
- **Carpet and vents.** Open **Map options** and turn on **Carpet and vents** to
  see the rugs and floor vents the robot has found, carpet in brown and vents in
  blue. Floor type changes made in the Matic app show up here too.
- **Follow the robot.** Turn on **Follow the robot** in **Map options** to keep
  the live robot centred. Moving the map yourself turns it off.
- **Live map updates.** As the robot maps, Home Assistant tells an open Matic
  Map that the map changed, and it downloads only the parts that changed. No
  request waits open in the meantime. If the connection to Home Assistant
  drops, the last map stays on screen while the status says **Reconnecting**,
  and it reloads when the connection returns. The map data's shape is defined
  once in the integration, and Matic Map's types are generated from it.
- **Cleaning phase and time left.** While the robot cleans, the status says
  whether it is cleaning the interior, edges or toekicks, and shows the robot's
  own estimate of the time left for the whole clean. The same values are
  available as the **Cleaning phase**, **Run progress** and **Time remaining**
  sensors, for cleans started anywhere. Matic Map reads the status from these
  sensors and the room from **Current room**; with one disabled, the status
  leaves that value out.

## Plans

- **Hold occupied rooms.** With **Hold occupied rooms** on, a plan leaves out
  rooms whose occupancy or presence sensor in the room's Home Assistant area is
  on when the run starts. A plan can name one sensor for a room instead.
- **Held rooms keep their place.** A held room isn't cleaned and stays first in
  line for the next Smart Order run. The Run view names the sensor holding each
  room, and each held room fires **Room held**.
- **One-time room clean.** Unsaved room runs started from Matic Map are now
  called **One-time room clean**.

## Sink refill and Go to room

- **Send to sink.** `vacuum.send_command` with `command: sink_summon` sends the
  robot to the sink location saved in the Matic app and waits up to 15 minutes
  for the refill.
- **Works mid-clean.** Sent during a clean, the robot keeps its task and the
  plan driving it, then carries on after the refill.
- **Go to room.** The **Go to room** action (`matic_robot.go_to_room`) and the
  `go_to_room` command send the robot to one room, by name or ID, without
  marking it cleaned. In Matic Map, pick one room and press **Go to room**.
- **Stay put and emotes.** The `stay_put` command keeps the robot where it is
  instead of returning to the dock, and `emote` with `kind: snap` takes a photo
  with the robot's camera that shows in the Matic app.
- **Clean again.** The `redo_last_clean` command repeats the robot's most
  recent finished clean, like **Clean again** in the Matic app. Tried once on
  a real robot, which started the same rooms as its last clean.

## Change a running clean

- **Skip, next and again.** **Skip room**, **Clean room next** and **Clean room
  again** change what the robot cleans next, as the queue sheet in the Matic
  app does. Each takes one room by name or ID and returns once the robot
  confirms the change. Clean room next hasn't been tried on a robot yet, so
  check the order the robot follows.
- **In plan runs.** A skipped room gets no credit and keeps its place, so the
  next run still treats it as due.

## Robot status

- **Robot schedules.** `calendar.matic_native_schedules` shows each enabled
  weekly schedule from the Matic app, with its rooms and cleaning mode. Schedule
  details stay out of Recorder.
- **Robot alert.** The alert sensor names a full or missing bag, and either one
  raises a Repair with the fix until the robot stops reporting it. Confirmed
  faults stay visible when other codes change; 207/220 use reporter-observed labels.
- **Maintenance suggested.** On while the robot's newest monthly recap suggests
  maintenance; its `recap_month` attribute names the month. The recap doesn't say
  which part yet, so check the brush roll, side brush, mop roll, caster and wedge.
- **Bag pass ends.** Shows when an active bag pass runs out.
- **Robot camera photos.** **Take photo** asks the robot to take a picture,
  and **Latest photo** shows the newest one, including photos taken in the
  Matic app. Use it on a dashboard or attach it to a phone notification.
- **Photo patrol.** Opt in and set no-photo rooms, then request photos from
  one or more rooms. Notifications use pixelated previews by default. The
  **Matic: Photograph room on alert** blueprint uses the same privacy, battery,
  schedule and cooldown checks. See [Photo patrol](photo-patrol.md).

## Automations

- **Cleaning run.** The new event entity `event.matic_cleaning_run` records
  each run event, from a plan starting to the robot's own Cleaning finished,
  with the event's fields as attributes. Trigger on it with Home Assistant's
  event entity trigger. See [run events](automation-events.md#run-events-in-automations-the-logbook-and-the-dashboard).
- **Plan started.** A run now fires `matic_robot_plan_started` when it begins,
  with the fields that name the run in Plan finished.
- **Device triggers for every run event.** Plan started, each room and custom
  area event, Plan docked and the rest join Room finished, Plan finished and
  Cleaning finished, which keep their names.
- **Logbook.** Run events show in the logbook against the robot, for example
  "Matic finished cleaning Kitchen".
- Every existing event keeps its name and fields.

## Working with the Matic app

- **Room statistics.** Completed room results reported by the robot can update sensors
  for app-started and scheduled cleans. Late corrections retract only the affected
  mode; plan schedules and daily completion counts keep their separate rules.
  Credits: [0.5.1 notes](https://github.com/ProspectOre/matic-home-assistant/releases/tag/v0.5.1).
- **Plans give way.** When the app, the robot's button, voice or a robot
  schedule takes over, a running plan ends as taken over and never sends a
  command to win the robot back.
- **Time zone Repair.** If the robot's time zone would run its schedules at a
  different local time than Home Assistant's, a Repair says so.
- **Finished or stopped.** The Cleaning finished event and the Robot cleaning
  runs sensor say whether a run finished on its own or was stopped. When
  the robot reports an ending Matic doesn't recognise yet, they say `unknown`.
- See [Working alongside the Matic app](coexistence.md) for the full rules.

## Assistant tools

- **Sink and rooms.** Assist and MCP can send the robot to the sink or a room.
- **Recent runs, schedules and zones.** New read-only tools list recent cleans
  and why each ended, the robot's schedules with the runs coming up, and the
  no-go zones with the rooms they cover.
- **Read-only API.** **Matic: Robot status, read-only** gives an agent or MCP
  client the read tools alone. The API 0.5 called **Matic: Robot status** is
  now **Matic: Robot status and control**; agents and MCP servers set up with
  it keep every tool. See [assistant tools](assistant-tools.md).
- **Exposure applies everywhere.** MCP clients and conversation agents now see
  only robots whose vacuum is exposed to Assist, as Assist already did.

## Removed in 0.6

Matic 0.6 removes 14 entities, 6 actions and 4 attributes that repeated
something else. Matic 0.5.4 warned about them in Settings > Repairs. On its
first start, 0.6 deletes the 14 entities from Home Assistant, enabled or not,
and a call to a removed action fails. Update the automations, scripts,
dashboards and templates that still use one.

- **Cleaning order for one run.** Run plan (`run_selected_plan`) takes an
  optional `run_behavior`: `intelligent` for Smart Order or `ordered` for Saved
  order. Leave it out to use the order saved with the plan.
- **Error names.** The Problem sensor's `errors` attribute names the robot's
  current errors.
- **Imported blueprints.** A Matic cleaning blueprint imported before 0.5.4
  calls a removed action. The Repair **Matic blueprints need an update** has a
  Submit button that switches your copies to Run plan with the same cleaning
  order and reloads your automations.
- **Runs in progress.** A plan run that was started with a removed action
  carries on after the update as a Run plan run.

Entity IDs assume a robot named "Matic".

| Removed | Use instead |
| --- | --- |
| `intelligent_clean` (Run Smart Order) | `run_selected_plan` with `run_behavior: intelligent` |
| `clean_entire_plan` (Run saved order) | `run_selected_plan` with `run_behavior: ordered` |
| `select_plan` | `select.select_option` on `select.matic_saved_cleaning_plan` (Default cleaning plan), which is off until you enable it |
| `save_plan_room`, `move_plan_room`, `delete_plan_room` | `save_plan` with the plan's whole room list, or the plan editor in Matic Map |
| `button.matic_intelligent_clean`, `button.matic_clean_entire_plan` | `button.matic_run_selected_plan` (Run plan), or `run_selected_plan` with `run_behavior` |
| `button.matic_stop_intelligent_cleaning` | `vacuum.stop` on `vacuum.matic` |
| `binary_sensor.matic_paused`, `binary_sensor.matic_returning` | `vacuum.matic` in state `paused` or `returning` |
| `sensor.matic_activity` | The state of `vacuum.matic`: `ready` reads `idle`, and `charging` reads `docked` with `binary_sensor.matic_charging` on. Its `errors` are on `binary_sensor.matic_problem`, where the first item is what `primary_error` held. Its error codes are the `codes` attribute of `sensor.matic_robot_alert`, and `current_area` is `sensor.matic_current_area` |
| `binary_sensor.matic_fully_charged` | `sensor.matic_battery` at 100 while `binary_sensor.matic_charging` is on |
| `sensor.matic_rooms` | The `rooms` attribute of `vacuum.matic`, which maps each room ID to its name |
| `sensor.matic_update_state`, `sensor.matic_update_channel` | The `update_state` and `update_channel` attributes of `update.matic_firmware` |
| `sensor.matic_scheduled_cleanings` | `calendar.matic_native_schedules` (Robot schedules) |
| `sensor.matic_protocol_version`, `sensor.matic_dock_detections`, `sensor.matic_sink_summon_locations` | The device page's Download diagnostics file. Automations cannot read it |
| Attributes `charging` and `problem` of `vacuum.matic` | `binary_sensor.matic_charging` and `binary_sensor.matic_problem` |
| Attributes `current_area` and `low_charge` of `vacuum.matic` | `sensor.matic_current_area` (Current room) and `binary_sensor.matic_low_charge` |

## Deprecated, removed in 0.7

`vacuum.send_command` with `start`, `clean_all`, `clean_rooms`,
`clean_segments`, `pause`, `stop`, `dock` or `return_home` still works in 0.6,
and the first use of each logs a warning. Matic 0.7 removes them.

| Deprecated | Use instead |
| --- | --- |
| `start`, `clean_all` | `matic_robot.clean` without `rooms` |
| `clean_rooms`, `clean_segments` | `matic_robot.clean` with `rooms` |
| `pause`, `stop` | `vacuum.pause`, `vacuum.stop` |
| `dock`, `return_home` | `vacuum.return_to_base` |

## Before you update

- Update from 0.5.4. 0.6 also reads what 0.5.0 to 0.5.3 stored, but only the
  update from 0.5.4 is tested. From 0.4 or older, install 0.5.4 first and
  restart once; then install 0.6. If 0.6 finds a configuration older than
  0.5's it leaves it untouched, does not start and shows a Repair asking for
  0.5.4.
- Run plan (`run_selected_plan`) and Clean room sequence
  (`clean_room_sequence`) now return once the robot has started the run, with
  its `run_id`, instead of when the run ends. An automation that waited for the
  clean to finish, or caught a failed run as a failed action, needs `wait: true`;
  see [actions](actions.md#cleaning).
- An MCP client or conversation agent using the Matic assistant tools sees
  only robots whose vacuum is exposed under **Settings > Voice assistants >
  Expose**. Expose the vacuum if a tool says no robot is exposed.
- Matic 0.6 needs the same robot firmware as 0.5 and keeps your plans, room
  schedules and map history.
- Matic actions are now actions of the robot's vacuum entity. They take the
  same fields and targets and return the same responses. A user who isn't an
  administrator now needs control of every entity a target names, not only the
  vacuum.
- Each floor's Area mapping moves from the vacuum's entity options to Matic's
  own storage, and 0.6 leaves 0.5's copy in the options. Restoring the backup
  returns the mappings the backup held, and the next update moves them again.
- Make a Home Assistant backup before installing. 0.6 stores saved maps and
  the Wi-Fi survey in a new format that 0.5 can't read, so going back means
  restoring that backup, which also returns both to what the backup held. The
  survey keeps its older one-metre readings when it upgrades.
- 0.6 converts saved custom areas to a new format when it starts. After that,
  going back to 0.5.4 hides those areas until they are redrawn, and plans that
  use them won't run there. Restoring the backup brings them back. An area 0.6
  can't match to the current map keeps its old format and its Repair.
- Custom areas saved before 0.5 that 0.5 never updated must be redrawn. 0.6
  lists them as invalid, with a Repair, and plans that use them won't run
  until they are.
- Restoring a backup on a real Home Assistant host has not been tried yet. The
  [upgrade and rollback drill](upgrade-drill.md) covers it on test data only.
- HACS installs `matic_robot.zip` from the release. For a manual install,
  unpack that zip into `custom_components/matic_robot`; the repository's source
  no longer contains the built Matic Map.

## Checks still needed

Interior phase labels are inferred from one capture; follow/run-map pictures need hardware checks.
The photo trial used equivalent manual commands; Photo patrol has not run installed.
Beta 1 is blocked pending live-stream/map-update reconnect, loss/order, authorization, polling, host and device qualification.
Robot state now arrives only by push (no user toggle and no polling fallback); the map, position and settings are still read on a schedule, every 5 minutes while docked and every 30 seconds while the robot is out. A robot that never serves the state subscription would show as unavailable; no robot has been checked for this. The hoped-for 70% reduction in requests has not been shown.
