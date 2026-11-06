# Matic 0.6 beta 1

Unpublished candidate from `release/0.6`; publication needs owner testing and approval.

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

- **3D robot.** The live map marker turns with the robot’s heading.
- **Cleaning history.** Open **Cleaning history** to see recent cleans, newest
  first, with each room and custom area marked done, partly done, stopped or not
  started. Cleans started in the Matic app or by a robot schedule are listed
  too. Open history refreshes as delayed results arrive.
- **Map of each clean.** A clean in Cleaning history shows the robot's own map
  picture of it, for the recent cleans the robot still keeps.
- **How a clean ended.** A run says whether it finished, was stopped, ended
  after the current room with Smart Stop, ran low on battery, hit a robot
  problem or was taken over by another task.
- **Trail and cleaning coverage.** Use **Trail**, **Vacuum** and **Mop** to see the recorded path and observed cleaning coverage.
  In a saved clean, choose **Show trail on map** to revisit its path.
- **No-go zones.** See zones set in the Matic app and check whether a custom area overlaps one.
- **Wi-Fi signal.** Turn on **Wi-Fi survey** to collect a reading every 30 seconds away from the dock.
  Choose **Wi-Fi** to see surveyed floor, **Compare sampled spots** to highlight differences, or **Clear Wi-Fi survey** to start over.
- **Carpet and vents.** Select **Carpet** or **Vents** to see the robot’s detections and floor edits from the Matic app.
  A carpet outline can cover part of a rug.
- **Follow the robot.** Select **Follow** to center the robot or **Ride along** to turn with it. Moving the map turns tracking off.
- **Cleaning phase and time left.** While the robot cleans, the status says
  whether it is cleaning the interior, edges or toekicks, and shows the robot's
  own estimate of the time left for the whole clean. The same values are
  available as the **Cleaning phase**, **Run progress** and **Time remaining**
  sensors, for cleans started anywhere.

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
  details stay out of Recorder. The 0.5.1 fixes preserve every acknowledged
  schedule, Monday-first weekdays, enabled state and ordered/unordered room lists.
- **Robot alert.** The alert sensor names a full or missing bag, and either one
  raises a Repair with the fix until the robot stops reporting it. Confirmed
  faults stay visible when other codes change; 207/220 use reporter-observed labels.
- **Maintenance suggested.** On while the robot's newest monthly recap suggests
  maintenance, with a Repair naming the month. The recap doesn't say which part
  yet, so check the brush roll, side brush, mop roll, caster and wedge.
- **Bag pass ends.** Shows when an active bag pass runs out.
- **Robot camera photos.** **Take photo** asks the robot to take a picture,
  and **Latest photo** shows the newest one, including photos taken in the
  Matic app. Use it on a dashboard or attach it to a phone notification.
- **Photo patrol.** Opt in and set no-photo rooms, then request photos from
  one or more rooms. Notifications use pixelated previews by default. The
  **Matic: Photograph room on alert** blueprint uses the same privacy, battery,
  schedule and cooldown checks. See [Photo patrol](photo-patrol.md).

## Working with the Matic app

- **Room statistics.** Completed room results reported by the robot can update sensors
  for app-started and scheduled cleans. Late corrections retract only the affected
  mode; plan schedules and daily completion counts keep their separate rules.
  Contributor credits are in the [0.5.1 notes](release-notes-0.5.1.md).

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

- **Sink and rooms.** Assist and MCP can send the robot to the sink or to a
  room.
- **Recent runs, schedules and zones.** New read-only tools list recent cleans
  and why each ended, the robot's schedules with the runs coming up, and the
  no-go zones with the rooms they cover.

## Before you update

- Matic 0.6 needs the same robot firmware as 0.5 and keeps your plans, room
  schedules and map history.
- Keep a matching 0.5.0 backup before installing. The isolated
  [upgrade and rollback drill](upgrade-drill.md) checks synthetic plans, areas,
  schedules and history; the owner's snapshot and host restore remain
  unqualified. The [installed check](installed-check.md) needs the owner's go.
- The finer Wi-Fi survey upgrades its storage to version 2 while retaining
  older one-metre readings. Older integration versions cannot read that store;
  rolling back requires the matching pre-upgrade backup. A restore also returns
  the survey to the readings captured in that backup.

## Checks still needed

Interior phase labels are inferred from one capture; follow/run-map pictures need hardware checks.
The photo trial used equivalent manual commands; Photo patrol has not run installed.
Beta 1 is blocked pending live-stream/map-update reconnect, loss/order, authorization, polling, host and device qualification.
Push starts automatically when supported (no user toggle); older backends use polling, and Matic keeps checking status on a schedule. This may add network traffic and Home Assistant load; the hoped-for 70% reduction in requests has not been shown.

See [Matic Map and features](features.md), [Actions](actions.md) and [Entities](entities.md).
