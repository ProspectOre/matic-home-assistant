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

## Who started or stopped a clean

The robot records where each command came from (app, button, voice, gesture,
Matter or Atrium) and why a session ended. The Cleaning finished event and the
cleaning sessions sensor show the stop reason as `finished` or `stopped`, the
two values matched to known runs; anything else reads `unknown`. The source,
and the other reasons such as a schedule replacing the task, wait for their
own captures. Field numbers come from the decompiled app and captures, never
from guesses.

## A plan gives way

A managed plan owns the robot only while it runs. If the app, voice, the button
or a native schedule starts, stops or replaces its task, the plan ends as taken
over, including when a native schedule replaces the task. It never sends
another command to win the robot back. The source of the take-over is added
once the history fields above are mapped.

## No conflicting commands

Motion commands go out only when the robot is free or Home Assistant holds the
task, under the existing command leases. The robot sends no acknowledgement for
user commands (the app's acknowledged-command call is unused), so Home Assistant
confirms a command by the state it reads back. Skip and prioritize, when they
are added, act on the robot's own queue as the app does, so both see the same
queue.

## Writes are explicit, checked and reversible

Home Assistant does not yet write the robot's names, rooms, zones or schedules.
When it does, it writes only from a direct user action, not from an automation
by default. None of the app's write commands carries a revision or
confirmation, so after each write Home Assistant reads the collection back and
reports a write that does not show up within a timeout as failed. A write that
can be undone says how. Deleting a map, deleting a floor and factory reset stay
in the app.

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
