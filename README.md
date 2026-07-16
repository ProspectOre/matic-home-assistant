# Matic for Home Assistant

> Independent community project. Not affiliated with, endorsed by, or supported
> by Matic Robots Inc.

Matic is a trademark of Matic Robots Inc. The name is used only to identify
compatible hardware. This project does not use Matic's logo or product
photography.

An MIT-licensed Home Assistant custom integration for Matic robot vacuums.
Setup uses the robot's **Add another user** Bluetooth window. Routine control,
state, and maps use the robot's encrypted local service without Matter, cloud
relays, Apple Home credentials, or phone-data extraction.

## Status

Home Assistant 2026.7 is the currently tested release. Older and newer Home
Assistant releases are available for installation but have not yet been
validated by this project.

The integration has been tested on a real robot and a stock Home Assistant
Yellow. One robot creates 44 entities: 18 sensors, 12 binary sensors, 4 buttons,
4 switches, 3 selects, 1 number, 1 camera, and 1 vacuum.
Each exposed command is tested against a real robot and covered by automated tests.

## Features

- Zeroconf discovery, pinned Matic TLS identity, Bluetooth credential issuance,
  authenticated local sessions, reload, and unload.
- Start/resume, pause, stop, dock, full-floor cleaning, named-room
  cleaning, and Home Assistant Area-to-room mapping.
- Local map camera rendered from room geometry and robot pose; it contains no
  optical camera frames.
- Activity, battery, rooms, hardware/software/protocol, current area, update,
  Wi-Fi, schedule, local cleaning history, dock/sink, Matter-pairing,
  SSH-permission, upload, tunnel, and diagnostic state.
- Controls for child lock, pet-waste avoidance, Hey Matic, double-pass mopping,
  and water flow.
- Saved cleaning plans with per-room mode and coverage, drag/orderable rooms,
  least-recently-cleaned rotation, top-to-bottom runs,
  preview, stop-and-dock, history reset, and management actions.
- Bounded raw collection reads for known non-credential Hermes state.

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
3. Select **Submit** in Home Assistant. A six-digit code appears on the robot's
   screen.
4. Enter that code in Home Assistant. Home Assistant keeps the secure Bluetooth
   connection open, bonds only with the selected robot, requests its own local
   credential, and verifies the robot's pinned TLS identity before saving.

The six-digit code belongs only to the current pairing attempt and is never
stored by the integration. Routine operation moves to the encrypted local
network after setup. See [Hermes pairing](docs/hermes-pairing.md) for pairing
and platform requirements.

## Cleaning UX and automation

The map is a visible camera entity and can be added directly to any dashboard
with a Picture Entity card. The integration's **Configure** flow manages plans
in one screen: plan name, cleaning order, return-to-dock,
every mapped room, include toggles, per-room mode/coverage dropdowns, and saved
top-to-bottom order.

Use **Intelligent rotation** when cleaning windows vary: it starts with rooms
that have waited longest and uses the saved list order to break ties. Use
**Run all — top to bottom** when every selected room should clean in the saved
order every time.

All entity state and actions are normal Home Assistant surfaces, so automations
compose with the rest of Home Assistant. Ready-to-import blueprints live in
`blueprints/automation/matic_robot/`. The entity contract, action reference, and
automation guidance are in [the automation reference](docs/automation.md).

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

Home Assistant OS configures a local adapter automatically; the robot-display
passkey flow was tested on Home Assistant Yellow. Containers
need `NET_ADMIN`, `NET_RAW`, and the read-only host D-Bus socket; follow Home
Assistant's Bluetooth container instructions. If Home Assistant reports the
adapter as degraded, fix that repair and restart before pairing. Bluetooth is
used only for authorization; routine operation uses the LAN.

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
- If the code expires or is rejected, turn Pairing mode off and back on to make
  the robot display a fresh code, then start setup again and enter it promptly.
- First-time authorization deliberately proves physical access: someone at the
  robot must read its displayed code, and Home Assistant must use a Bluetooth
  adapter built into or directly attached to its host for that interactive
  exchange. Bluetooth proxies are not supported for setup. This is not a
  signal-strength limitation. Routine use is LAN-only after authorization.
- For bugs, download diagnostics and follow [SECURITY.md](SECURITY.md) and
  [CONTRIBUTING.md](CONTRIBUTING.md). Never attach credentials, maps, captures,
  backups, or Home Assistant storage publicly.

## Development

```sh
python -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest --cov=custom_components/matic_robot --cov-report=term-missing
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy custom_components
.venv/bin/python scripts/check_public_tree.py
```

Keep all private data out of git.
