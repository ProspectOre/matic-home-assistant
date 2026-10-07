# Mixed room missions

[Cleaning guide](cleaning.md#saved-plans) · [Restart recovery](restart-recovery.md)

Managed plans preserve each room's cleaning mode and vacuum coverage setting inside
one ordered native mission. A settings change no longer requires the integration
to finish one mission at the dock before starting the next.

For example, a plan can vacuum one room on Quick and mop the next
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
setting. Vacuum strength applies only to vacuum goals: Quick requests 2,
Optimal requests 1, and Heavy Duty requests 0. The native app requests Standard
(1) for mop goals at every vacuum strength. The integration follows that same
rule for room, mixed-room, and custom-area commands while preserving saved
vacuum choices. Heavy Duty vacuum groups can retain setting 3 instead of 0.
When the native double-pass override is enabled, firmware can also replace each
complete Standard mop group with setting 3. The
integration requires an enabled-state read on both sides of a fresh plan read
before accepting that override. Off, unknown, or malformed state cannot qualify
it. Partial group rewrites fail; every room, floor, mode, and behavior must still
match, including all eight Heavy Duty vacuum siblings. Extra or duplicated goals
remain a failure. Mop setting 4 is not an accepted transformation.
This readback rule does not grant cleaning completion credit.

The native switch uses field 1's empty-message arm for off and field 2's arm for
on. Earlier integration versions reversed both display and write semantics.
Native-app comparisons on firmware v178.8 with app 1.175.1 established the
toggle semantics and Standard/Heavy Duty combined-mode retained settings.
A static trace of the installed app's serializer independently established
Standard mop encoding. New expected spec bytes are synthetic assertions of
that traced contract; they are not presented as native-generated fixtures.
The corrected standalone client accepted all 18 combinations of three modes,
three vacuum strengths, and double-pass off/on in bounded tests. Every case
verified Stop settlement and docking, and restored the original override.
These observations qualify current state and retained goals. They do not
establish completed cleaning or acceptance of an installed HA candidate.

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
