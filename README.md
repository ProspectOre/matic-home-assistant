<p align="center"><img src="custom_components/matic_robot/brand/robot-mark.svg" alt="Robot vacuum icon" width="120"></p>

# Matic for Home Assistant

Local control, live maps, and room-by-room cleaning for Matic robot vacuums.
Pair once over Bluetooth; Home Assistant then connects directly over your LAN.

**[Install](#install) · [User guide](docs/cleaning.md) · [Automations](docs/automation.md) · [What's new in 0.4](docs/release-notes-0.4.md)**

## Features

- **Live maps:** explore your floor in 3D or 2D, follow the robot, and browse saved maps.
- **Room cleaning:** vacuum, mop, or both with Quick, Optimal, or Heavy Duty coverage.
- **Saved plans:** set each room's cleaning preferences and order, or rotate through rooms that have waited longest.
- **Custom areas:** draw an outline on the map, adjust its points, and save it for repeated use.
- **Home Assistant controls:** start, pause, stop, dock, adjust settings, and build routines with sensors, actions, and blueprints.
- **Cleaning history:** see vacuum and mop results separately, including partial and unattempted work.

Maps and cleaning data stay in Home Assistant. The integration has no telemetry
or cloud service. Optional Matic Cues follows [Matic's own voice-data policy](docs/privacy.md#matic-cues).

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

Review diagnostics and screenshots before sharing them. [Privacy](docs/privacy.md)
explains stored data and removal; report vulnerabilities through [Security](SECURITY.md).

## About

An independent community project, not affiliated with Matic Robots Inc.
Matic is its trademark; this project uses original robot artwork.
For vendor-supported setup, see [Matic's Home Assistant guide](https://support.maticrobots.com/how-to-connect-matic-to-home-assistant).

[MIT license](LICENSE) · [Contributing](CONTRIBUTING.md) · [All documentation](docs/README.md)

Buying a robot? The maintainer may receive store credit through this
[optional referral link](https://referrals.maticrobots.com/maticrobots/u/dbaef97f?sub=maticrobots).
