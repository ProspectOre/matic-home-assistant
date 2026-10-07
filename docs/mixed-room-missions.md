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
coverage setting. When the native double-pass override is enabled, firmware can
also replace each complete Standard or Quick mop group with setting 3. The
integration requires an enabled-state read on both sides of a fresh plan read
before accepting that override. Off, unknown, or malformed state cannot qualify
it. Partial group rewrites fail; every vacuum goal and every other room, floor,
mode, and behavior must still match. Extra or duplicated goals remain a failure.
This readback rule does not grant cleaning completion credit.

The native switch uses field 1's empty-message arm for off and field 2's arm for
on. Earlier integration versions reversed both display and write semantics.
Bounded tests on firmware v178.8 with app 1.175.1 verified the native toggle,
corrected setter, Standard with double-pass off/on, and Quick with it on. Each
run ended with verified Stop settlement and docking. These observations qualify
current state and retained goals, not an atomic snapshot or completed cleaning.
The corrected standalone client also accepted a live Standard combined-mode
readback that strict matching rejected; this was not an installed-HA acceptance
run or a completed cleaning cycle.
Heavy Duty separately retained vacuum setting 3 and mop setting 4 with the
override both off and on; that mapping remains outside this normalization and
requires separate qualification.

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
larger plans. Six executor cases verify mixed per-room dispatch and native
completion across three layouts, with and without return-to-base. A registered
service-path test verifies intelligent rotation, saved-order execution, and the
selected plan's configured order. Four focused threshold cases cover disabled,
below, at, and above the finish-current-room boundary. A managed-executor stop
test verifies after-room STOP ownership, one completed room, and no credit for
the queued room. Existing lifecycle tests retain stop settlement, takeover, and
restart guards; none of this synthetic evidence replaces physical acceptance.

A valid configurable plan that aborts fails functional acceptance, even when
STOP/DOCK cleanup succeeds. Before a release, the exact installed candidate must
complete a bounded multi-mop plan and a mixed combined-mode plan with mode-scoped
native results for every requested room. Exercise distinct coverage settings,
saved order and rotation, return and stop options, and restart recovery. Record
which cases were actually run; synthetic coverage cannot substitute for physical
acceptance. A separate deliberately invalid readback or ownership-replacement
case must still fail closed. Do not classify an ordinary valid plan as that
negative test just because its firmware readback differs.
