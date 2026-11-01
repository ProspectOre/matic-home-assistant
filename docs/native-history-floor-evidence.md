# Native history floor identity

Research for [#383](https://github.com/ProspectOre/matic-home-assistant/issues/383),
observed November 1, 2026. The integration currently omits floor identity from its
decoded history. The OEM app's model includes it. Missing parser support must not
be described as a missing protocol capability.

## Source identity

The connected Samsung tablet runs Matic 1.182.1, build 106. Installed APK hashes
matched the saved analysis copies; the native library also matched the arm64
split's extracted library. The bounded robot read reported firmware v181.10.

| Artifact | SHA-256 |
| --- | --- |
| Base APK | `dfb7e989975a6e08eebad62796a32def52bd5e525c8afa1bc8e287ae1eb5a0a5` |
| arm64 split APK | `366016576268c86e18b5fff29edf4803ef26b32649346131b8791367e09ae519` |
| Native library | `d3c4358caad2819810214a325902bbe205a430777273575ac204ae8f529be01e` |

The generated `HistoryEvent` binding and its UniFFI converter expose `mission_id`,
`goals`, and `partition_id`. This establishes the app model's identity fields,
not their protobuf tag numbers. The app's history screen associates runs with maps.

## Structural capture

A bounded acknowledged read captured 20 history records and two saved floors.
Only one mission appeared in those history records; this is not a two-floor
history qualification.

- Every root field 1 decoded as a mission identifier matching one saved floor.
- Path `2/1/10/2/1/1` contained a valid partition identifier in all 20 records.
  Each record repeated one distinct identifier between 8 and 150 times.
- Sixteen records' identifiers exactly matched that floor's current partition
  encoding. Four records had a different identifier. They were not missing the
  field. The reason for that difference is unproven.

Exact equality corroborates a candidate association. It does not establish the
official meaning of the nested field or justify assigning a mismatched record
to the current partition. Current-map identity and room names alone are inadequate.

## Remaining proof

The older symbol-bearing library used for the schedule research has SHA-256
`150e992f40daf46f204f7de349a5ba154fa2c524f6533fdf330b1fa6432840e9`.
Its `HistoryEvent::try_from_proto_impl` at `0xea44ac` calls
`CoverageSessionLog::try_from_proto_impl` at `0xeb1764`. Its model metadata links
session logs to goals, and goals to a partition. These are useful leads, but do
not bind the observed nested path to the installed version's semantic decoder.

Before enabling multi-floor imports, obtain an exact schema/decoder trace or an
official parse result from the matching app version. Establish the mission and
partition tag paths, then test matching, mismatched, missing, conflicting and
malformed identities using synthetic fixtures. Exercise histories from two
floors, reused room names and changed partitions. Unknown identities remain
withheld; native statistics still cannot award managed-run completion credit.

The installed app's error types include `SolventUnavailable` and refill guidance,
but this investigation did not prove its numeric association with code 220 in
1.182.1. That label remains observational pending current-version evidence.

Raw captures, map identities, household labels and vendor artifacts remain in
the private evidence store. No cleaning, docking, fault induction, floor edits
or firmware changes were performed for this research.

See [cleaning results](native-cleaning-results.md) and the
[OEM research workflow](https://github.com/ProspectOre/wiki/blob/main/workflows/oem-protocol-research.md).
