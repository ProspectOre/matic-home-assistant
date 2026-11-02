# Native history floor identity

Research for [#383](https://github.com/ProspectOre/matic-home-assistant/issues/383),
observed November 1, 2026. The installed OEM decoder confirms that native history
contains mission and partition identity, per-mode completion, stop reason, and
start initiator. The integration's previous parser did not expose these semantics.

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
`goals`, and `partition_id`. To verify wire meaning, an isolated `app_process`
probe loaded the installed OEM bindings and replayed captured history through a
local TLS replay server. The replay library differed from the installed library
only in the private fixture root CA literal range; all other bytes, including
`.text`, were unchanged. The installed app and its default trust configuration
were untouched. The replay sent no robot commands.

## Structural capture

An official-app baseline contained 20 unique history events. Matching its
mission, partition, completion, stop, and initiator results against the private
decoder replay gave parity for all 20 events. No captured identifiers, names, or
household labels are included here.

The verified wire mappings are:

- Root field `1` is `MissionId`, with nested fields `2` (`fixed32`).
- The canonical partition ID is under log field `2`, repeated field `1`, initial
  event `2`, start-goals `1`, repeated goal `2` (or `1` in a verified variant),
  goal metadata `7`, partition envelope `1/1/2`, then payload fields `1`
  (`fixed64` high) and `2` (`fixed64` low). Mutating this UUID changes the OEM `getPartitionId()`
  result; omitting it is rejected. The previously suspected path
  `2/1/10/2/1/1` is correlated data, not the canonical identity: mutating or
  removing it leaves the official partition result unchanged.
- Modern completion is root field `5`, field `11`, repeated field `1`, map-entry
  value field `2`, repeated field `2`, mode-map value field `2`, status field
  `5`. Mode key field `1` has value `0` for vacuum and `1` for mop;
  status `0` means not started,
  `1` incomplete, and `2` completed. A complete vacuum combined with an
  unattempted or partial mop is incomplete overall. When this modern summary is
  present, mutations to legacy global status (`5/5`) and legacy vacuum status
  (`5/6/1/2/5`) do not change the OEM result.
- Stop reason is independently decoded from root field `5`, field `10`, under
  nested fields `5/1` or `5/2` for finished, and `8/1` for user cancellation.
  Changing the corresponding log stop event does not change the OEM result. Changing the stop reason to
  cancellation preserves completed work; missing stop evidence yields
  `BotCancelled`.
- Start initiator is log `2/1/2/3`. User initiator variant `2/1/1` is the
  generic app; variants `2` through `6` encode Atrium, Button, Matter, Voice,
  and Gesture. Schedule start labels are at `3/2` as UTF-8. Household labels
  are intentionally omitted from this public record.

The legacy schedule-derived candidate identity does not control the OEM
partition result. Missing root mission identity, canonical partition identity,
or start reason is rejected by the strict replay reader. The evidence also
includes missing, malformed, duplicate, and bounded-input cases. This establishes
the OEM semantics and replay-reader behavior; it does not establish that the
integration implementation is complete or deployed. The feature integration is
still in progress, and the installed Home Assistant runtime remains
`v0.5.1-beta1` (`63c143c6`).

A separate offline `kabuki_state` replay supplied packed wire error `220`
(`12 02 dc 01`). The same installed OEM binding returned `errors=[220]` and
`KabukiDisplayedError.SolventUnavailable`. This proves the current app's mapping;
the UniFFI enum ordinal alone was not that proof. No physical tank fault was
induced, and this does not establish cross-firmware behavior.

Raw captures, map identities, household labels and vendor artifacts remain in
the private evidence store. This offline replay did not clean, dock, induce a
fault, edit floors, or change firmware. Separate authorized physical cleanings
are recorded in [cleaning results](native-cleaning-results.md); those runs are
not evidence for the offline parser replay.

See [cleaning results](native-cleaning-results.md) and the
[OEM research workflow](https://github.com/ProspectOre/wiki/blob/main/workflows/oem-protocol-research.md).
