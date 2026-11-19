# Matic 0.5.5

`MaticGetPlan` now includes plan-specific results from the most recent managed
run. It reports the rooms selected for that run, which rooms completed, and
the run's start, end, and outcome. A run with an incomplete room list is marked
incomplete. Plans keep their own results, so a run of another plan does not
replace them.

Older saved runs do not contain this record and are reported as unavailable.
The current next-run preview is not a record of what a previous run was due to
clean. This history does not change plan scheduling or robot operation.

Back up Home Assistant, update Matic to `v0.5.5` in HACS, and restart Home
Assistant. Home Assistant 2026.10 or later is required.
