# Firmware compatibility

Matic firmware can change the private Hermes protocol used by this unofficial
integration. This ledger records only evidence that is safe to publish and
separates an observed update from verified compatibility.

## Status definitions

- **Observed** — a firmware version was reported, but the integration has not
  been checked after the update.
- **Pairing verified** — local BLE credential issuance was completed on the
  recorded Home Assistant installation and physical adapter; authenticated
  reads or controls may still be pending.
- **Core read verified** — authenticated coordinator state, the floor plan, and
  the primary Home Assistant surfaces work; optional reads or a full endpoint
  sweep may still have documented gaps.
- **Read verified** — discovery, authentication, coordinator refresh, state,
  telemetry, and floor-plan reads work after the update.
- **Control verified** — read verification passed and the supported Home
  Assistant controls were exercised safely on a real robot.
- **Regression** — a previously supported read or control is known to fail.

## Compatibility ledger

| Firmware | First observed | Integration | Status | Evidence | Changes or capabilities |
| --- | --- | --- | --- | --- | --- |
| [v172.9](firmware-versions/v172.md) | 2026-08-13 | development | Core read verified | Live authenticated `kabuki_state` and settings read; protocol 25; Cues setting read/write; all six voice and gesture stages; accepted/rejected intent paths; following true/false; analyzer sweep 31 populated / 9 empty / 0 failed with 26 structural endpoints and 77 value-free paths | Adds the privacy-safe Matic Cues read surface and upgrades automatic OTA analysis with bounded structural candidates. The complete Cues lifecycle and first structural analysis format were observed live; unexercised intent kinds remain app-schema-derived with synthetic fixtures. |
| [v171.10](firmware-versions/v171.md) | 2026-08-09 | 0.3.4 candidate | Read verified | The 0.3.4 candidate was live-validated on HA 2026.7.2 Container with a local BlueZ adapter on an ARM64 Linux host; protocol 25; initial credential issuance completed; coordinator, state, telemetry, map, rooms, and pose decoded; payload-free sweep 32 populated / 8 empty / 0 failed | Release 0.3.3 discarded an unchanged local scanner entry as not fresh; 0.3.4 accepts that retained entry after the active sweep. Reauthorization, credential replacement, stale-bond recovery, and controls remain pending. |
| [v169.9](firmware-versions/v169.md) | 2026-07-27 | 0.3.0 | Control verified | Live on HA 2026.7.4; protocol 25; snapshot 28 populated / 12 empty / 0 failed; no endpoint availability changes | Full local map, pose, rooms, telemetry, and update state remained available; quick and standard coverage, all three cleaning modes, complete saved-plan handoff, both intelligent-stop branches, and persisted custom-area cleaning passed live without false credit |
| [v168.11](firmware-versions/v168.md) | 2026-07-20 | 0.2.0–0.2.3 | Core read verified | Live on HA 2026.7.2; protocol 25; automatic baseline snapshot 28 populated / 12 empty / 0 failed; selected stop/dock/room-plan paths later exercised | Uploader-state decoder fix released and live-confirmed; robot-side stream resets handled as transport noise; complete control matrix remains pending |

No v170 build was observed, so the ledger makes no v170 compatibility claim.
The v171.10 and v172.9 validation results are direct live observations and do
not infer behavior for the missing release.

An empty or pending entry is not a compatibility claim. Synthetic tests show
that the integration handles the documented protocol shapes; only real-robot
validation can establish behavior for a firmware release.

See the [endpoint and Home Assistant map](firmware-endpoint-map.md) for every
currently understood RPC, collection/property, channel, exposure, and candidate
safe exposure. Copy the [version template](firmware-versions/template.md) after
each OTA so weekly releases produce comparable snapshots rather than loose
notes.

## Validation record

For each firmware, record the integration and Home Assistant versions, then
check in this order:

1. Record the Home Assistant installation, local Bluetooth adapter, and source
   of the firmware version.
2. Confirm local discovery and `GetBotInfo`.
3. When physical access is available, exercise the claimed initial issuance or
   reauthorization path on each installation/adapter path. Record distance and
   scanner controls.
4. When credential recovery is claimed, exercise explicit replacement and
   stale-bond removal.
5. Confirm authenticated coordinator refresh, software version, protocol
   version, operational state, battery, update state, map, pose, and room data
   still decode.
6. Review privacy-safe logs and downloaded diagnostics for new missing fields,
   unknown state/error codes, or collection failures.
7. Exercise supported controls deliberately: start, pause, resume, stop, dock,
   room cleaning, cleaning modes, coverage levels, and saved plans.
8. Record changed behavior, regressions, and newly observed fields or
   capabilities. Link public fixtures, tests, issues, or pull requests when
   available.

The integration automatically records the first firmware as a baseline. Each
newly observed firmware or protocol pair fires `matic_robot_firmware_changed`
and starts a background, payload-free snapshot of all known endpoints. The
snapshot also compares bounded value-free protobuf shapes so newly added field
paths become capability candidates instead of disappearing inside opaque hash
changes. `matic_robot_firmware_analyzed` reports the silent counts and paths for
advanced automations. A Home Assistant Repair is created only when availability or
transport status changes; a normal weekly OTA or structural candidate does not
create an issue or notification.

That automated snapshot runs only after authentication. Structural analysis
records field numbers and wire types, never values, and nested traversal stops
before classified intents, rejection detail, targets, coordinates, and media.
It cannot infer meaning, discover an endpoint name absent from the allowlist,
or validate initial pairing, reauthorization, credential replacement, physical
controls, or the Bluetooth adapter path; those remain deliberate manual checks.

The event can also drive a local notification:

```yaml
triggers:
  - trigger: event
    event_type: matic_robot_firmware_changed
actions:
  - action: persistent_notification.create
    data:
      title: Matic firmware changed
      message: "Matic changed from {{ trigger.event.data.previous_version }} / protocol {{ trigger.event.data.previous_protocol }} to {{ trigger.event.data.firmware_version }} / protocol {{ trigger.event.data.protocol_version }}. A safe endpoint snapshot is running automatically."
```

Do not publish robot credentials, passkeys, network addresses, MAC addresses,
serial numbers, certificates, packet captures, floor maps, room names, Wi-Fi
details, Home Assistant storage, or unredacted diagnostics.

## Capability evidence rule

A newly observed field may be documented as a candidate capability. It is not
supported until its wire shape is understood and covered by synthetic tests.
Never add a command from a guessed enum or payload: a write requires a
byte-for-byte synthetic fixture, evidence that a real robot accepted it safely,
and Home Assistant-native error handling.
