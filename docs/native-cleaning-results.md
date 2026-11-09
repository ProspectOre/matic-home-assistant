# Cleaning results

[Documentation](README.md) · [Automation events](automation.md#events-and-observability)

Use room results to build completion notifications and last-cleaned dashboards.
History keeps separate vacuum and mop results for each room: **completed**,
**partial**, **unattempted**, or unknown, with a duration for each mode.
An absent result does not explain why a room was skipped.

A vacuum-and-mop clean needs both modes completed with positive durations.
Vacuum-only and mop-only runs need the corresponding mode. Visiting a room,
docking, or ending the overall mission does not mark a room cleaned.

Managed plans match results to their own run. A partially completed mission
credits only verified completed rooms. Older saved history is not rewritten.
An older record the integration cannot decode does not stop a plan from
starting, as long as it still identifies its cleaning session. If it doesn't,
the plan won't start (`native_history_incomplete`) and the error says why;
plans can start again once the robot drops that record. For an owned mission,
Home Assistant waits for the history record with the same session ID, even
if other retained records arrive late or cannot be decoded. If the run's
own record is missing or unreadable, its rooms remain due.

A plan runs as one or more native missions: consecutive rooms share one, each
custom area is its own, and with Smart Stop on each room is its own. Each room
is checked against the robot's record of its own mission. The robot's summary
of a drawn area carries no room or area name, so the integration does not use
it: an area counts as finished when the mission the run started for it,
identified by the session ID the integration generated, ends normally while
the run still owns the robot. A finished area updates that area's history,
never a room's mop or vacuum schedule. **Plan finished** reports `completed`
only when every room is verified and every area's mission has finished.

Partial or completed work affects rotation priority; unattempted work does not.
For completion automations, use `matic_robot_room_completed` or **Last cleaned**.
The `latest_mode_results` sensor attribute is available live but excluded from
Recorder. Administrator-only MCP history includes the same per-mode detail.

For MCP history, supply `cleaning_mode` so the completion flags and durations
match the work requested. Without one, native per-mode results have unspecified
scope and nullable completion flags. Finished events retain their existing native
room summary, explicitly labeled as such, and provide separate positive-duration
vacuum, mop, and combined completion counts. The native summary does not identify
the mode requested by a plan.

Room **Last cleaned** and **Last clean duration** also accept app-started and
app-scheduled cleans when the robot reports an explicit completed vacuum or
mop result with a positive duration. Both completed modes contribute to that
room's duration; incomplete or ambiguous modes do not. These statistics do not
create managed plan runs or advance plan-only schedules.

Canonical history uses the robot's mission, partition and room UUIDs. Verified
saved-floor bindings allow delayed records to update the correct shared schedule
while another floor is active. It can
resolve a room across multiple saved floors and room renames; an unknown UUID
never falls back to a name. Legacy records without this identity remain limited
to a unique room-name match on a single known floor. Both sensors explain
withheld statistics through `native_statistics_blocked_reason`.

The integration setting **App-started cleanings** is enabled by default. It
lets successful external room cleanings advance shared room schedules. Counting
starts when the option is first activated or re-enabled, without historical
backfill. Turning it off preserves earlier credit; subsequent corrections to
already counted records still retract or revise it. Creating or rebinding a
shared schedule also starts a new counting boundary.

Credit requires a known initiator, matching floor/room identities, a completed
modern summary, a finished stop reason, and positive completed-mode durations.
Cancelled, partial, ambiguous and malformed records cannot earn this credit.
The integration reserves its own session IDs before sending managed commands,
including plan-only runs, direct HA starts and custom areas, so their native
history cannot be counted again as an app-started clean.
Native cleans do not satisfy a requested vacuum strength without setting proof
or clear an explicit next-clean request. Shared resets remain effective after
replay. Saved plan run history and managed completion counts stay separate.

`statistics_source` distinguishes canonical robot identity matching, legacy
name matching, managed results and restored values. Repeated reads do not
count work twice. Corrections to one session can add or retract a mode, while
an unrelated newer partial run does not erase an older successful clean.
The [OEM replay evidence](native-history-floor-evidence.md) establishes parser
semantics. [PR #391](https://github.com/ProspectOre/matic-home-assistant/pull/391)
records the implementation and its independent source and deployment checks.

## Physical observations

On November 1, 2026, two separately observed normal vacuum cleans completed on
floor A and floor B, lasting 379 and 259 seconds respectively. The robot returned
to its original dock with no reported errors. These physical observations are
independent of the offline OEM decoder replay and do not qualify integration
history parsing, runtime deployment, or managed-run completion. Household room
names and raw device evidence remain private.

A later beta2 app-started vacuum, with two saved floors retained, reported 479
seconds of room work; the corresponding room duration matched. A temporary
shared schedule advanced once, remained at one after the option was toggled
off/on and the integration reloaded, and was then removed. Managed run counts
and plan-only cadence stayed unchanged. This is one installation's evidence,
not a claim about every firmware or floor configuration.

For a managed result, **Last clean duration** uses native per-room work time
when supplied by completion, otherwise tracked active room time. The room
sensors prefer the newest result, with managed evidence preferred on a tie.
The whole-robot **Last clean duration** uses the latest session timing;
Home Assistant can prefer a matching locally tracked active session when the
native summary lacks mode results. Native MCP history separately reports the
session's start-to-end duration and each mode's work duration. These measurements
can differ. Durations are stored in seconds; room durations display in minutes
and whole cleans in hours by default, and changing display units does not
change their scope.

**Current room expected duration** is the median of up to the last seven verified
durations for that room with the same cleaning mode and coverage, across plans.
It and **Current room estimated progress** stay unknown until three such
durations exist. Estimated progress measures active time against that
estimate, stops at 100%, and never marks a room finished.

Modern native history separates why a mission stopped from mode completion.
Firmware can report a stopped room as completed; managed plans also verify
ownership and the terminal transition. A requested stop followed by docking can succeed while unfinished
rooms remain due. See [activity diagnostics](activity-diagnostics.md).
