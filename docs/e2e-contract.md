# End-to-end cleaning contract

[Documentation](README.md) · [Actions and events](automation.md) · [Activity diagnostics](activity-diagnostics.md)

The managed runner keeps seven evidence boundaries explicit. A clean native
history record is useful evidence, but it is not by itself proof that a saved
plan completed or that a person caused a stop.

1. **Managed outcomes.** Every managed run gets one local `run_id` and emits a
   `matic_robot_plan_finished` event when its runner exits. Its terminal
   `outcome` is `completed`, `stopped_docked`, `recharge_suspended`,
   `cancelled`, `failed`, or `unverified`; `reason_code`, `cause`, and verified
   room counts and `room_outcomes` (`completed`, `partial`, or `unattempted`) explain the result. A later `matic_robot_plan_docked` event
   upgrades a cancelled or unverified stop to `stopped_docked` only after the
   correlated final DOCK is accepted. `room_completed` is emitted only after
   the existing native completion guard passes.
2. **Trigger provenance.** The run record carries the safe `trigger` label and
   Home Assistant service name. It never carries a context user ID, account
   name, or email. An OEM-app, physical, or robot-originated action remains
   `cause: unknown` unless the integration has direct evidence.
3. **Correlation.** Room events, the active plan snapshot, terminal plan event,
   and integration activity observations carry the same `run_id`. Activity also
   has an `observation_session` and monotonic `sequence`; a restart starts a
   new observation window.
4. **Intelligent rotation.** `MaticGetPlan` and `preview_plan` expose the
   exact selected order, last opportunity, last completion, source, result, and
   tie-break reason. The preview is explicitly labelled `next_run`.
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
| Departure trigger starts a plan | Trigger trace, `run_id`, first room event, and command journal | Credit only rooms with verified native completion |
| Return-home stop | `plan_finished: cancelled`, STOP plus final DOCK with the same `run_id`, then `plan_docked: stopped_docked` | Never credit the room that was stopped |
| Stop during a room | Room event `partial`, native visited/partial evidence, and no completion credit | Keep the room due for rotation |
| Finish-current-room threshold | Policy decision, threshold/progress, and either room completion or cancelled stop | Credit only when native completion verification passes |
| Recharge and resume | Suspended event, native recharge/resume transition, and resumed room timeline | A resumed room can complete; an unreconciled low-charge stop is `recharge_suspended` |
| Mixed settings | Preview `settings_boundary_count`, per-leg settings, and command timeline | Each leg keeps its own mode and coverage |
| All selected rooms verify | `plan_finished: completed`, matching `run_id`, all room events | Credit verified rooms only |
| Native session ends early | `plan_finished: unverified`, `partial_native_result`, `stopped_in_place`, or `unverified_completion` | Leave unverified rooms due; a known in-place stop is a controlled unverified result, not a generic service fault |
| Delayed native history | Initial `unverified`/pending reconciliation, then exact room/run match or expiry | Never advance rotation until the delayed evidence is exact |
| Home Assistant restart recovery | `unverified`, `home_assistant_restart`, recovered room records, and new observation session | No completion credit or invented end time |
| External/OEM interruption | Native ownership change, `cause: unknown`, and `external_unknown` provenance | No completion credit and no guessed fault |
| Timeout or robot error | `plan_finished: failed`, stable failure code, room failure event | No completion credit |
| Rotation preview and execution | Same room order and selection reasons | Advance opportunity on a confirmed cleaning start; credit completion only after verification |
| Activity churn or restart | Operational events remain visible; journal session/sequence boundaries are explicit | Never infer a cause from missing activity |

Keep release evidence separate from robot credentials, network identifiers,
serials, maps, and personal account identifiers.

After an abrupt Home Assistant restart, the persisted run becomes `unverified`
with `reason_code: home_assistant_restart`. `recovered_at` records when recovery
observed it; `ended_at` remains unknown. Recovery does not reconstruct a missing
terminal event or award room credit. Verified counts are saved with room history,
so recovery retains work already verified before the interruption.

Late native reconciliation carries the originating `run_id`. The terminal plan
record continues to describe the evidence available when its runner exited;
`room_reconciled` identifies any additional completion verified afterward.

When a multi-room run exits, earlier rooms from that run that still lack a
terminal result become `ended_unverified` and emit a matching room event.
Their rotation opportunity remains recorded; completion credit still requires
native evidence. Startup also closes stored nonterminal room records, preserving
the previous result and recording the recovery time. It does not reconstruct
missing room events or invent a physical room-end timestamp.
