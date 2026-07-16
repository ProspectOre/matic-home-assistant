<p align="center"><img src="custom_components/matic_robot/brand/logo.svg" alt="" width="140"></p>

# Matic (Unofficial) for Home Assistant

> Independent community project. Not affiliated with, endorsed by, or supported
> by Matic Robots Inc.

Matic is a trademark of Matic Robots Inc. It is used here only to identify
compatible hardware. This project does not use Matic's logo or product photography.

An MIT-licensed Home Assistant custom integration for Matic robot vacuums.
Setup uses the robot's **Add another user** Bluetooth window. Routine control,
state, and maps use the robot's encrypted local service without Matter or cloud
relays.

## Status

Home Assistant 2026.7 is the tested baseline and the minimum version accepted by
HACS. Compatibility with other Home Assistant releases has not been validated.

The integration has been tested on a real robot and a stock Home Assistant
Yellow. One robot creates 44 entities: 18 sensors, 12 binary sensors, 4 buttons,
4 switches, 3 selects, 1 number, 1 camera, and 1 vacuum.
Setup, state, map, cleaning, and settings paths have been exercised on the robot,
and the integration is covered by automated tests.

## Features

- Zeroconf discovery, pinned Matic TLS identity, Bluetooth credential issuance,
  authenticated local sessions, reload, and unload.
- Start/resume, pause, stop, dock, full-floor cleaning, named-room
  cleaning, and Home Assistant Area-to-room mapping.
- Local map camera rendered from room geometry and robot pose; it contains no
  optical camera frames.
- Activity, battery, rooms, hardware/software/protocol, current area, update,
  Wi-Fi, schedule, local cleaning history, dock/sink, Matter-pairing,
  robot SSH-tunnel permission, and robot diagnostic-upload state.
- Controls for child lock, pet-waste avoidance, Hey Matic, double-pass mopping,
  and water flow.
- Bounded raw collection reads for known non-credential Hermes state.

## Home Assistant capabilities

The integration adds Home Assistant-native planning and automation:

- **Saved cleaning plans.** Named, reusable plans with a per-room cleaning
  mode and coverage level, include toggles, and drag-orderable room lists,
  managed in one Configure screen with live preview.
- **Least-recently-cleaned rotation.** A plan run can start with the rooms
  that have waited longest, using the saved order to break ties — no manual
  bookkeeping of what was cleaned last.
- **Top-to-bottom runs.** Deterministic whole-plan runs in the exact saved
  room order, every time.
- **Plan operations as actions.** Preview, run, stop-and-dock, history
  reset, and plan management are Home Assistant actions, so schedules,
  presence, and scripts can drive them unattended.
- **Hey Matic control.** Enable or disable the robot's voice activation
  from a switch — and therefore from any automation, scene, or schedule.
- **Room-level automation events.** `room_started`, `room_completed`,
  `room_failed`, and `room_cancelled` events per run, with Home Assistant
  Area-to-room mapping.
- **A dashboard map.** The live floor-plan camera renders rooms, labels,
  and robot pose on any dashboard with a standard Picture Entity card.

Camera and microphone recording, clip retrieval and caching, recording metadata,
and vendor share or discard decisions are not included because these
privacy-sensitive support operations can have external or irreversible effects.
See [Recording-related protocol notes](docs/recording-protocol.md).

## Install

In HACS, add this repository as a custom integration repository and install
**Matic (Unofficial)**. Restart Home Assistant, then complete the
Bluetooth authorization prompt.

For a manual install, copy `custom_components/matic_robot` into Home
Assistant's `custom_components`, restart, select the discovered robot under
**Settings → Devices & services**, and complete the Bluetooth prompt.

## Local pairing

1. Add **Matic (Unofficial)**. Home Assistant discovers the robot
   automatically; homes with multiple robots choose one from a list.
2. In the Matic app, open **Settings → Connectivity → Add another user** and
   enable its five-minute pairing window.
