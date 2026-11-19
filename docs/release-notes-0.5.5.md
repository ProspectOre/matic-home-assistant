# Matic 0.5.5

`MaticGetPlan` now reports the most recent finished run for each plan: its
selected rooms, rooms reported as complete, start and end times, and outcome. It
marks the room list and completion results incomplete when evidence is missing.
Each plan keeps its own run record, so a run of another plan does not replace
it.

Older saved runs do not contain this record and are reported as unavailable.
The current next-run preview is not a record of what a previous run was due to
clean. This history does not change plan scheduling or robot operation.

Back up Home Assistant, update Matic to `v0.5.5` in HACS, and restart Home
Assistant. Home Assistant 2026.10 or later is required.
