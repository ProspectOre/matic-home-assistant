# Investigating interrupted cleaning

[Documentation](README.md) · [Cleaning results](native-cleaning-results.md)

Use the local activity trail to see which commands Home Assistant sent, what
states the robot reported, and how a managed plan ended. No debug logging is needed.

## Start here

1. Download integration diagnostics soon after an unexpected stop or dock visit.
2. Find the plan's `run_id` and match it to room events and command observations.
3. Compare the managed outcome with native history for the requested cleaning mode.

The diagnostics contain the last 512 command/state observations from the current
integration load. Administrators can read them directly with `MaticGetActivity`.
`MaticGetRecentEvents` returns a separate trail of up to 64 operational events,
so frequent state changes do not crowd out room and plan outcomes.

## Read the timeline

| Field or observation | Meaning |
| --- | --- |
| `observation_session`, `sequence` | Integration load and ordering within that load |
| `observed_at` | Home Assistant receipt time in UTC |
| `run_id` | Links plan, room, and activity records |
| `command_requested` | Intended command; later observations refer to its sequence as `command_id` |
| `command_sending` | Transmission began |
| `command_result` | Transport acknowledgement, no acknowledgement, failure, or cancellation |
| `state` | Raw state/error changes; `source` distinguishes poll and push |
| `state_stream_started`, `state_stream_ended` | Subscription attempts and gaps |

A transport acknowledgement confirms the exchange, not cleaning completion.
A returning state without a matching command shows no integration-requested dock
in that observed window; it does not identify an app, physical, or robot-side cause.
Poll and push messages can arrive out of order.

## Query through MCP

- `MaticGetActivity`: use `kind: commands`, `states`, `stream`, or `all`.
- For another page, pass `next_before_sequence` as `before_sequence`, with the
  returned `observation_session` and the same `kind`.
- `MaticGetRecentEvents`: add `include_activity: true` for a combined trail.
- `MaticGetNativeHistory`: set `cleaning_mode` to `vacuum`, `mop`, or
  `vacuum_and_mop` so durations and completion match the requested work.

Responses identify the available window and any eviction. Pagination rejects a
changed integration load. Without a cleaning mode, native results have unspecified
completion scope and nullable completion flags.

## Interpret the outcome

`matic_robot_plan_finished` describes the managed run. Its outcome, verified room
count, and `reason_code` explain what the runner observed. Common reasons include
`verified_completion`, `unverified_completion`, `stopped_in_place`,
`native_task_taken_over`, `start_timeout`, `completion_timeout`, and `robot_error`.
`cause: unknown` means the source was not established.

A successful stop and dock can leave unfinished rooms. Native firmware may label
a stopped room completed, so managed completion also checks ownership and the
terminal transition. [Result rules](native-cleaning-results.md).

## Retention

Restarting or reloading clears the in-memory observation window. Home Assistant
Recorder can retain `matic_robot_activity_observed` events according to its
configuration. Raw state events are limited to one per second; the in-memory
journal keeps received changes up to its 512-record limit. [Stored data](privacy.md).
