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

**[Documentation](docs/README.md)** — Installation, local pairing, cleaning
plans, automation, privacy, and troubleshooting.

## Status

Home Assistant 2026.7 is the tested baseline and the minimum version accepted by
HACS. Compatibility with other Home Assistant releases has not been validated.

The integration has been tested on a real robot and a stock Home Assistant
Yellow. One robot creates 51 fixed entities — 21 sensors, 12 binary sensors,
5 buttons, 4 switches, 4 selects, 1 number, 2 cameras, 1 update, and 1 vacuum —
plus two opt-in room statistics sensors per mapped room.
Setup, state, map, cleaning, and settings paths have been exercised on the robot,
and the integration is covered by automated tests.

## Features

- Zeroconf discovery, pinned Matic TLS identity, Bluetooth credential issuance,
  authenticated local sessions, reload, and unload.
- Start/resume, pause, stop, dock, full-floor cleaning, named-room
  cleaning, and Home Assistant Area-to-room mapping.
- A visible-by-default labeled room-map camera, plus a default-disabled private
  photographic SLAM camera and admin-only 3D Map Studio.
- Activity, battery, rooms, hardware/software/protocol, current area, update,
  Wi-Fi, schedule, local cleaning history, dock/sink, Matter-pairing,
  robot SSH-tunnel permission, diagnostic-upload state, and persistent firmware
  compatibility health.
- Controls for child lock, pet-waste avoidance, Hey Matic, double-pass mopping,
  and water flow.
- Payload-free endpoint inspection and persistent weekly firmware compatibility
  snapshots for every known non-credential Hermes read surface.

## Home Assistant capabilities

The integration adds Home Assistant-native planning and automation:

- **Saved cleaning plans.** Named, reusable plans with a per-room cleaning
  mode and coverage level, include toggles, and drag-orderable room lists,
  managed alongside custom areas in the Matic Map **Cleaning** workspace. Each plan can stop
  immediately or finish a sufficiently progressed current room without
  starting the next one. During an uninterrupted plan, the next room starts
  as soon as the current room finishes; the robot docks only after the final
  room.
- **Fair intelligent rotation.** A plan run starts with the room least recently
  given a cleaning opportunity, using shared room opportunity history and saved
  order to break ties. Priority changes only after the robot reports the
  commanded room as its current cleaning area; a rejected command or lingering
  prior-room state does not move it. Last-cleaned history advances only after a
  matching robot-native record reports verified completion.
  Stopping partway never credits the room or changes its learned duration, but a
  room that started cannot monopolize every short run if it later fails. Duration
  learning is shared across plans only when the robot, stable room ID, cleaning
  mode, and coverage level all match.
- **Top-to-bottom runs.** Deterministic whole-plan runs in the exact saved
  room order, every time.
- **Plan operations as actions.** Preview, run, stop-and-dock, history
  reset, and plan management are Home Assistant actions, so schedules,
  presence, and scripts can drive them unattended.
- **Hey Matic control.** Enable or disable the robot's voice activation
  from a switch — and therefore from any automation, scene, or schedule.
- **Room-level automation events.** `room_started`, `room_completed`,
  `room_failed`, `room_interrupted`, `room_cancelled`, and
  `room_ended_unverified` events per run, with Home Assistant Area-to-room
  mapping. Only `room_completed` advances successful history.
- **A dashboard map.** The live floor-plan camera renders rooms, labels,
  and robot pose on any dashboard with a standard Picture Entity card.
- **A private 3D map workspace.** The admin-only Matic Map sidebar panel renders
  the robot's local color SLAM point cloud through clear **3D** and **2D** views.
  The 2D appearance can use the photo map or stable labeled room map. It supports orbit, pan, pinch,
  twist, tilt, mouse-wheel zoom, trackpad navigation, fit, refresh, keyboard
  control, full-screen use, live point-cloud deltas, a private map timeline,
  mode-specific camera framing, and last-good-scene recovery. A compact native
  toolbar preserves map space, 2D stays aligned and planar, and the room map
  stays centered at any aspect ratio. No map is uploaded to a vendor or third
  party.
