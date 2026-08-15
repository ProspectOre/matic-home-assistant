# Release notes — 0.3.6

Released: 2026-08-15

## Summary

0.3.6 brings Matic Cues to Home Assistant's local automation surface and adds
automatic, privacy-safe analysis whenever the robot reports a new firmware or
protocol version.

## Matic Cues for local automations

- A **Matic Cues** switch controls the robot's Cues setting. Voice and gesture
  lifecycle sensors, a following-person binary sensor, and the **Matic Cues**
  event entity expose automation-safe state between regular coordinator polls.
- The integration reports only lifecycle stages and reviewed intent
  classifications such as clean, pause, dock, navigate, and follow. It never
  retains or publishes audio, transcripts, images, video, person identity, or
  pointing coordinates. Recording-related classifications deliberately remain
  `unknown`.
- The live state subscription retries with bounded backoff and safely replaces a
  failed Hermes channel. It is cancelled cleanly when the Home Assistant config
  entry unloads, so a reload cannot leave a background Cues task behind.

## Automatic firmware and protocol analysis

- When a newly observed firmware or protocol version is recorded, the
  integration automatically compares its allowlisted local Hermes endpoints
  with the prior snapshot. The **Firmware snapshot** action remains available
  for a deliberate repeat.
- The analyzer records only bounded protobuf field-number and wire-type shapes
  from explicitly approved message paths. It never stores payload values,
  transcripts, media, coordinates, or raw protobuf data.
- A new structural shape emits a quiet diagnostic result for advanced
  automations and does not create a Repair or a persistent notification.
  Repairs remain limited to endpoint availability or transport regressions.

This release adds no robot motion command and keeps integration traffic,
snapshots, analysis, and automation data local to Home Assistant.

## Verification

The release candidate is gated by the full Python suite at 100% coverage,
Ruff, strict MyPy, the public-tree privacy gate, release archive inspection,
a fresh-install import check, browser tests, HACS, Hassfest, and a clean
exact-head regular review. The v172.9 / protocol 25 Cues lifecycle and
value-free OTA shape sweep were also verified on a real robot.

## Upgrading from 0.3.5

Install 0.3.6 through HACS and restart Home Assistant. Existing entries,
credentials, plans, custom areas, maps, cleaning history, and firmware
snapshots are preserved. Cues remains controlled by its existing robot setting;
review Matic's Cues privacy information before enabling it.
