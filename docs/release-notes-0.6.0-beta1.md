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
- **Robot photos.** Take a photo, browse photos in Matic Map and send the robot
  on photo tours.
- **More of the Matic app.** Robot schedules on a calendar, no-go zones on the
  map, bag alerts, maintenance reminders and an opt-in Wi-Fi signal map.

## Matic Map

- **Cleaning history.** Recent cleans, newest first, with each room and custom
  area marked done, partly done, stopped or not started. Cleans started in the
  Matic app or by a robot schedule are listed too.
- **How a clean ended.** Finished, stopped, ended after the current room by
  Smart Stop, low battery, a robot problem, or another task took over.
- **Map of each clean.** Open a clean to see the robot's own map picture of it,
  for the recent cleans the robot still keeps.
- **Robot trail.** **Show trail on map** draws the path the robot took. The
  trail of a clean in progress grows as the robot moves.
- **3D robot.** The live robot is a 3D model that turns with its heading.
- **Follow the robot.** Keeps the live robot centered. Moving the map yourself
  turns it off. **Ride along in 3D** also turns the view with the robot.
- **Floors.** In a home with more than one mapped floor, the floor menu lists
  them and the live map follows the robot to its floor. If the map doesn't
  load, **Try again** reads it again.
- **No-go zones.** Zones set in the Matic app show on the map, read only. A
  custom area that overlaps one says so.
- **Wi-Fi signal.** Turn on the robot's **Wi-Fi survey** switch, and the robot
  scans Wi-Fi every 30 seconds while it's away from the dock. In **Map
  options**, turn on **Wi-Fi signal** to see the signal in four bands, from
  Strong to Dead zone. Blank areas are unmeasured. **Clear Wi-Fi survey** starts
  over, for example after you move your router.
- **Carpet and vents.** In **Map options**, turn on **Carpet and vents** to see
  the rugs and floor vents the robot has found: carpet in brown, vents in blue.
- **Photos.** Browse the robot's photos by tour, star, download and compare
  them with earlier ones, and add viewpoints on the map for photo tours.
- **Status while cleaning.** The status shows whether the robot is cleaning the
  interior, edges or toekicks, and the robot's estimate of the time left. The
  same values are the **Cleaning phase**, **Run progress** and **Time
  remaining** sensors, for cleans started anywhere.
- **Reconnecting.** The live map updates as the robot maps. If the connection
  to Home Assistant drops, the last map stays on screen while the status says
  **Reconnecting**.

## Plans

- **Hold occupied rooms.** With **Hold occupied rooms** on, a plan leaves out
  rooms whose occupancy or presence sensor in the room's Home Assistant area is
  on when the run starts. A plan can name one sensor for a room instead.
- **Held rooms keep their place.** A held room isn't cleaned, and under Smart
  Order it is first in line for the next run. The Run view names the sensor
  holding each room, and each held room fires **Room held**.
- **Rooms removed from the map.** If a map edit in the Matic app removes a room
  a plan uses, a Repair names the plans to update.
- **One-time room clean.** Unsaved room runs started from Matic Map are called
  **One-time room clean**.

## Robot commands

- **Send to sink.** `vacuum.send_command` with `command: sink_summon` sends the
  robot to the sink location saved in the Matic app and waits up to 15 minutes
  for a refill. Sent during a clean, the robot keeps its task and carries on
  after the refill.
- **Go to room.** The **Go to room** action (`matic_robot.go_to_room`) and the
  `go_to_room` command send the robot to one room, by name or ID, without
  marking it cleaned. In Matic Map, pick one room and press **Go to room**.
- **Stay put and emotes.** The `stay_put` command keeps the robot where it is
  instead of returning to the dock. `emote` with `kind: snap` takes a photo
  with the robot's camera.
- **Clean again.** The `redo_last_clean` command repeats the robot's most
  recent finished clean, like **Clean again** in the Matic app.
- **Skip, next and again.** **Skip room**, **Clean room next** and **Clean room
  again** change what the robot cleans next, as the queue sheet in the Matic
  app does. Each takes one room by name or ID and returns once the robot shows
  the change. In a plan run, a skipped room keeps its place, so the next run
  still treats it as due.

## Robot status

- **Robot schedules.** `calendar.matic_native_schedules` shows each enabled
  weekly schedule from the Matic app, with its rooms and cleaning mode.
  Schedule details stay out of Recorder.
- **Robot alert.** Names a full or missing bag. Either one raises a Repair with
  the fix, which clears when the robot stops reporting it.
- **Maintenance suggested.** On while the robot's newest monthly recap suggests
  maintenance; its `recap_month` attribute names the month. The recap doesn't
  say which part, so check the brush roll, side brush, mop roll, caster and
  wedge.
- **Bag pass ends.** Shows when an active bag pass runs out.
- **Photos.** **Take photo** asks the robot to take a picture, and **Latest
  photo** shows the newest one, including photos taken in the Matic app.
