# Room schedules

[Cleaning guide](cleaning.md) · [Actions](actions.md)

These optional schedules are part of the 0.5 development branch. Existing
plans keep their fixed settings until you enable a room schedule.

## Choose the work and interval

Open a saved plan in Map Studio or the integration's **Configure** flow.
For each room, you can independently enable:

- Mopping: vacuum normally, then vacuum and mop every N verified cleans.
- Coverage: use the normal coverage, then the chosen periodic coverage every
  N verified cleans. Quick, Optimal, and Heavy Duty can be used in any pairing.

Intervals range from 1 to 100. A new interval of 3 applies periodic work on
the third qualifying clean. If both rules are due, that clean includes both.
**Do on next clean** requests periodic work once without resetting progress.

## Choose where progress is shared

**This plan** keeps settings and progress private to that plan.
**Shared for this room** lets participating plans and tracked Map Studio room
cleans use the same schedule and progress.

Creating a schedule starts at zero. Joining an existing shared schedule adopts
its progress. Leaving it for a new private schedule starts fresh for that
plan; other participants keep their shared progress. Review the explanation
beside the scope choice before saving.

Creating or joining a shared schedule requires the verified live floor.
If the map is being checked, keep the draft and retry once the floor is ready.
Room renames preserve progress; an uncertain room or floor identity cannot
carry progress to another map.

## One-time room cleans

Map Studio room cleans use an existing shared schedule by default and do not
create a saved plan. Choose **Override shared schedule settings** to use your
selected settings for that clean. Compatible verified work still counts;
omitting a due mode or coverage leaves that work due.

Review the effective room order, modes, coverage, and due-work explanations
before starting. Map Studio refreshes that preview at Start; if it changed,
review the updated settings before starting again. A failed preview keeps your
selection and offers **Retry preview**.

Starts from the Matic app, physical controls, and custom-area cleans do not
advance room schedules. Existing Home Assistant service calls keep their
behavior; tracked schedule use is explicit through `use_room_schedule` on
`matic_robot.clean_room_sequence`. Its `override_room_schedule` option keeps
your supplied settings while retaining compatible completion accounting.
Each room may appear only once in a room sequence. Repeated IDs or room-name
aliases are rejected because completion and recovery are recorded per room.

## Understand progress and results

Only verified completed room work advances progress. Partial, failed, stopped,
skipped, and unverified work does not. A due rule stays due until the requested
mode and coverage are confirmed. Delayed results and restart recovery cannot
count the same clean twice.

Changing an interval preserves progress. Disabling a rule pauses it. Use the
separate **Reset mopping** or **Reset coverage** action to start that interval
fresh; cleaning history is kept separately. A shared reset affects every
participant in that room's shared schedule. Edits and resets wait while the
affected room is queued, running, or its result is being verified.

The current run keeps the settings accepted when it started. Review the next
run separately; changing future preferences does not rewrite running work.
