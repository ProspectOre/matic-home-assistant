# Working alongside the Matic app

Matic in Home Assistant shares the robot with the Matic app, the robot's
button, voice, gestures, Matter and the robot's own schedules. These rules keep
the two sides from fighting. Every change that reads robot state or sends a
command follows them, and its pull request says which rules it touches.

## The robot holds the truth

Rooms, zones, schedules, settings and maps are read from the robot on every
poll or push. Home Assistant keeps no copy that could override them. When the
floor plan or room set changes in the app, saved plans are checked again and
missing rooms are reported, as custom areas already are.

## Who started or stopped a clean is known

The robot records where each command came from (app, button, voice, gesture,
Matter or Atrium) and why a session ended. Home Assistant shows both in history,
in the Cleaning finished event and on the activity sensor, so an automation can
tell a Home Assistant run from an app run. Field numbers come from the
decompiled app and read-only captures, never from guesses; until a field is
confirmed, the source is reported as `unknown`.

## A plan gives way

A managed plan owns the robot only while it runs. If the app, voice, the button
or a native schedule starts, stops or replaces its task, the plan ends as taken
over, with the source when the robot reports one. It never sends another command
to win the robot back. A session the robot ends as replaced by a schedule ends
the plan the same way.

## No conflicting commands

Motion commands go out only when the robot is free or Home Assistant holds the
task, under the existing command leases. Where the robot acknowledges a command,
Home Assistant waits for the answer and reports a refusal instead of retrying.
Skip and prioritize act on the robot's own queue, as the app does, so both see
the same queue.

## Writes are explicit, checked and reversible

Home Assistant writes the robot's own data (names, rooms, zones, schedules)
only from a direct user action, not from an automation by default. None of the
app's write commands carries a revision or confirmation, so after each write
Home Assistant reads the collection back and reports a write that does not show
up within a timeout as failed. A write that can be undone says how. Deleting a
map, deleting a floor and factory reset stay in the app.

## Native schedules and plans don't collide

The schedules calendar shows the robot's own runs. Home Assistant never edits or
turns off a native schedule as a side effect of anything else.

The robot starts its schedules on its own clock. When its time zone gives a
different local time than Home Assistant's at any point in the coming year,
Home Assistant raises a Repair, and clears it once the two match. Two names for
the same clock, such as `US/Pacific` and `America/Los_Angeles`, count as a
match. Changing the robot's time zone stays in the app.

## Shared words

Use the app's names for rooms, floors, modes and coverage: Vacuum, Mop, Vacuum
and mop; Quick, Optimal, Heavy duty. App 1.181 renamed the VACUUM mode to SWEEP;
values written by either side read the same.

## Protocol drift is visible

The app's protocol list stops at version 27 while current firmware reports 28.
The [firmware compatibility checks](firmware-compatibility.md) raise a Repair
when a field Matic uses changes, and each new collection goes into the
[endpoint map](firmware-endpoint-map.md) with the protocol version it was seen
on.
