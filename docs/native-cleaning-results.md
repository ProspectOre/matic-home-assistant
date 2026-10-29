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

Room **Last clean duration** uses the verified managed-room timing: native
per-room work time when supplied by completion, otherwise tracked active room
time. The whole-robot **Last clean duration** uses the latest session timing;
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

A native result does not identify why a mission ended. Firmware can report a
stopped room as completed; managed plans also verify ownership and the terminal
transition. A requested stop followed by docking can succeed while unfinished
rooms remain due. See [activity diagnostics](activity-diagnostics.md).
