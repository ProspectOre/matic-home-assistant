# Local pairing

[Documentation home](README.md) · [Project overview](../README.md) ·
[Firmware ledger](firmware-compatibility.md) · [Get support](README.md#support)

Status: initial pairing and reauthentication were physically verified with Home
Assistant 2026.7 and the built-in Bluetooth adapter in Home Assistant Yellow.
Initial pairing was also verified on Home Assistant Container with a local
BlueZ adapter on an ARM64 Linux host and Matic firmware v171.10 while validating
the unreleased scanner-cache correction tracked in
[issue #31](https://github.com/ProspectOre/matic-home-assistant/issues/31). See
the firmware ledger for version-specific observations.

This independent community integration is not affiliated with, endorsed by, or
supported by Matic Robots Inc.

## Setup

1. Home Assistant discovers the robot on the local network and verifies its
   Matic-signed identity.
2. In the Matic app, open **Settings → Connectivity → Add another user** and
   enable Pairing mode.
3. Select **Pairing mode is on**, then **Submit** in Home Assistant. When Home
   Bluetooth pairing starts, Matic displays a six-digit code and Home Assistant
   asks for it.
4. Enter the code when prompted. Bluetooth gives roughly 20 seconds to enter
   it before the exchange times out, so type it right away. If the code expires
   or is rejected, turn Pairing mode off and back on before retrying. Matic
   firmware does not reliably issue a replacement code inside the same pairing
   window. Setup creates the entry only after the new local credential and an
   authenticated robot connection are both verified.

Any displayed code applies only to the current attempt. The integration does
not log, store, or include it in diagnostics. Routine operation uses the
encrypted local network connection; Bluetooth is required only for
authorization.

## Bluetooth requirements

Home Assistant OS manages supported local Bluetooth adapters. Home Assistant
Container requires host BlueZ, a read-only `/run/dbus` mount, and the
`NET_ADMIN` and `NET_RAW` capabilities documented by Home Assistant. Restart
the container after changing those settings.

A new Bluetooth pairing deliberately proves physical access: someone at the
robot must read its displayed code. Home Assistant must use a Bluetooth adapter
built into or directly attached to its host for that interactive exchange;
Bluetooth proxies are not supported for setup. Put the local adapter within a
few feet of Matic with a clear path when possible. Passive advertisement range
can be longer than reliable interactive-connection range, so a proxy seeing the
robot does not prove the local adapter is close enough. Home Assistant Container
uses the host's Linux BlueZ stack, which is why the D-Bus access and container
permissions above are required.

## Troubleshooting signatures

Enable debug logging (`custom_components.matic_robot: debug`) and match the
repeated line during a failing attempt:

- `Found 0 local Matic advertisement cache entry(ies)` — Home Assistant's local
  connectable scanner does not currently retain a name or service UUID that
  identifies Matic. Put the adapter within a few feet of Matic with minimal
  obstruction, enable Pairing mode, and submit again promptly. If the local
  scanner also cannot hear nearby Bluetooth devices, reload the Bluetooth
  integration or replug the adapter; if a 10-second `bluetoothctl scan on`
  still hears nothing, reboot the Home Assistant host. If nearby transmitters
  remain visible but Matic does not, compare with a phone-side scan and report
  the installation, adapter, integration, Home Assistant, and firmware
  versions.
- Integration 0.3.3 logged `Found 0 fresh local Matic advertisement(s)` when
  Home Assistant retained an otherwise valid Matic entry whose object and
  timestamp did not change during one requested scan. Identical advertisements
  may be deduplicated, so that was not proof that the robot was silent. Version
  0.3.3 is affected; use issue #31 and its linked pull request to track the
  correction until a released version is named. As a diagnostic, if BlueZ
  shows the Matic name and service UUID while 0.3.3 continues to log zero, this
  known false-negative path is a likely cause.
- `visible only through a remote Bluetooth proxy` — only ESPHome proxies can
  see the robot. Temporarily disable all Bluetooth proxies while retrying, and
  move or extend the adapter built into or attached to the host closer to
  Matic; only that local adapter can complete setup.
- `failed during Bluetooth pairing` — the bond itself failed; the robot shows
  its code only after the bond starts, and each displayed code is valid for
  roughly 20 seconds.
- The pairing-timeout warning in Settings → System → Logs always includes the
  last failing stage, so include it in bug reports.

Home Assistant integrations using its supported Bluetooth API share the same
scanner, and concurrent active-scan requests are deduplicated. Temporarily
disabling another BLE integration can be a useful diagnostic, but a successful
retry does not by itself prove that integration caused the failure; first rule
out distance, obstruction, a stale pairing window, and an adapter that needs a
reload, replug, or host reboot. Bluetooth proxies are the exception: disable
them temporarily during a troubled pairing attempt so the local adapter is the
only Bluetooth path presented to setup.

Initial setup, explicit credential replacement, and reauthentication all need a
Matic entry in the local scanner cache before the integration can try to connect
or clear a stale bond. A retained local entry can outlive the live
advertisement, so a connection-stage failure does not prove pairing started.
Routine operation is LAN-only while the saved credential remains valid, but an
owner who later needs credential recovery still depends on this Bluetooth path.

## Failure behavior

- Invalid, expired, and rejected codes are never reused.
- After an expired or rejected code, the flow returns to Pairing-mode
  confirmation. Turn Pairing mode off and back on before retrying so Matic
  issues a fresh code.
- Cancelling setup releases the temporary Bluetooth pairing agent.
- Certificate, identity, credential, and authenticated-connection failures stop
  setup before an entry is created.
- A Bluetooth failure directs the user to Home Assistant's Bluetooth repair.
- A timeout writes a sanitized `matic_robot` entry to **Settings → System →
  Logs** with the last completed setup result.

## Removing access

Deleting the integration entry erases Home Assistant's credential and stops the
integration. The tested Matic app and local service do not expose a verified
per-user revoke operation, so entry deletion does not prove that the robot
erased its copy. See the [privacy model](privacy.md).
