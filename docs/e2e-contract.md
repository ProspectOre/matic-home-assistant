# End-to-end cleaning contract

[Documentation](README.md) · [Actions and events](automation.md) · [Activity diagnostics](activity-diagnostics.md)

The managed runner keeps seven evidence boundaries explicit. A clean native
history record is useful evidence, but it is not by itself proof that a saved
plan completed or that a person caused a stop.

1. **Managed outcomes.** Every managed run gets one local `run_id` and emits a
   `matic_robot_plan_finished` event when its runner exits. Its `outcome` is
   `completed`, `partial`, `stopped`, `failed`, or `interrupted`; `reason_code`, `cause`, and verified
   room counts explain the result. `room_completed` is emitted only after the
   existing native completion guard passes.
2. **Trigger provenance.** The run record carries the safe `trigger` label and
   Home Assistant service name. It never carries a context user ID, account
   name, or email. An OEM-app, physical, or robot-originated action remains
   `cause: unknown` unless the integration has direct evidence.
3. **Correlation.** Room events, the active plan snapshot, terminal plan event,
   and integration activity observations carry the same `run_id`. Activity also
   has an `observation_session` and monotonic `sequence`; a restart starts a
   new observation window.
4. **Intelligent rotation.** `MaticGetPlan` and `preview_plan` expose the
   exact selected order, last opportunity, source, result, and tie-break reason.
   The preview and executor share the same deterministic rotation key.
5. **Evidence retention.** Low-volume operational events have a separate
   bounded 64-event trail. High-frequency state and command observations retain
   their own bounded 512-record journal, so polling cannot hide a room or
   terminal event. Both surfaces are read-only and payload-free.
6. **Scenario coverage.** The automated matrix covers verified completion,
   native partial/unverified results, managed stop and return, configuration
   unload interruption, failure/timeout, rotation tie-breaking, activity
   churn, and identifier redaction. Each scenario checks both persisted state
   and its native Home Assistant event.
7. **Runtime proof.** A release candidate is complete only after project CI
   passes and that same candidate has install/restart readback and physical
   acceptance. Local tests and UI checks complement live proof; they do not
   replace it.

## Acceptance matrix

| Scenario | Required evidence | Room-credit rule |
| --- | --- | --- |
| All selected rooms verify | `plan_finished: completed`, matching `run_id`, all room events | Credit verified rooms only |
| Native session ends early | `plan_finished: partial`, `partial_native_result`, `stopped_in_place`, or `unverified_completion` | Leave unverified rooms due; a known in-place stop is a controlled partial result, not a generic service fault |
| Managed stop | `plan_finished: stopped`, `managed_stop`, stop command/activity when available | Do not credit the unfinished room |
| Independent command replaces a plan | `plan_finished: stopped`, `managed_replaced`, `cause: replacement` | Do not credit the unfinished room or dispatch another plan command |
| Home Assistant unload | `plan_finished: interrupted`, `config_entry_unload` | No completion credit |
| Timeout or robot error | `plan_finished: failed`, stable failure code, room failure event | No completion credit |
| Rotation preview and execution | Same room order and selection reasons | Advance opportunity on a confirmed cleaning start; credit completion only after verification |
| Activity churn or restart | Operational events remain visible; journal session/sequence boundaries are explicit | Never infer a cause from missing activity |

Keep release evidence separate from robot credentials, network identifiers,
serials, maps, and personal account identifiers.

After an abrupt Home Assistant restart, the persisted run becomes `interrupted`
with `reason_code: home_assistant_restart`. `recovered_at` records when recovery
observed it; `ended_at` remains unknown. Recovery does not reconstruct a missing
terminal event or award room credit.
