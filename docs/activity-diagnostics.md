# Investigating interrupted cleaning

[Documentation](README.md) · [Privacy](privacy.md)

When the robot briefly reports returning to dock or stops before finishing a
plan, download the integration diagnostics soon afterward. `activity_observations`
contains the last 512 command and state observations from the current integration
load. Older observations are evicted; reloading or restarting clears this buffer.
The administrator-only `MaticGetRecentEvents` tool also shows recent observations
among its last 64 operational events.

The integration emits `matic_robot_activity_observed` events locally. Home
Assistant Recorder can retain these across restarts according to its event
exclusions and retention settings. No debug logging needs to be enabled.

## Reading the evidence

- `observation_session` identifies one integration load. `sequence` orders its
  observations, and `observed_at` is the Home Assistant receipt time in UTC.
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

For a controlled reproduction, supervise one plan with presence automation
temporarily disabled and avoid OEM-app or physical-control input. Note any
intervention, then restore the automation after the test. Report observed
movement separately from the robot's displayed activity.