3. Select **Submit** in Home Assistant and keep the setup dialog open. When Home
   Assistant needs a new Bluetooth pairing, the robot displays a six-digit code
   and Home Assistant asks for it.
4. Enter the code when prompted. If this Home Assistant system already has a
   valid Bluetooth pairing with the robot, setup reuses it and may finish
   without a new code. In either case, Home Assistant requests its own local
   credential and verifies the robot's pinned TLS identity before saving.

Any displayed six-digit code belongs only to the current pairing attempt and is
never stored by the integration. After setup, routine operation uses the robot's
encrypted local service. See [Hermes pairing](docs/hermes-pairing.md) for
pairing and platform requirements.

## Cleaning UX and automation

The map is a visible camera entity and can be added directly to any dashboard
with a Picture Entity card. Each plan is created or edited on one room-aware
**Configure** screen: plan name, cleaning order, return-to-dock, every mapped
room, include toggles, per-room mode/coverage dropdowns, and saved top-to-bottom
order.

Use **Intelligent rotation** when cleaning windows vary: it starts with rooms
that have waited longest and uses the saved list order to break ties. Use
**Run all — top to bottom** when every selected room should clean in the saved
order every time.

Entities and actions work with standard Home Assistant automations, scripts,
scenes, schedules, and dashboards. Ready-to-import blueprints live in
`blueprints/automation/matic_robot/`. The entity contract, action reference,
and automation guidance are in [the automation reference](docs/automation.md).

## Privacy model

Routine traffic stays local between Home Assistant and the robot. The
integration has no telemetry, crash uploader, analytics endpoint, or maintainer
cloud.

If a user explicitly clicks **Download diagnostics**, Home Assistant generates
a local report for that user to inspect and share. The report redacts
credentials, addresses, certificate identity, and serial numbers while retaining
the user-owned map, room, Wi-Fi, schedule, and protocol state needed for
technical diagnosis. See [the privacy model](docs/privacy.md).

## Bluetooth permissions

Home Assistant OS manages supported local Bluetooth adapters; the robot-display
passkey flow was tested on Home Assistant Yellow. Home Assistant Container
installations need `NET_ADMIN`, `NET_RAW`, and the read-only host D-Bus socket;
follow Home Assistant's [Bluetooth container instructions](https://www.home-assistant.io/integrations/bluetooth/#additional-details-for-container).
If Home Assistant reports the adapter as degraded, fix that repair and restart
before pairing. Bluetooth is used only for authorization; routine operation
uses the LAN.

## Limits and troubleshooting

- Firmware changes can require an update because this is an unofficial local
  protocol integration.
- Rooms without an exact Area name or unique alias require one manual mapping.
- The map camera is a local floor-plan rendering. No optical-camera live stream
  has been verified or exposed.
- Pairing credentials, certificate secrets, Wi-Fi passwords, account tokens,
  Matter setup codes, and arbitrary raw writes are never exposed.
- If discovery fails, confirm the robot and Home Assistant share a
  multicast-capable LAN.
- A new code appears only when Home Assistant needs a Bluetooth pairing. If it
  is already paired with the robot, setup may finish without displaying one.
- If a requested code expires or is rejected, turn Pairing mode off and back on
  in the Matic app, select **Submit** again, then enter the fresh code when Home
  Assistant asks.
- A new Bluetooth pairing deliberately proves physical access: someone at the
  robot must read its displayed code, and Home Assistant must use a Bluetooth
  adapter built into or directly attached to its host for that interactive
  exchange. Bluetooth proxies are not supported for setup. This is not a
  signal-strength limitation. Routine use is LAN-only after authorization.
- For bugs, use the repository's bug-report form after reviewing and sanitizing
  diagnostics. Report vulnerabilities privately as described in
  [SECURITY.md](SECURITY.md). Never attach credentials, maps, captures, backups,
  or Home Assistant storage publicly.

## Development

```sh
python -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest --cov=custom_components/matic_robot --cov-report=term-missing
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy custom_components/matic_robot
.venv/bin/python scripts/check_public_tree.py
```

Keep all private data out of git.
