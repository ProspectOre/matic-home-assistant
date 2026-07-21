# Release notes — 0.2.0

[Documentation home](README.md) · [Project overview](../README.md) ·
[Get support](README.md#support)

0.2.0 is a hardening and observability release. Read **Upgrading from 0.1.x**
before updating: entity IDs migrate once, one action was renamed, and the
recording model changed.

## Fixed

- **Entities cycling between unavailable and available.** Live robots
  sometimes reset a Hermes collection stream on their side while the
  integration is finishing a bounded read. The resulting raw `h2` protocol
  error escaped the transport error mapping, failed the entire 30-second
  poll, and marked every entity unavailable for one cycle. All `h2` errors
  now map into the normal connection-error handling, stream cancellation is
  best-effort, and telemetry collection reads moved to a five-minute tier —
  reproduced, fixed, and verified against a real robot on firmware v168.11.
  The `h2` package is now an explicit requirement.

## What's new

- **Firmware compatibility tracking.** A typed 40-endpoint Hermes registry
  drives automatic, payload-free endpoint snapshots whenever new firmware is
  observed. The Firmware compatibility sensor reports
  `pending`/`baseline`/`compatible`/`regression`; a Repair appears only when
  endpoint availability or transport behavior actually drifts, never for a
  normal OTA. Transient sweep failures are retried instead of being recorded.
- **Room statistics.** Two opt-in sensors per mapped room — last clean
  duration (long-term statistics) and last cleaned timestamp — plus an
  always-on `Last run duration` sensor, so cleaning time can be compared
  across firmware updates. See
  [Room statistics and the recorder](automation.md#room-statistics-and-the-recorder).
- **New events.** `matic_robot_cleaning_finished` fires once per finished
  session with duration, rooms, per-room durations, and firmware version.
  `matic_robot_firmware_changed` fires on OTA changes. Both carry
  `device_id`/`entry_id`.
- **Update entity.** A read-only firmware update surface in Home Assistant's
  update UI; installs remain robot-managed.
- **Wi-Fi signal sensor** (disabled by default) with long-term statistics.
- **Tiered polling.** Operational state and pose every 30 s, decoded telemetry
  every 5 minutes, floor plan every 15 minutes, identity once; setting writes
  force an immediate slow refresh. Map camera frames are cached per
  plan/pose/size.
- **Robot identity protection.** If the device at the configured address ever
  presents a TLS certificate that does not match the pinned robot identity, the
  integration blocks communication, logs an error, and raises a Repair that
  clears automatically once the identity matches again.
- **Command acknowledgment health.** Every sent command records whether the
  robot's channel acknowledged it; diagnostics summarize acknowledgment
  counts and failures alongside endpoint read health.
- **Recorder privacy.** Home-context attributes (rooms, SSID, schedules,
  session room detail, plan history) remain fully template-visible but are
  excluded from the recorder database. The neighbor Wi-Fi scan list is no
  longer exposed. Diagnostics use a strict safe-field allowlist.

## Upgrading from 0.1.x

- **Entity IDs migrate once.** The first start after upgrading renames
  pre-0.2.0 registry entries to descriptive canonical IDs (for example
  `vacuum.matic_3` → `vacuum.matic`) when the destination ID is free.
  Dashboards and automations that reference old numbered IDs need a one-time
  update; every rename is logged. The migration runs exactly once, so IDs you
  rename afterwards are never touched again.
- **Action renamed.** `matic_robot.fetch_hermes_collection` is now
  `matic_robot.inspect_hermes_endpoint`. The `collection` field is now
  `endpoint`, and the `include_payload`/`payload_format`/`max_bytes` options
  are gone: inspection is hash-only, and raw payload bytes can no longer be
  retrieved through Home Assistant.
- **Attribute changes.** Previously recorded attributes are now live-only
  (excluded from recorder history): vacuum `rooms`, rooms sensor
  `room_names`/`segments`, Wi-Fi `ssid`, `schedules`, session
  `latest_rooms`/`latest_room_durations`, plan/history detail, and software
  `timezone`. Templates keep working; recorded attribute history stops
  accumulating. The Wi-Fi `networks` neighbor list was removed entirely. The
  active-plan and next-room sensors now nest their detail under single
  `active` and `preview` attributes.
- **Recorded room statistics are opt-in.** Enable the per-room sensors under
  the device's entity list if you want per-room duration history; enabling
  them stores room names in the recorder by design.
- **Removing the integration now erases its stored firmware history** along
  with the config entry.

## Verification

All release gates pass: full test suite at 100% coverage, Ruff, strict MyPy,
the privacy/public-tree check, and the packaging/fresh-install gates. This
build was installed on a production Home Assistant Yellow against a real
robot on firmware v168.11: the one-time entity-ID migration, the automatic
40-endpoint baseline snapshot (28 populated, 12 empty, 0 failed), the
firmware compatibility sensor, per-room statistics sensors, saved-plan
actions, and the h2 stream-reset fix were all verified live. See
[Firmware compatibility](firmware-compatibility.md).
