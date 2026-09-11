# Cleaning results

[Documentation](README.md) · [Automation events](automation.md#events-and-observability)

History keeps separate vacuum and mop results for each room: **completed**,
**partial**, **unattempted**, or unknown, with a duration for each mode.
An absent result does not explain why a room was skipped.

A vacuum-and-mop clean needs both modes completed with positive durations.
Vacuum-only and mop-only runs need the corresponding mode. Visiting a room,
docking, or ending the overall mission does not mark a room cleaned.

Managed plans match results to their own run. A partially completed mission
credits only completed rooms and does not start the next settings group.
Older saved history is not rewritten.

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

A native result does not identify why a mission ended. Firmware can report a
stopped room as completed; managed plans also verify ownership and the terminal
transition. A requested stop followed by docking can succeed while unfinished
rooms remain due. See [activity diagnostics](activity-diagnostics.md).
