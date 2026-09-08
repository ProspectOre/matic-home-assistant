# Compatibility

[Documentation](README.md) · [Firmware observations](firmware-compatibility.md)

## Requirements

- **Home Assistant 2026.7+**. Live use has covered 2026.7 and 2026.8.
- A Matic robot reachable over the local network, with multicast discovery available.
- A Bluetooth adapter built into or attached to the Home Assistant host for setup and credential recovery. Proxies cannot pair the robot.
- A Home Assistant administrator for the interactive map and saved-area editor.

Home Assistant OS handles Bluetooth setup. Container installations need host
BlueZ, D-Bus access, and the permissions in the [pairing guide](hermes-pairing.md).

## Firmware and maps

The integration uses Matic's private local protocol, so robot updates can affect
compatibility. The [firmware table](firmware-compatibility.md) records observed
versions. A localization issue on firmware 172.15/protocol 25 remains tracked in
[issue #65](https://github.com/ProspectOre/matic-home-assistant/issues/65).

Saved areas may need confirmation after a map change. Older integration versions
may not display maps from newer firmware; keep a backup when updating.

Matic Cues uses the robot's own voice service. See [privacy](privacy.md#matic-cues)
before enabling it.
