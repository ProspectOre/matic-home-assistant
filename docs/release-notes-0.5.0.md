# Updating to 0.5

[All guides](README.md) · [Compatibility](firmware-compatibility.md) · [Troubleshooting](troubleshooting.md)

What changed in 0.5 is summarized in the
[0.5.0 release](https://github.com/ProspectOre/matic-home-assistant/releases/tag/v0.5.0)
and told in full in the
[notes kept with that release's source](https://github.com/ProspectOre/matic-home-assistant/blob/v0.5.0/docs/release-notes-0.5.0.md).
This page keeps the steps for coming from 0.4, and the entities 0.5 removed.
From 0.4, follow them to 0.5.4 before updating to 0.6.

## Before you update

0.5 requires **Home Assistant 2026.10 or later**.

1. Make a Home Assistant backup and check that it completed.
2. Let the robot finish and dock.
3. Update **Matic (Unofficial)** in HACS, then restart Home Assistant.
4. Open Matic Map and check that the live map loads.

Plans, room settings and custom areas carry over. To go back to 0.4, restore
the backup you made before updating: reinstalling the 0.4 files alone can't
read the 0.5 plan data. Restoring also removes plans, room settings and
cleaning results made after that backup, so note any you want to keep first.

Entity IDs stay the same, though some names are clearer. 4 duplicate entities
are removed, so update any dashboards or automations that use them (examples
use a robot named Matic):

| Removed entity | Use instead |
| --- | --- |
| `binary_sensor.matic_active_cleaning_session` | `binary_sensor.matic_cleaning` |
| `binary_sensor.matic_update_available` | `update.matic_firmware` |
| `sensor.matic_software_version` | Software version on the device page |
| `sensor.matic_hardware_revision` | Hardware version on the device page |

Enabled and disabled choices for existing entities are kept. New installs hide
some duplicate status and technical entities by default.
