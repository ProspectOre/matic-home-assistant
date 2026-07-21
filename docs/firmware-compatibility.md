# Firmware compatibility

Matic firmware can change the private Hermes protocol used by this unofficial
integration. This ledger records only evidence that is safe to publish and
separates an observed update from verified compatibility.

## Status definitions

- **Observed** — a firmware version was reported, but the integration has not
  been checked after the update.
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
| [v168.11](firmware-versions/v168.md) | 2026-07-20 | 0.2.0 | Core read verified | Live on HA 2026.7.2; protocol 25; automatic baseline snapshot 28 populated / 12 empty / 0 failed | Uploader-state decoder fix released and live-confirmed; robot-side stream resets handled as transport noise |

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

1. Confirm local discovery and authenticated coordinator refresh.
2. Confirm software version, protocol version, operational state, battery,
   update state, map, pose, and room data still decode.
3. Review privacy-safe logs and downloaded diagnostics for new missing fields,
   unknown state/error codes, or collection failures.
4. Exercise supported controls deliberately: start, pause, resume, stop, dock,
   room cleaning, cleaning modes, coverage levels, and saved plans.
5. Record changed behavior, regressions, and newly observed fields or
   capabilities. Link public fixtures, tests, issues, or pull requests when
   available.

The integration automatically records the first firmware as a baseline. Each
newly observed version fires `matic_robot_firmware_changed` and starts one
background, payload-free snapshot of all known endpoints. A Home Assistant
Repair is created only when availability or transport status changes; a normal
weekly OTA does not create an issue.

The event can also drive a local notification:

```yaml
triggers:
  - trigger: event
    event_type: matic_robot_firmware_changed
actions:
  - action: persistent_notification.create
    data:
      title: Matic firmware changed
      message: "Matic changed from {{ trigger.event.data.previous_version }} to {{ trigger.event.data.firmware_version }}. A safe endpoint snapshot is running automatically."
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
