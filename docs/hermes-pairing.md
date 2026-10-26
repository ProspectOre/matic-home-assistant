# Local pairing

[Documentation](README.md) · [Install](../README.md#install)

Pairing gives Home Assistant its own local robot credential. Use the host's
Bluetooth adapter; proxies cannot complete it. Normal use is over the LAN.
A host without an adapter can [paste a pairing made on another
device](#pair-on-another-device) (experimental).

## Setup

1. Place the local Bluetooth adapter within a few feet of the robot.
2. In the Matic app, open **Settings > Connectivity > Add another user** and turn on Pairing mode.
3. Choose **Start pairing** in Home Assistant.
4. Enter the six-digit code shown on the robot as soon as Home Assistant asks.

The code lasts roughly 20 seconds. If it expires or is rejected, turn Pairing
mode off and on before retrying. The robot may stay on its idle screen until
the Bluetooth exchange starts. Home Assistant saves the credential only after
a successful authenticated connection; the displayed code is never stored.

## Home Assistant Container

Setup reports "can't use a Bluetooth adapter" when this checklist is not met.
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
| Pairing hangs or times out | Read the `matic_robot` warning in **Settings > System > Logs**; it identifies the failing stage. |
| Existing Bluetooth pairing is reused but no code appears | If the credential write is rejected, setup asks **Remove the robot's saved pairing?** Select the affected robot by its Bluetooth name and address, enable Pairing mode, and submit. Setup removes only that bond once, rediscovers that device, and requests a fresh code. Cancel if you cannot identify the robot. |

For details, enable `custom_components.matic_robot: debug`; share only redacted logs.

Restarting Home Assistant does not clear Bluetooth bonds: they are stored by
the host's BlueZ service. If recovery still fails, remove only the affected
robot's bond on the host, reopen Pairing mode, and retry setup.

## Reauthentication

When Home Assistant requests reauthentication, repeat the pairing steps; the
saved credential changes only after the new connection succeeds. You can also
replace it through **Reconfigure**. Use a local adapter, including a replacement;
hosts without one offer **I already have a pairing** instead. See
[Pair on another device](#pair-on-another-device).

### More than one robot

Reauthentication and **Robot was reset** remove this robot's existing
Bluetooth pairing before asking for a code, so they never guess which robot to
pair. Each entry records the Bluetooth address of the robot that issued its
credential, saved only after that credential works on the robot. Robots
recorded by other entries are never contacted, by setup either. Of the rest,
Home Assistant uses this entry's recorded robot if it can see it, otherwise
the one robot heard advertising during the scan; a robot advertises only while
its Pairing mode is open. A robot only remembered from earlier scans is never
unpaired, so if none is advertising it stops with "can't see the robot". If
more than one is advertising, it stops with "can see more than one robot" and
changes nothing: turn Pairing mode off on the other robots, wait a few minutes
for their cached advertisements to expire, then retry. An entry paired by an
earlier version records its address the next time it pairs.

## Robot was reset

After a factory reset the robot presents a new certificate, so Home Assistant
stops talking to it and raises a Repair named after it, for example
**Can't confirm this is Kitchen**.
Choose **Fix**, or open the entry's ⋮ menu > **Reconfigure** > **Robot was
reset**. Plans, room settings, custom areas and history are kept; removing the
robot instead erases them.

1. If the robot's address changed too, open **Robot address** and enter it.
2. Turn on Pairing mode in the Matic app and choose **Start pairing**.
3. Enter the six-digit code from the robot's screen.

Before any code is requested, Home Assistant checks that the robot at that
address has a Matic certificate with the same serial number and hostname as
before. A robot with a different serial is refused (`different_robot`); add a
replacement robot as a new robot instead. Recovery then needs a new passkey
bond made through Home Assistant's own adapter: an existing bond is removed
first, and a reused bond, a proxy, or a pairing without a typed code ends with
"could not confirm a new Bluetooth pairing". Finally the new credential must
authenticate on the newly presented certificate. Only then are the new
certificate pin and credential saved, in one write, and the Repair cleared.
Any failure, or closing the dialog, leaves the old pin, credential and Repair
unchanged.

Trust limit: setup and recovery trust the Matic CA, serial and hostname.
Another Matic-CA key for that identity would also be accepted.

On a host without a local adapter, the form also offers **I already have a
pairing**. After the same certificate check, it asks for a pairing made on
another device after the reset, which must authenticate on the newly presented
certificate before the same single write. A reset robot no longer accepts
pairings made before the reset. See [Pair on another device](#pair-on-another-device).

## Pair on another device

Experimental. When Home Assistant has no Bluetooth adapter of its own, setup,
reauthentication, **Pair Home Assistant again** and **Robot was reset** show **I
already have a pairing**. It never appears on a host with a local adapter;
pair there instead.

1. On a Bluetooth-capable computer near the robot, turn on Pairing mode in the
   Matic app and make a pairing with the
   [community pairing tool](#community-pairing-tool).
2. In Home Assistant, turn on **I already have a pairing**, submit, and paste
   the pairing. A `Bearer: ` prefix or surrounding quotes are fine.
3. Home Assistant opens a connection pinned to the robot's certificate and
   checks that the robot accepts the pairing. Nothing is saved until it does;
   a refused pairing, a wrong address or an offline robot keeps the form open.

The pairing is a credential: anyone holding it can control the robot. Delete
the copy on the other computer once Home Assistant accepts it. Entries set up
this way show `"pairing_method": "import"` in their diagnostics, never the
pairing itself.

### Community pairing tool

The community pairing tool is maintained separately. Its default output and
platform coverage have not been qualified by this project. Use a helper only
after confirming it keeps the credential out of ordinary output and logs.
Tool maintainers and testers should follow the
[0.5 interchange contract and evidence checklist](pairing-import-contract.md).
The [community implementation](https://github.com/Apocrathia/matic-home-assistant/blob/main/docs/matic-pair.md)
must meet that contract before it can be treated as a verified compatible tool.

## Removing access

Deleting the integration removes Home Assistant's credential and stops its
connection. Robot-side revocation is separate; see [removing stored data](privacy.md#removing-the-integration).
