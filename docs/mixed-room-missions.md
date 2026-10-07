# Mixed room missions

[Cleaning guide](cleaning.md#saved-plans) · [Restart recovery](restart-recovery.md)

Managed plans preserve each room's cleaning mode and coverage setting inside
one ordered native mission. A settings change no longer requires the integration
to finish one mission at the dock before starting the next.

For example, a plan can vacuum one room on Quick and mop the next on Optimal
without an integration-imposed dock visit between settings. The robot still
handles battery, water, and other servicing as needed.

## Dispatch and recovery

- Per-room updates require the generated native session, the original room map,
  the first room actively cleaning, and a current managed command generation.
- Neither the start nor the update is replayed after ambiguous transport failure.
- Failure cleanup may stop only the same owned native session, never a replacement.
- Older saved run checkpoints retain their original mission boundaries.
- Completion is verified separately for each room's requested mode using native
  history. A command acknowledgement is not completion evidence.

## Retained settings and release acceptance

Firmware can omit mop behavior 3 from the retained coverage goals in each
mop-enabled room. Readback accepts that omission separately for each room only
when the other three mop behaviors remain present exactly once at the requested
coverage setting. Every vacuum goal and every other room, setting, floor, mode,
and behavior must still match; extra or duplicated goals remain a failure.
This readback rule does not grant cleaning completion credit.

Mixed readback verification has one eight-second deadline. Expiry reports a
specific verification error, including when the deadline interrupts a request or
the polling sleep. With DEBUG logging enabled for
`custom_components.matic_robot.client.api`, expiry also records the interrupted
stage, the latest sample's status and goal counts, and missing/unexpected goal
tuples. Each tuple contains `(room_ordinal, setting, floor, mode, behavior, count)`;
room ordinals follow the outgoing plan's order and are local to that attempt.
Unexpected rooms receive subsequent ordinals. Each delta is limited to 32 entries
with an omitted-entry count. UUIDs, room names, session identifiers, and raw
payloads are not included. A missing or malformed sample is identified explicitly.
These diagnostics describe the last completed sample; they do not establish the
physical cause of a mismatch or change the readback acceptance rules.

The configuration regression matrix covers all 729 three-room combinations of
the three cleaning modes and three coverage settings, including every subset of
rooms with the observed omission. Actual client tests cover all 81 two-room
combinations with both valid readback and a missing required goal. Synthetic
fixtures also cover the four-room combined/vacuum/combined/combined pattern and
larger plans. Another 108 executor cases cover saved order, intelligent rotation,
Run all, return-to-base, finish-current-room, and threshold settings; 90 policy
cases cover threshold edges across every mode/coverage pair. Existing lifecycle
tests retain stop, takeover, and restart guards.

A valid configurable plan that aborts fails functional acceptance, even when
STOP/DOCK cleanup succeeds. Before a release, the exact installed candidate must
complete a bounded multi-mop plan and a mixed combined-mode plan with mode-scoped
native results for every requested room. Exercise distinct coverage settings,
saved order and rotation, return and stop options, and restart recovery. Record
which cases were actually run; synthetic coverage cannot substitute for physical
acceptance. A separate deliberately invalid readback or ownership-replacement
case must still fail closed. Do not classify an ordinary valid plan as that
negative test just because its firmware readback differs.
