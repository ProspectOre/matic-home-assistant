# Troubleshooting

[All guides](README.md) · [Compatibility](firmware-compatibility.md) ·
[Report a bug](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=bug_report.yml)

Home Assistant raises a Repair for most things it needs from you. Check
**Settings > System > Repairs** first, then find what you see below.

## Setup and pairing

| What you see | What to do |
| --- | --- |
| No robot is found | Add **Matic (Unofficial)** yourself under **Settings > Devices & services** and enter the robot's address and port. |
| "can't use a Bluetooth adapter" | Home Assistant Container needs the [host Bluetooth setup](hermes-pairing.md#home-assistant-container). |
| The code expired, was rejected or never appeared | Turn Pairing mode off and back on in the Matic app, then follow the [pairing checklist](hermes-pairing.md#troubleshooting). |
| Home Assistant asks you to pair again | Repeat the pairing steps. Your plans and custom areas are kept ([details](hermes-pairing.md#reauthentication)). |
| A Repair says **Can't confirm this is {name}** | The robot was reset or replaced. Choose **Fix** and follow [Robot was reset](hermes-pairing.md#robot-was-reset). |

## The robot and the map

| What you see | What to do |
| --- | --- |
| Entities are unavailable, or Matic Map says **Robot offline** | Check that the robot is on and on Wi-Fi. If its address changed, open the integration's ⋮ menu, choose **Reconfigure** and update the address. |
| **Locating** | The robot is confirming which floor it is on. Cleaning comes back by itself once it has. |
| **Map limited** or **Map unavailable** | Home Assistant can't confirm the map well enough to start a clean. Cleaning comes back by itself when the live map is ready, and Stop keeps working. If it doesn't clear, [report it](#report-a-problem). |
| A custom area says **Map changed · Check it before cleaning** | Open it and choose **Confirm area on current map** or **Redraw** ([custom areas](cleaning.md#custom-areas)). |
| A Repair about a different time zone | The robot runs its schedules on its own clock. Change the time zone in the Matic app or in Home Assistant so they match. |
| A Repair about the bag or about maintenance | Follow the Repair; it clears when the robot stops reporting it ([maintenance](entities.md#maintenance)). |
| A Repair says some robot reads are failing | See [firmware checks](firmware-compatibility.md#automatic-firmware-checks). A failed read alone doesn't prove a firmware problem. |

## Cleaning

| What you see | What to do |
| --- | --- |
| A plan stopped, or the robot docked, when you didn't expect it | Something else may have taken over: the Matic app, the robot's button, voice or one of its schedules. A plan gives way to all of them. To see what happened, read [interrupted cleaning](activity-diagnostics.md). |
| A room wasn't counted, or **Last cleaned** didn't change | Only work the robot confirms counts. Stopped and partial rooms stay due ([cleaning results](native-cleaning-results.md)). |
| A room shows **Couldn't reach** | The robot couldn't get in, for example past a closed door. The room stays due and the plan moves on. |
| A plan leaves a room out | The room is occupied ([occupied rooms](cleaning.md#occupied-rooms)) or at its [daily clean limit](room-schedules.md#daily-clean-limit). The Run view names the reason. |
| Home Assistant restarted during a clean | The plan picks up where it can, and Home Assistant never repeats a cleaning command to do so ([restart recovery](restart-recovery.md)). |
| Skip, Clean next or Clean again is refused | See the [limits](queue-changes.md#limits) on changing a running clean. |
| A photo patrol is refused | Patrols are off until you allow them, and blocked rooms, battery and a cooldown apply ([photo patrol](photo-patrol.md#set-up-privacy-and-safety)). |
| The **Robot schedules** calendar looks wrong | Compare it with the Matic app, then follow [robot schedules](native-schedule-diagnostics.md). |

## After an update

Restart Home Assistant after every update, then open Matic Map and check
that the live map loads. Re-import a blueprint to get its newer version, and
reconnect an MCP client that still shows the old tool descriptions. To go back
to the release you had, restore the Home Assistant backup you made before
updating.

## Report a problem

1. Open **Settings > Devices & services > Matic (Unofficial)**, choose ⋮ on
   the robot's entry, then **Download diagnostics**, soon after the problem.
   The file leaves out addresses, serial numbers, names, maps and schedules
   ([what it contains](privacy.md#diagnostics)). Read it before you share it.
2. For pairing and connection problems, add this to `configuration.yaml`,
   restart, and reproduce the problem:

   ```yaml
   logger:
     logs:
       custom_components.matic_robot: debug
   ```

3. Open a [bug report](https://github.com/ProspectOre/matic-home-assistant/issues/new?template=bug_report.yml)
   with the integration version, your Home Assistant version and how it is
   installed, and the robot's firmware version. Remove room names, addresses
   and anything else about your home from logs first.

Report a security problem privately, through [Security](../SECURITY.md).
