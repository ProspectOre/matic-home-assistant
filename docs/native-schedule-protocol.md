# Native schedule protocol evidence

Scope: the read-only 0.5.1 fixes for [#384](https://github.com/ProspectOre/matic-home-assistant/issues/384).
Analysis date: 2026-11-01. Static protocol evidence, synthetic test coverage and
the subsequent affected-install check are distinguished below.

## Source identity

The baseline Android arm64 `libmegazord.so` has SHA-256
`150e992f40daf46f204f7de349a5ba154fa2c524f6533fdf330b1fa6432840e9`.
Its matching generated `EnabledState` binding declares ENABLED, DISABLED and
SUGGESTED in that order, and its UniFFI converter writes ordinal plus one.
No vendor code, private captures or home data are included here.

## Enabled state

The native `EnabledState::try_read` at `0xc90ff0` subtracts one from the
UniFFI integer. `CleaningScheduleEvent::try_read` stores that ordinal at
internal offset `0x8a`. Its `to_proto` at `0xeaf6d8` copies the ordinal to
protobuf Event offset `0xa9`; `Event::encode_raw` at `0xcccdc0` constructs
an empty-message tag from `0x42 | (ordinal << 3)`.

| Wire field | Meaning | Sensor enabled value |
| --- | --- | --- |
| 8, empty message | Enabled | true |
| 9, empty message | Disabled | false |
| 10, empty message | Suggested | unknown |

Field 11 is independent. Top-level field 3 is a legacy enabled boolean,
not ordering. The decoder uses that boolean only when no state marker exists;
missing, conflicting or malformed values stay unknown.

## Room ordering and membership

The native `isOrdered` byte at event offset `0x88` is passed to `Goals::new`
at `0xe9a538`. The returned boolean selects one of two goal vectors in
`CleaningScheduleEvent::to_proto` at `0xeaf9f8`. `Event::encode_raw` passes
those vectors to the `CommandedGoals` encoder at `0xcebf60` as field 7.
That encoder writes the first vector as repeated field 1 and the second as
repeated field 2 (`0xcec124` through `0xcec180`).

- Field 7 / field 1 contains ordered goals.
- Field 7 / field 2 contains unordered goals.
- Each room target follows the existing block-relative path 7 / 3 / 3.

The decoder reads both lists, deduplicates room identifiers in first-seen
order, and leaves ordering unknown for missing or mixed lists. Parsing remains
bounded: 64 KiB per schedule, 1,024 fields per goal-list message, 16,384 fields
across room traversal and 256 distinct room identifiers. Synthetic fixtures
cover 17 rooms with eight blocks per room for both list types.

## Collection acknowledgements

The native schedule subscription contains a `RawSubscription` specialized for
`behavior_schedule_proto::EventKey` and `Event`. Its outgoing `CollectionRequest`
stream combines the initial request with a mapped `SequenceId` receiver.
This establishes that the app acknowledges schedule replies on the bidirectional
stream. The old integration half-closed that stream without acknowledgements.

The integration now uses its existing acknowledged collection reader for
schedules. A synthetic stream withholds its second record until the first is
acknowledged, checking both inspection and telemetry. A read-only check of the
connected robot returned one sequence-bearing record with either reader; it
had only one observed record, so this does not reproduce the reporter's
missing second schedule.

Later on November 1, the [reporter confirmed on v0.5.1-beta1](https://github.com/ProspectOre/matic-home-assistant/issues/384#issuecomment-6564164213)
that both schedules appear with the app's weekdays, time, enabled state, room
ordering and room selections, including the whole-floor schedule. This verifies
the reported mismatch on that installation; it does not establish compatibility
with every robot or firmware version.

See [schedule diagnostics](native-schedule-diagnostics.md) for value-free
inspection and [release notes](release-notes-0.5.1.md) for contributor credit.
