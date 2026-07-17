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
3. Select **Submit** in Home Assistant. When Home Assistant needs a new Bluetooth
   pairing, the robot displays a six-digit code and Home Assistant asks for it.
4. Enter the code when prompted. If this Home Assistant system already has a
   valid Bluetooth pairing with the robot, setup reuses it and may finish
   without a new code. Setup creates the entry only after the new local
   credential and an authenticated robot connection are both verified.

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
Bluetooth proxies are not supported for setup. This is not a signal-strength
limitation. Home Assistant Container uses the host's Linux BlueZ stack, which is
why the D-Bus access and container permissions above are required.

## Failure behavior

- Invalid, expired, and rejected codes are never reused.
- After an expired or rejected code, turn Pairing mode off and back on, select
  **Submit** in Home Assistant again, and enter the new code when prompted.
- Cancelling setup releases the temporary Bluetooth pairing agent.
- Certificate, identity, credential, and authenticated-connection failures stop
  setup before an entry is created.
- A Bluetooth failure directs the user to Home Assistant's Bluetooth repair.

## Removing access

Deleting the integration entry erases Home Assistant's credential and stops the
integration. The tested Matic app and local service do not expose a verified
per-user revoke operation, so entry deletion does not prove that the robot
erased its copy. See the [privacy model](privacy.md).
