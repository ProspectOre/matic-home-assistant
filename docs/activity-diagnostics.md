# Investigating interrupted cleaning

[Documentation](README.md) · [Privacy](privacy.md)

When the robot briefly reports returning to dock or stops before finishing a
plan, download the integration diagnostics soon afterward. `activity_observations`
contains the last 512 command and state observations from the current integration
load. Older observations are evicted; reloading or restarting clears this buffer.
The administrator-only `MaticGetActivity` tool reads this journal directly;
`MaticGetRecentEvents` returns the last 64 low-volume operational events by
default, so polling observations cannot evict room and terminal evidence. Pass
`include_activity: true` when a combined current-process trail is needed; use
`MaticGetActivity` for the paginated raw journal.

The integration emits `matic_robot_activity_observed` events locally. Home
Assistant Recorder can retain these across restarts according to its event
exclusions and retention settings. No debug logging needs to be enabled.

## Reading the evidence

- `observation_session` identifies one integration load. `sequence` orders its
  observations, and `observed_at` is the Home Assistant receipt time in UTC.
- `run_id` links integration commands and raw state observations to one managed
  plan run. It is a random local token, not a user or account identifier.
- `command_requested` identifies the integration's intended command, including
  internal cleanup. Later records refer to its sequence as `command_id`.
- `command_sending` means transmission began. A subsequent failure or cancellation
  does not prove that the robot received nothing.
- `command_result` reports transport acknowledgement, no acknowledgement,
  failure, or cancellation. Acknowledgement does not prove execution.
- `state` records changes in raw `state_codes` and `error_codes`, before Home
  Assistant error confirmation. `source` distinguishes poll and push observations;
  a slower poll can arrive after a newer push observation.
- `state_stream_started` and `state_stream_ended` mark subscription attempts and
  gaps. A started stream is not proof that a snapshot has arrived.

A returning state without a corresponding integration command shows that this
integration did not request docking during that observed interval. It cannot
distinguish an OEM-app command, a physical control, or an internal robot decision.
Check for subscription gaps, missing sequences, and restarts before drawing that
conclusion. These observations do not recover activity from before installation.

## Inspecting a run through MCP

Call `MaticGetActivity` with `kind: commands` to list integration command attempts
and results. Use `kind: states`, `stream`, or `all` for state changes and stream
boundaries. Every response identifies the integration load, earliest and latest
available sequences and receipt times, and whether older observations were evicted.

If `has_more` is true, pass `next_before_sequence` as `before_sequence`, together
with the returned `observation_session` and the same `kind`. Pagination rejects a
changed integration load. Compare available windows across pages: eviction during
inspection can remove older evidence. An empty command page cannot explain events
outside its available window. Use Recorder for older evidence when retained.

Read `MaticGetNativeHistory` with the run's `cleaning_mode`: `vacuum`, `mop`, or
`vacuum_and_mop`. Room completion and duration apply to the returned
`completion_scope`. Without a mode, native per-mode records have unspecified scope
and nullable completion flags; durations total the reported modes. Missing or
unattempted modes do not identify which work the user requested. A zero count in
the older native room summary does not mean a vacuum-only run failed.

Report three separate facts: what cleaning the native history reports, which
integration commands were requested, and where the robot ended up. An intentional
stop followed by verified docking is a successful stop outcome. It does not prove
every room finished. An ended-in-place interruption records missing managed
completion evidence; it does not identify who stopped the robot or prove a fault.
Native firmware can also report a stopped room as completed, so history alone
does not override that guard or retrospectively award managed completion credit.

Managed room events include a stable `reason_code` for machine handling. Codes
such as `verified_completion`, `unverified_completion`, `stopped_in_place`,
`native_task_taken_over`, `start_timeout`, `completion_timeout`, and
`robot_error` describe the observed terminal path. A `cause` of `unknown` is
intentional when the integration cannot prove whether an OEM app, physical
control, or robot decision caused the transition; it must not be replaced with
an inferred user or account identity.

The `matic_robot_plan_finished` event is the managed-run boundary. Match its
`run_id` to room events, `MaticGetActivity`, and the `last_run` plan snapshot.
Its verified room count and outcome describe the plan runner; native history
remains a separate robot-side evidence source.

For a controlled reproduction, supervise one plan with presence automation
temporarily disabled and avoid OEM-app or physical-control input. Note any
intervention, then restore the automation after the test. Report observed
movement separately from the robot's displayed activity.
