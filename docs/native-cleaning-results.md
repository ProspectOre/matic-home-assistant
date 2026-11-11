# Cleaning results

[All guides](README.md) · [Automation events](automation.md#events-and-observability) ·
[Interrupted cleaning](activity-diagnostics.md)

The robot records a vacuum result and a mop result for every room it is sent
to: **completed**, **partial**, **unattempted** or unknown, each with a
duration. The integration counts a room as cleaned only from that record.

## What counts as cleaned

- A vacuum-and-mop clean needs both modes completed with a duration above zero.
  A vacuum-only or mop-only clean needs that one mode.
- Visiting a room, docking or the whole clean ending does not mark a room
  cleaned. A missing result does not say why a room was skipped.
- A stop followed by docking can succeed while unfinished rooms stay due. The
  robot can report a stopped room as completed, so a plan also checks that it
  still owned the clean and how the clean ended
  ([interrupted cleaning](activity-diagnostics.md)).
- Partial or completed work changes a room's place in the rotation;
  unattempted work does not.

For completion automations, use `matic_robot_room_completed` or the room's
**Last cleaned** sensor. The `latest_mode_results` attribute is live only and
is not recorded.

## Plans

A plan runs in one or more parts ([how a plan runs](cleaning.md#how-a-plan-runs)):
consecutive rooms share one, each custom area gets its own, and with Smart Stop
on each room gets its own. Each room is checked against the robot's record of
the part that plan started, so a partly finished part counts only its completed
rooms.

The robot's summary of a custom area names no room or area. An area counts as
finished when the part the plan started for it ends normally while the plan
still owns the robot. A finished area updates that area's history, never a
room's schedule. **Plan finished** reports `completed` only when every room is
confirmed and every area's part has finished.

## Cleans started outside Home Assistant

Room **Last cleaned** and **Last clean duration** also count cleans started in
the Matic app or by a robot schedule, when the robot reports a completed mode
with a duration above zero. These cleans never create a plan run.

**App-started cleanings**, on by default in the integration's options, also
lets them advance [room schedules](room-schedules.md):

- Counting starts when the option is turned on, with no backfill. Turning it
  off keeps earlier counts. Creating or rebinding a shared schedule starts a
  new count.
- A clean counts only with a known starter, matching floor and room, a finished
  ending and completed modes with durations. Cancelled, partial and unclear
  records never count.
- Cleans Home Assistant started are never counted a second time this way.
- A clean from the app counts as a scheduled vacuum level only when its record
  shows that level, and it never clears a one-time request such as **Mop on
  the next clean**.
- Each room keeps up to 1,024 completion and reset records. Past that, progress
  can't be confirmed and its shared schedules wait until you reset both
  room-schedule counters. Saved plans and run history are kept.

History matches the robot's own IDs for the clean, the floor and the room, so a
late record updates the right room while another floor is active and a renamed
room keeps its history. An unknown room ID never falls back to a name. Older
records without IDs match only a unique room name on a single known floor.
`statistics_source` on each sensor says which kind of match was used, and
`native_statistics_blocked_reason` says why a statistic is withheld. Reading
history twice never counts work twice, and a newer partial clean does not erase
an older completed one.

## Rooms the robot could not reach

When a plan sends the robot to a room it cannot enter, such as one behind a
closed door, the robot ends that clean and docks. The integration reads the
record of the clean it started: a single-room record that finished with every
requested mode **unattempted** means the room was unreachable. The Matic app
shows the same record as **Area inaccessible**.

The room closes as **Couldn't reach** without credit and stays due, and the
plan moves on to the next room. `matic_robot_room_skipped` fires with
`reason_code: room_unreachable` and `cause: robot`.

Any other ending still ends the plan with `reason_code: native_task_ended`: a
clean the user or the robot cancelled, one with no stop reason, or one where
the robot got into the room. Only a different active task is reported as
`native_task_taken_over`. [Protocol notes](protocol-notes.md#cleaning-history-coverage_session_history)
has the fields behind this.

## Durations and estimates

- A room's **Last clean duration** uses the robot's work time for that room
  when the result has it, otherwise the active time Home Assistant tracked.
  The newest result wins, and a plan's result wins a tie.
- The robot's own **Last clean duration** is the latest clean from start to
  end, so it can differ from the room figures.
- Durations are stored in seconds. Rooms show minutes and whole cleans hours by
  default; changing the unit changes nothing else.
- **Current room expected duration** is the median of up to the last seven
  confirmed durations for that room with the same cleaning mode and coverage.
  It and **Current room estimated progress** stay unknown until three exist.
  Progress stops at 100% and never marks a room finished.

## History for assistants

The administrator-only assistant history has the same per-mode detail. Supply
`cleaning_mode` so the completion flags and durations match the work that was
asked for; without it the flags can be empty. A finished event keeps the
robot's own room summary, labelled as such, beside separate vacuum, mop and
combined completion counts. That summary does not say which mode a plan asked
for.
