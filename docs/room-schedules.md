# Room schedules

[Cleaning guide](cleaning.md) · [Actions](actions.md)

Room schedules are optional. Existing plans keep their fixed settings until
you turn on a schedule for a room.

## Choose the work and how often

Open a saved plan in Matic Map, choose **Edit**, then open a room. Its
**Schedule** has two rows, each set with **−** and **+** or by typing 1 to 100
(empty is Off):

- **Mop**: vacuum normally, then vacuum and mop every few cleans. It needs the
  room's cleaning mode to be Vacuum.
- **{Level} vacuum**: a vacuum rotation at the level you pick (Quick, Optimal or
  Heavy duty; a new rotation starts at Heavy duty) every few cleans. Mop-only
  rooms can't use it; a rotation left on such a room shows **Turn off**.

Under each row, a line says when the work is next due: "Due in 3 cleans",
"Due next clean", "Due every clean" or "Not scheduled". A schedule of 3 runs on
the third counted clean, and when both are due that clean includes both.
The switch below the rows, such as **Mop on the next clean**, brings the work
forward once without resetting progress; the schedule then continues as usual.

## Choose where progress is shared

New schedules count cleans **Across all plans**, so every plan that uses the
room shares one schedule and its progress. To keep a schedule to one plan, open
**Advanced** and choose **In this plan only** under **Count cleans**. The
`save_plan` action still counts progress in that plan only unless you pass
`scope: shared`.

When a room already has a shared schedule, turning on either row uses it: the
rows show the shared values, read-only until you save, and saving picks up any
progress already counted. Choose **In this plan only** first to set your own
values instead. Leaving a shared schedule starts new progress for this plan;
other plans keep theirs. The line under the rows says what saving will do. If
the shared schedule needs a cleaning mode this room doesn't use, turning a row
on counts in this plan only.

Creating or joining a shared schedule requires the live floor. If the map is
being checked, keep the draft and retry once the floor is ready. Room renames
keep progress; a room Home Assistant can't match to the current map can't carry
progress to it.

## One-time room cleans

Matic Map room cleans use an existing shared schedule by default and do not
create a saved plan. When scheduled work is due, **Cleaning settings** shows
**Use room schedules**, turned on; turn it off to use only your settings for
that clean. This works for vacuum, mop, and vacuum and mop cleans. Compatible
confirmed work still counts, skipped work stays due for the next clean, and a
mop-only clean never resets a vacuum rotation that's due.

Each selected room shows what will run under its name, and lines above the
rooms explain due work and any extra passes. Matic Map refreshes that check
when you start; if it changed, review the updated settings before starting
again. A failed check keeps your selection and offers **Try again**.

Starts from the Matic app, physical controls, and custom-area cleans do not
advance room schedules. Existing Home Assistant service calls keep their
behavior; tracked schedule use is explicit through `use_room_schedule` on
`matic_robot.clean_room_sequence`. Its `override_room_schedule` option keeps
your supplied settings while retaining compatible completion accounting.
Each room may appear only once in a room sequence. Repeated IDs or room-name
aliases are rejected because completion and recovery are recorded per room.

## Understand progress and results

Only confirmed completed room work advances progress. Partial, failed, stopped,
skipped, and unconfirmed work does not. A due rule stays due until the requested
mode and coverage are confirmed. When a vacuum rotation is due, it remains due
until Home Assistant can confirm that a clean used the selected setting; it can therefore
be requested again on later cleans. Delayed results and restart recovery cannot
count the same clean twice.

Changing how often keeps progress. Turning a schedule off pauses it. To start
one fresh, open the room in a saved plan's **Edit** view and choose **Reset
mopping** or **Reset vacuum rotation** from the room's menu (for example **More
for Kitchen**). It asks
before resetting and works while the robot is idle, the map is live and the
plan has no unsaved changes; cleaning history is kept separately. A shared reset affects every
participant in that room's shared schedule. Edits and resets wait while the
affected room is queued, running, or its result is still being confirmed.

The current run keeps the settings accepted when it started. Review the next
run separately; changing future preferences does not rewrite running work.
