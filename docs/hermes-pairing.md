# Local pairing

[Documentation](README.md) · [Install](../README.md#install)

Pairing gives Home Assistant its own local robot credential. It requires a
Bluetooth adapter built into or attached to the Home Assistant host; proxies
cannot complete it. Normal use is over the LAN after pairing.

## Setup

1. Place the local Bluetooth adapter within a few feet of Matic.
2. In the Matic app, open **Settings → Connectivity → Add another user** and enable Pairing mode.
3. Select **Pairing mode is on** in Home Assistant and continue.
4. Enter the six-digit code shown on the robot as soon as Home Assistant asks.

The code lasts roughly 20 seconds. If it expires or is rejected, turn Pairing
mode off and on before retrying. The robot may stay on its idle screen until
the Bluetooth exchange starts. Home Assistant saves the credential only after
a successful authenticated connection; the displayed code is never stored.

## Home Assistant Container

The host needs BlueZ and a working local adapter. Give the container access to
D-Bus and these capabilities, then restart it:

```yaml
cap_add:
  - NET_ADMIN
  - NET_RAW
volumes:
  - /run/dbus:/run/dbus:ro
```

See [Home Assistant's Bluetooth requirements](https://www.home-assistant.io/integrations/bluetooth/#additional-details-for-container).
Home Assistant OS configures these requirements automatically.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| No local Matic found | Move the local adapter closer, reopen Pairing mode, and retry promptly. |
| Visible only through a proxy | Temporarily disable proxies and move the host's adapter closer. |
| Code expired or rejected | Turn Pairing mode off and on; use the new code. |
| Bluetooth connection fails | Check distance and obstructions. A proxy detecting Matic does not prove the local adapter can connect. |
| Local adapter sees no nearby devices | Reload Bluetooth or replug the adapter. Reboot the host if scanning still fails. |
| Pairing hangs or times out | Read the `matic_robot` warning in **Settings → System → Logs**; it identifies the failing stage. |
| Version 0.3.3 reports no fresh advertisement | Update to 0.3.4 or newer; older discovery discarded valid retained scanner entries. |

For more detail, enable `custom_components.matic_robot: debug`, reproduce once,
and include the relevant log lines in a bug report after removing private data.

## Reauthentication

When Home Assistant requests reauthentication, repeat the pairing steps. The
integration replaces its saved credential after the new connection succeeds.
Explicit credential replacement is also available through **Reconfigure**.
Both paths need the same local Bluetooth adapter as initial setup.

## Removing access

Deleting the integration removes Home Assistant's credential and stops its
connection. Robot-side revocation is separate; see [removing stored data](privacy.md#removing-the-integration).