- **Painted custom areas.** Open **Matic Map → Cleaning → Custom areas**, focus a labeled
  room, and paint over the authenticated Photo or Rooms layer without
  leaving the map workspace. Erase mistakes or move the map independently,
  then save the footprint by name, run it immediately,
  or call it from an automation. Geometry stays in Home Assistant; action calls
  contain only the saved name. The device page also exposes a **Custom cleaning
  area** select and **Clean selected area** button for native dashboards and
  automations. The Configure flow remains available as a compatibility entry
  point.

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
   turn on Pairing mode. The robot's screen stays on its idle view until
   pairing actually starts, and the window expires silently — open it right
   before the next step.
3. Select **Pairing mode is on**, then **Submit** in Home Assistant and keep
   the setup dialog open. Setup narrates its progress; when Bluetooth pairing
   starts, Matic displays a six-digit code and Home Assistant asks for it.
4. Enter the code right away — each code is valid for roughly 20 seconds, and
   if it lapses the flow automatically starts a fresh pairing and asks for the
   robot's new code. Home Assistant then requests its own local credential and
   verifies the robot's pinned TLS identity before saving.

Any displayed six-digit code belongs only to the current pairing attempt and is
never stored by the integration. After setup, routine operation uses the robot's
encrypted local service. See [Hermes pairing](docs/hermes-pairing.md) for
pairing and platform requirements.

## Cleaning UX and automation

The map is a visible camera entity and can be added directly to any dashboard
with a Picture Entity card. Each plan is created or edited in the room-aware
**Matic Map → Cleaning → Plans** view: plan name, cleaning order, return-to-dock, every mapped
room, include toggles, per-room mode/coverage dropdowns, and saved top-to-bottom
order. The Configure flow remains available as a compatibility entry point.

The adjacent **Matic Map → Cleaning → Custom areas** view uses the same private photo map,
room geometry, and saved-area store as **Configure → Custom cleaning areas**. Draw over the
local room map, choose the saved mode and coverage, and name the result (for
example, `Litter box`). Automations call `matic_robot.clean_area` with that
name, so coordinates never appear in automation YAML, Logbook service data, or
diagnostics. Each saved area is bound to the floor/map geometry it was drawn
against; after a remap or floor change, the integration blocks the stale area
instead of sending old coordinates. The editor opens as a full-screen workspace with room labels,
room focus, separate Draw and Pan modes, cursor-centered zoom, Undo/Redo,
reversible Clear, keyboard controls, and a clear return to Home Assistant's
name/settings form.

Use **Intelligent rotation** when cleaning windows vary: it starts with rooms
that have waited longest since their last cleaning opportunity and uses shared
opportunity history plus saved order to break ties. Use
**Run all — top to bottom** when every selected room should clean in the saved
order every time. Room actions resolve stable map IDs before display names and
reject ambiguous names instead of targeting an arbitrary room.

Entities and actions work with standard Home Assistant automations, scripts,
scenes, schedules, and dashboards. Ready-to-import blueprints live in
`blueprints/automation/matic_robot/`. The entity contract, action reference,
and automation guidance are in [the automation reference](docs/automation.md).

## Privacy model

Routine traffic stays local between Home Assistant and the robot. The
integration has no telemetry, crash uploader, analytics endpoint, or maintainer
cloud.

If a user explicitly clicks **Download diagnostics**, Home Assistant generates
a local report from a strict safe-field allowlist. It omits credentials,
addresses, certificate identity, serial numbers, names, maps, pose, room and Area
context, Wi-Fi identities, schedules, and session details. See
[the privacy model](docs/privacy.md).

The photographic SLAM cache can reveal the layout and contents of a home. It is
stored only in private Home Assistant integration storage, may be included in a
Home Assistant backup, and is deleted with the config entry. Its camera is
disabled by default and the interactive Map Studio and scene endpoints require
an administrator. Treat screenshots, backups, and enabled camera access as
sensitive household data.

## Official Matic Home Assistant support

