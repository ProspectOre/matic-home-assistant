# Local pairing

[Documentation home](README.md) · [Project overview](../README.md) ·
[Get support](README.md#support)

Status: verified on a Matic robot with Home Assistant 2026.7 and the built-in
Bluetooth adapter in Home Assistant Yellow.

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
   it before the exchange times out, so type it right away; an expired code
   just means turning Pairing mode off and on and submitting again. Setup
   creates the entry only after the new local credential and an authenticated
   robot connection are both verified.

Any displayed code applies only to the current attempt. The integration does
not log, store, or include it in diagnostics. Routine operation uses the
encrypted local network connection; Bluetooth is required only for
authorization.

## Bluetooth requirements

Home Assistant OS manages supported local Bluetooth adapters. Home Assistant
Container requires the Bluetooth permissions and host D-Bus access documented
by Home Assistant, followed by a container restart.

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

- `Found 0 fresh local Matic advertisement(s)` — the robot is not
  reaching the local adapter during that scan. Turn Pairing mode off and back
  on, put the adapter within a few feet of Matic with minimal obstruction, and
  submit again promptly. If the local adapter still misses fresh advertisements,
  reload its Home Assistant integration or replug it. If a 10-second
  `bluetoothctl scan on` on the host hears no devices at all, the host's
  Bluetooth adapter is wedged — reboot the Home Assistant host.
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

## Failure behavior

- Invalid, expired, and rejected codes are never reused.
- After an expired or rejected code, turn Pairing mode off and back on, select
  **Submit** in Home Assistant again, and enter the new code when prompted.
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
