<p align="center"><img src="custom_components/matic_robot/brand/robot-mark.svg" alt="Robot vacuum icon" width="120"></p>

# Matic for Home Assistant

Make Matic part of your home routines: rotate fairly through rooms, save each
room's cleaning preferences, and start or stop plans as your household comes and goes.
Pair once over Bluetooth; everyday control, maps, and state use your local network.

**[Install](#install) · [Cleaning guide](docs/cleaning.md) · [Automations](docs/automation.md) · [All docs](docs/README.md)**

## Go beyond the app with Home Assistant

- **Give every room a turn.** Intelligent rotation starts with rooms that have waited longest. Short trips away won't keep restarting the same first rooms; cleaning from the Matic app also informs the order.
- **Build a plan around each room.** Save room order, vacuum/mop mode, and Quick, Optimal, or Heavy Duty coverage per room. Preview the next run before starting it.
- **Clean around your life.** Run plans when everyone leaves, schedule quiet-hours routines, or clean a named area after a litter-box cycle. Ready-to-import blueprints get you started.
- **Choose how to stop.** Stop immediately or let the active room finish based on a configurable progress estimate, then dock without starting another room.
- **Use cleaning results in your smart home.** Trigger actions on verified room completion, track last-cleaned times and durations, and distinguish completed, partial, and unattempted vacuum/mop work.

[Explore plans and rotation](docs/cleaning.md#saved-plans) ·
[Use the automation blueprints](docs/automation.md#ready-to-import-blueprints)

## Everything in one Home Assistant workspace

- **Map Studio:** interactive 3D and 2D maps, robot position, room selection, and saved map history.
- **Named custom areas:** draw and edit reusable outlines, including across room boundaries, then run them from a dashboard or automation.
- **Controls and dashboards:** start, pause, stop, dock, adjust robot settings, and use map cameras, sensors, and switches.
- **Run insight:** inspect plan outcomes, command activity, and per-mode history through local diagnostics and administrator-only read-only MCP tools.
- **Firmware tracking:** compare local protocol snapshots and see compatibility changes in Home Assistant.

Matic's app already offers [room and custom-area schedules](https://support.maticrobots.com/frequently-asked-questions).
This integration adds the plan logic, automation actions, and Home Assistant
visibility described above. See the [full feature guide](docs/features.md).

The integration has no telemetry or cloud service. Maps and plan data are stored
locally in Home Assistant. [Matic Cues](docs/privacy.md#matic-cues) uses Matic's own voice service.

## Install

Requires **Home Assistant 2026.7+** and a Bluetooth adapter built into or attached
to the Home Assistant host for pairing. Bluetooth proxies cannot complete setup.

1. In HACS, add [this repository](https://github.com/ProspectOre/matic-home-assistant) as a custom **Integration** repository.
2. Download **Matic (Unofficial)** and restart Home Assistant.
3. Open **Settings → Devices & services** and configure the discovered Matic.

If Matic is not discovered, add the integration manually and enter the robot's
address and port when offered.

For a manual install, copy `custom_components/matic_robot` into Home Assistant's
`custom_components` directory and restart.

### Local pairing

1. Place Matic near Home Assistant's local Bluetooth adapter.
2. In the Matic app, open **Settings → Connectivity → Add another user** and turn on Pairing mode.
3. Continue in Home Assistant and enter the six-digit code shown on the robot.

Enter the code promptly. If it expires, turn Pairing mode off and on before
retrying. [Pairing and recovery guide](docs/hermes-pairing.md).

### Updating

Back up Home Assistant, let the robot dock, update through HACS, and restart.
Saved plans, areas, and credentials are preserved. Check the map before cleaning;
areas affected by a changed map may need confirmation.

<a id="cleaning-ux-and-automation"></a>

## Cleaning

Open **Matic Map** from the sidebar:

- **One-time clean** selects rooms for a single run.
- **Create a plan** or **Run a plan** manages reusable room routines.
- **Clean a custom area** creates or selects a saved outline.
- **Map history** browses saved maps; saved floors are read-only.

Use Home Assistant schedules and presence automations to decide when plans run.
See the [cleaning guide](docs/cleaning.md), [entity reference](docs/entities.md),
and [automation examples](docs/automation.md).

<a id="limits-and-troubleshooting"></a>

## Help

- [Pairing and Bluetooth](docs/hermes-pairing.md#troubleshooting)
- [Compatibility](docs/acceptance-0.4.md) and [firmware notes](docs/firmware-compatibility.md)
- [Report a bug](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=bug_report.yml)
- [Community discussion](https://community.home-assistant.io/t/matic-unofficial-local-robot-vacuum-control-map-room-plans-and-intelligent-rotation/1017684)

[Privacy](docs/privacy.md) explains stored data and removal.
Report vulnerabilities through [Security](SECURITY.md).

## About

An independent community project, not affiliated with Matic Robots Inc.
Matic is its trademark; this project uses original robot artwork.
For vendor-supported setup, see [Matic's Home Assistant guide](https://support.maticrobots.com/how-to-connect-matic-to-home-assistant).

[MIT license](LICENSE) · [Contributing](CONTRIBUTING.md) · [All documentation](docs/README.md)

Buying a robot? The maintainer may receive store credit through this
[optional referral link](https://referrals.maticrobots.com/maticrobots/u/dbaef97f?sub=maticrobots).
