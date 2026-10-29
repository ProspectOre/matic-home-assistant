# Matic 0.5

Matic 0.5 is the biggest update yet. A new Matic Map puts planning, cleaning
and results in one place. Room schedules mop or vacuum deeper when it's due,
and you decide how a run stops. Maps, plans and everyday control stay local to
your home.

## Highlights

- **Matic Map, rebuilt.** Photographic 3D and top-down 2D maps with smooth
  touch, mouse and keyboard control, from a phone to a wall tablet.
- **Plans with rooms and custom areas.** Mix rooms and drawn areas in one plan,
  see the run before it starts, and keep favorites one tap away.
- **Room schedules.** Mop every few cleans or rotate in a deeper vacuum.
  Progress counts across all plans, and only finished work counts.
- **Smart Stop.** Finish the current room before docking, or stop now and dock.
- **Clear results.** Finished rooms, active cleaning time and a room time
  estimate that learns from your home.

## Matic Map

- **3D or 2D.** Switch between photographic 3D and top-down 2D, shown as Photo
  or Room colors. Room names, boundaries and colors are easier to read, and on
  small screens labels make way for the rooms that matter.
- **Move the map your way.** Zoom from 100% to 1000%, pick a preset, or use
  **Fit map** to see the whole floor. On touch, one finger moves, pinch zooms,
  twist rotates and two fingers sliding up or down tilt the 3D view. A gesture
  keeps its mode until you lift your fingers, so the map never jumps. **How to
  move the map** explains mouse, touch and drawing controls.
- **Full map.** Give the floor the whole screen while status and controls stay
  in reach.
- **A home screen that fits your house.** Keep favorite plans and custom areas
  as shortcuts, then show, hide or reorder them with **Edit shortcuts**.
- **Map history.** Browse dated saved maps, read only, then return to the live
  map. Cleaning always waits for a live map that is ready.
- **Large homes.** Big single-floor homes keep up to 4 times more map detail
  within a fixed memory budget. A map an earlier version cut short keeps its
  warning until the robot sends the missing parts. The map stays visible while
  the robot reconnects.

## Plans and custom areas

- **Run and Edit, kept apart.** A plan opens in **Run**, showing the order,
  each room's settings and what's due. **Edit** keeps your changes as a draft
  until you save or discard them.
- **Rooms and custom areas together.** Draw a custom area, such as a rug or the
  spot by the litter box, and add it to any plan, or build a plan of areas only.
  Each area runs as its own part with its own settings, so the robot returns to
  the dock before the next room or area. Rooms that share settings run together;
  a settings change starts a new part, and the robot may stop at the dock first.
- **Choose the order.** **Smart Order** gives the rooms and areas that have
  waited longest an earlier turn. **Saved order** follows your sequence every
  time.
- **Clean a few rooms now.** **Clean rooms** picks rooms for a one-time clean
  without saving a plan.
- **Areas that survive map updates.** When the robot refines its map, saved
  areas stay put if Home Assistant can match them. If it can't, **Confirm area
  on current map** lets you check the outline without starting a clean.

## Room schedules

- **Mop or vacuum deeper when it's due.** Set a room to mop every few cleans, or
  to rotate in a Quick, Optimal or Heavy duty vacuum. See what's due before
  each run, do it once on the next clean, or reset progress.
- **Progress across all plans.** New room schedules count cleans from every plan
  by default. Choose **In this plan only** for a separate pattern. Deleting a
  shared schedule names the plans it affects and keeps their usual settings and
  history.
- **One-time cleans do the due work too.** A one-time clean can use a room's
  shared schedule, including mop and vacuum and mop requests. Review each
  room's settings first, or turn due work off for that clean. Work you skip
  stays due, and mop-only work never resets a due vacuum rotation.
- **Only finished work counts.** A room that is stopped, interrupted or can't be
  confirmed doesn't move its schedule forward. A vacuum rotation stays due until
  its deeper clean finishes.

## While it cleans

- **Smart Stop.** Set how far into a room the robot must be for Stop to finish
  that room before docking. Later rooms wait for the next run. While the room
  finishes, **Stop now & dock** overrides it immediately.
- **Progress you can read.** See finished rooms, active cleaning time and an
  estimate for the current room. The estimate learns from finished runs with
  the same cleaning mode and coverage, and stays blank until it has enough
  history. Times show in hours and minutes.
- **Results that stay.** An unfinished or unconfirmed run stays visible after
  docking, and status says when the robot is stopping, returning or checking a
  result.

## Home Assistant

- **Automation triggers.** **Room finished**, **Plan finished** and **Cleaning
  finished** device triggers. Refreshed blueprints explain every input and only
  start when the robot is docked or idle. Re-import them to get the update.
- **A tidier device page.** Standard vacuum controls come first. Plan and area
  buttons and selectors are opt-in, and default cleaning settings live under
  Configuration. Entities and automations you already use keep working.
- **Dashboard maps.** Both map cameras send correct PNG images, including the
  resized images Home Assistant cards ask for.
- **Assist and MCP.** Administrators can ask a tool-capable Assist agent about
  plans, readiness, activity and history, or have it run a plan, clean rooms,
  stop, or reset room schedule progress.
- **Firmware awareness.** Firmware comparisons and an optional notification
  blueprint point out robot updates that matter to the integration. The robot
  still installs its own firmware.
- **Pairing.** Clearer progress and recovery. **Robot was reset** checks that
  it's your robot before saving a new pairing, and keeps plans and custom areas.

## Before you update

0.5 requires **Home Assistant 2026.10 or later**.

1. Make a Home Assistant backup and check that it completed.
2. Let the robot finish and dock.
3. Update **Matic (Unofficial)** in HACS, then restart Home Assistant.
4. Open Matic Map and check that the live map loads.

Plans, room settings and custom areas carry over, and room time estimates are
kept per cleaning setting from now on. To go back to 0.4, restore the backup
you made before updating: reinstalling the 0.4 files alone can't read the 0.5
plan data. See the [rollback guidance](verification-0.5-rc24.md).

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

## Good to know

- Assist conversations need a configured tool-capable agent. Home Assistant's
  built-in sentence agent doesn't run these tools.
- Pairing import for hosts without Bluetooth is experimental.
- Matic Map ships in English. Layouts handle longer and right-to-left text,
  but there are no translations yet.
- A dedicated cleaning history view is planned for 0.6. Saved maps and the
  latest run results are available now.

Every change since 0.4 is listed in the release candidate notes, from
[RC7](release-notes-0.5.0-rc7.md) to [RC43](release-notes-0.5.0-rc43.md), plus
the final large-home, touch gesture and one-time due work changes above.
Testing scope and limits are in [0.5 qualification](verification-0.5-stable.md).