- **Photo tours.** Turn them on and choose no-photo rooms under **Photo privacy
  and safety**, then send the robot to rooms and saved viewpoints to photograph
  each. Notification links show pixelated previews by default. The **Matic:
  Photo check on alert** blueprint runs one when a sensor turns on. See
  [Photo tours](photo-tours.md).
- **Time zone Repair.** If the robot's time zone would run its schedules at a
  different local time than Home Assistant's, a Repair says so.

## Automations

- **Cleaning run.** The event entity `event.matic_cleaning_run` records each
  run event, from a plan starting to the robot's own Cleaning finished, with
  the event's fields as attributes. See
  [run events](automation-events.md#run-events-in-automations-the-logbook-and-the-dashboard).
- **Plan started.** A run fires `matic_robot_plan_started` when it begins.
- **Device triggers for every run event.** Plan started, each room and custom
  area event, Plan docked and the rest join Room finished, Plan finished and
  Cleaning finished.
- **Logbook.** Each run event shows once in the logbook, for example "Matic
  Cleaning run: Room finished".
- **How a clean ended.** The Cleaning finished event and the Robot cleaning runs
  sensor say whether a clean finished on its own or was stopped, and `unknown`
  for any other ending.
- **Plans give way.** When the Matic app, the robot's button, voice or a robot
  schedule takes over, a running plan ends as taken over and never sends a
  command to win the robot back. See [Working alongside the Matic app](coexistence.md).

## Assistant tools

- **Sink and rooms.** Assist and MCP clients can send the robot to the sink or
  a room.
- **Recent runs, schedules and zones.** New read-only tools list recent cleans
  and how each ended, the robot's schedules and their next runs, and the no-go
  zones with the rooms they cover.
- **Read-only API.** **Matic: Robot status, read-only (administrators only)**
  gives an agent or MCP client the read tools alone. The API 0.5 called
  **Matic: Robot status (administrators only)** is now **Matic: Robot status
  and control (administrators only)**; agents and MCP servers set up with it
  keep every tool. See [assistant tools](assistant-tools.md).

## Removed in 0.6

Matic 0.6 removes 14 entities, 6 actions and 4 vacuum attributes that repeated
something else. On its first start, 0.6 deletes the 14 entities from Home
Assistant, enabled or not, and a call to a removed action fails. Matic 0.5.4
and 0.5.5 show a Repair for a removed action when it runs and for a removed
entity something still uses. Update the automations, scripts, dashboards and
templates that use one.

- **Cleaning order for one run.** Run plan (`run_selected_plan`) takes an
  optional `run_behavior`: `intelligent` for Smart Order or `ordered` for Saved
  order. Leave it out to use the order saved with the plan.
- **Imported blueprints.** A Matic cleaning blueprint imported before 0.5.4
  calls a removed action. The Repair **Matic blueprints need an update** has a
  Submit button that switches your copies to Run plan with the same cleaning
  order and reloads your automations.
- **Runs in progress.** A plan run started with a removed action carries on
  after the update as a Run plan run.
- **Internal event.** Home Assistant no longer fires the undocumented
  `matic_robot_native_history_updated` event.

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

- **Update from 0.5.4 or 0.5.5.** From anything older, install 0.5.4 first and
  restart once, then install 0.6. If 0.6 finds a configuration from 0.4 or
  plans last saved by 0.5.0 or older, it changes nothing, doesn't start and
  shows a Repair asking for 0.5.4. Your current release still runs on that
  data. 0.6 can't tell 0.5.1 to 0.5.3 from 0.5.4 and starts on them.
- **Back up first.** Make a Home Assistant backup before installing. To go back
  to 0.5, restore that backup. 0.5 can't read the saved maps 0.6 writes, and it
  hides custom areas 0.6 converted, so plans that use them won't run there
  until the areas are redrawn.
- **Run plan returns sooner.** Run plan (`run_selected_plan`) and Clean room
  sequence (`clean_room_sequence`) now return once the robot has the run's
  first command, with its `run_id`, instead of when the run ends. An automation
  that waited for the clean to finish, or caught a failed run as a failed
  action, needs `wait: true`; see [actions](actions.md#cleaning).
- **Assistant tools follow exposure.** An MCP client or conversation agent
  using the Matic assistant tools sees only robots whose vacuum is exposed
  under **Settings > Voice assistants > Expose**. Expose the vacuum if a tool
  says no robot is exposed.
- **Actions belong to the vacuum.** Matic actions are now actions of the
  robot's vacuum entity, with the same fields, targets and responses. A user
  who isn't an administrator needs control of every entity a target names, not
  only the vacuum.
- **Old custom areas.** Custom areas saved before 0.5 that 0.5 never updated
  must be redrawn. A Repair lists them, and plans that use them won't run until
  they are.
- **What carries over.** Your plans, room schedules and saved maps carry over.
- **Install.** HACS installs `matic_robot.zip` from the release. For a manual
  install, unpack that zip into `custom_components/matic_robot`.