Matic also documents an official Home Assistant connection path. This project
is separate: it is an unofficial, community-maintained, local Hermes integration
for users who want its entity model, saved plans, local map workspace, and
automation surfaces. Do not configure both integrations to issue competing
motion commands unless you understand how each one arbitrates an active robot
task. For the vendor-supported route, follow Matic's
[Home Assistant guide](https://support.maticrobots.com/how-to-connect-matic-to-home-assistant).

## Bluetooth permissions

Home Assistant OS manages supported local Bluetooth adapters; the robot-display
passkey flow was tested on Home Assistant Yellow. For setup, place the local
adapter within a few feet of Matic with as little furniture or other obstruction
between them as practical; receiving a passive advertisement from farther away
does not prove the adapter can sustain the interactive pairing connection.
Home Assistant Container
installations need `NET_ADMIN`, `NET_RAW`, and the read-only host D-Bus socket;
follow Home Assistant's [Bluetooth container instructions](https://www.home-assistant.io/integrations/bluetooth/#additional-details-for-container).
If Home Assistant reports the adapter as degraded, fix that repair and restart
before pairing. Bluetooth is used only for authorization; routine operation
uses the LAN.

## Limits and troubleshooting

- Firmware changes can require an integration update because this is an
  unofficial local protocol integration. Check the
  [firmware compatibility ledger](docs/firmware-compatibility.md) for observed
  versions and validation status. A newly observed version emits the
  `matic_robot_firmware_changed` event; run the **Firmware snapshot** action to
  compare all known read endpoints with the prior snapshot. A Repair is created
  only when that comparison finds compatibility drift.
- Rooms without an exact Area name or unique alias require one manual mapping.
- Managed plans require unique mapped room names because the robot's completion
  ledger identifies rooms by name. Duplicate names are blocked before motion
  instead of risking credit to the wrong room.
- Home Assistant motion actions are serialized per robot. Starting another
  Home Assistant clean, custom-area clean, stop, or dock replaces a managed
  plan; pause/resume keeps it resumable. Commands from the official app or
  another client cannot be intercepted before the robot receives them, so avoid
  concurrent control during a managed plan.
- The room camera is geometric. The optional photographic camera and Map Studio
  use the robot's accumulated local SLAM color/structure data, not a live video
  stream or recording browser. Map detail arrives only while the robot emits
  pages; it can be incomplete, stale, or unavailable after a remap, stream
  interruption, storage limit, or unsupported firmware.
- Map Studio starts with one bounded full scene, then long-polls authenticated
  revision changes and applies compressed point-cloud deltas. If its retained
  base is unavailable or a delta would be inefficient, the same request returns
  a complete scene. During mission rollover, the live workspace keeps the last
  complete checkpoint under the current robot-position overlay until the new
  scene is complete; the status identifies that retained-map state. Private,
  time-spaced map checkpoints are limited to 12 items and 48 MiB of compressed
  data; deleting the integration removes them. Map health is not proof that
  every part of the home has been scanned.
- Pairing credentials, certificate secrets, Wi-Fi passwords, account tokens,
  Matter setup codes, and arbitrary raw writes are never exposed.
- If discovery fails, confirm the robot and Home Assistant share a
  multicast-capable LAN.
- Every Bluetooth pairing displays a fresh six-digit code on Matic. Enter that
  code only in the active Home Assistant setup dialog.
- If a displayed code expires or is rejected, turn Pairing mode off and back on
  before retrying. The flow returns to confirmation instead of waiting on a
  replacement code that current Matic firmware may not issue.
- If setup times out, review **Settings → System → Logs** for the sanitized
  `matic_robot` pairing-timeout entry before retrying.
- A new Bluetooth pairing deliberately proves physical access: someone at the
  robot must read its displayed code, and Home Assistant must use a Bluetooth
  adapter built into or directly attached to its host for that interactive
  exchange. Bluetooth proxies are not supported for setup. If a proxy can see
  Matic but the local adapter cannot, move the local adapter closer and remove
  obstructions. If pairing fails, temporarily disable Bluetooth proxies while
  retrying so discovery and pairing stay on the local adapter. If that adapter
  still misses fresh advertisements, reload its Home Assistant integration or
  replug it before retrying. Routine use is LAN-only after authorization.
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
