# Matic (Unofficial) documentation

[Project overview](../README.md) · [Install](../README.md#install) ·
[Get support](#support)

This is the documentation home for the independent, community-maintained Home
Assistant integration for Matic robot vacuums. The guides are versioned with
the integration so instructions and behavior stay aligned with each release.

## Get started

- [Install Matic (Unofficial)](../README.md#install) — Add the HACS custom
  repository or install the integration manually.
- [Local pairing](hermes-pairing.md) — Complete discovery and authorization,
  understand Bluetooth requirements, and recover from pairing failures.
- [Limits and troubleshooting](../README.md#limits-and-troubleshooting) — Check
  discovery, passkey, room-mapping, firmware, and Bluetooth constraints.
- [Firmware compatibility](firmware-compatibility.md) — Track observed robot
  versions, validation status, regressions, and newly discovered capabilities.
- [Release notes — 0.2.0](release-notes-0.2.0.md) — What's new and what to
  check when upgrading from 0.1.x.

## Use and automate

- [Entities, controls, and actions](automation.md#entity-contract) — Use the
  complete Home Assistant surface exposed by one robot.
- [Saved cleaning plans](automation.md#saved-plans) — Choose rooms, customize
  per-room cleaning, and save the top-to-bottom order.
- [Intelligent rotation](automation.md#intelligent-rotation) — Prioritize rooms
  that have waited longest when a cleaning window ends early.
- [Events and blueprints](automation.md#events-and-observability) — Build
  presence, schedule, dashboard, and custom automation workflows.
- [Map and cleaning experience](../README.md#cleaning-ux-and-automation) — Add
  the local floor-plan camera and configure room-aware plans.

## Privacy and security

- [Privacy and local-data model](privacy.md) — Review stored credentials,
  diagnostics, room and map data, backups, and deauthorization.
- [Security policy](../SECURITY.md) — Understand the security model and report a
  vulnerability privately.
- [Recording-related protocol notes](recording-protocol.md) — Review observed
  camera and microphone semantics that are intentionally outside the
  integration's supported controls.

## Project

- [Contributing](../CONTRIBUTING.md) — Set up development, run the required
  checks, and prepare a focused pull request.
- [License](../LICENSE) — MIT License.
- [Release](https://github.com/ProspectOre/matic-home-assistant/releases/latest)
  — Download the current published version and review its release notes.

## Support

Start with [limits and troubleshooting](../README.md#limits-and-troubleshooting)
and the relevant guide above. If the problem remains:

- [Ask the Home Assistant community](https://community.home-assistant.io/t/matic-unofficial-local-robot-vacuum-control-map-room-plans-and-intelligent-rotation/1017684)
- [Report a bug](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=feature_request.yml)

Home Assistant diagnostics are created only when you click **Download
diagnostics**. The report uses a strict safe-field allowlist and omits map, room,
Wi-Fi identity, schedule, session, credential, address, and certificate context;
inspect it before sharing anyway.
