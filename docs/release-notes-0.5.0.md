# Matic 0.5

Matic 0.5 is a redesign. A new Matic Map puts planning, cleaning and results in
one place, plans can mix rooms with custom areas, and room schedules mop or
vacuum deeper when it's due. Maps, plans and everyday control stay local to
your home.

## Highlights

- **A new Matic Map.** A home screen built around your plans, a cleaner map
  and controls that feel natural on a phone, tablet or desktop.
- **Rooms and custom areas in one plan.** Clean the kitchen, the rug by the
  couch and the spot by the litter box in a single run.
- **Room schedules.** Mop every few cleans or rotate in a deeper vacuum, with
  progress shared across all your plans.
- **Run and Edit.** See exactly what a plan will do before it starts, and edit
  it as a draft you save or discard.
- **More from Home Assistant.** New device triggers, refreshed blueprints and
  Assist that can start and stop cleaning for you.

## A new Matic Map

- **Home screen.** The default plan's card shows what's due and runs with one
  tap. Pin favorite plans and custom areas as shortcuts, then show, hide or
  reorder them with **Edit shortcuts**.
- **Run and Edit, kept apart.** A plan opens in **Run** with its order, each
  room's settings and what's due. **Edit** keeps changes as a draft until you
  save or discard them.
- **A map that's easier to read.** Clearer room colors, stronger boundaries and
  smarter labels that make way for the rooms that matter on small screens.
  Choose Photo or Room colors in 2D or 3D.
- **Full map.** Give the floor the whole screen while status and controls stay
  in reach.
- **Natural touch and mouse control.** Zoom from 100% to 1000%, pick a preset,
  or use **Fit map** to see the whole floor. On touch, one finger moves, pinch
  zooms, twist rotates and two fingers sliding up or down tilt the 3D view. A
  gesture keeps its mode until you lift your fingers, so the map never jumps.
  **How to move the map** explains every control.
- **Clear status.** One status line says what the robot is doing, including
  when it's stopping, returning to the dock or checking a result.
- **Designed for every screen.** Compact controls, visible keyboard focus and
  layouts that adapt to rotation and large text.
- **Plain words.** Every label, message and action follows one copy style, so
  the same thing always has the same name.

## Plans with rooms and custom areas

- **Mix rooms and areas.** Add custom areas, such as a rug or the spot by the
  litter box, to any plan, or build a plan of areas only. Each area keeps its
  own cleaning mode and coverage.
- **How a plan runs.** Rooms next to each other run together as one part, each
  with its own settings; the robot may stop at the dock on its own to recharge
  or refill. Each area runs as its own part, so the robot returns to the dock
  after an area before the next room or area. With Smart Stop on, each room is
  its own part.
- **Choose the order.** **Smart Order** gives the rooms and areas that have
  waited longest an earlier turn. **Saved order** follows your sequence.
- **Clean a few rooms now.** **Clean rooms** picks rooms for a one-time clean
  without saving a plan.
- **Areas that follow map updates.** When the robot refines its map, areas stay
  put if Home Assistant can match them. If it can't, **Confirm area on current
  map** lets you check the outline without starting a clean.

## Room schedules

- **Mop or vacuum deeper when it's due.** Set a room to mop every few cleans, or
  to rotate in a Quick, Optimal or Heavy duty vacuum. See what's due before
  each run, do it once on the next clean, or reset progress.
- **Progress across all plans.** Room schedules count cleans from every plan by
  default. Choose **In this plan only** for a separate pattern. Deleting a
  shared schedule names the plans it affects and keeps their usual settings.
- **One-time cleans do the due work too.** A one-time clean can include a
  room's schedule, for vacuum, mop, or vacuum and mop. Review each room's
  settings first, or turn due work off for that clean. Skipped work stays due.
- **Only finished work counts.** A room that is stopped, interrupted or can't be
  confirmed doesn't move its schedule forward.

## While it cleans

- **Smart Stop, redesigned.** Choose how far into a room the robot must be for
  Stop to finish that room before docking. While it finishes, **Stop now &
  dock** overrides it immediately.
- **Progress you can read.** Finished rooms, active cleaning time and an
  estimate for the current room that learns from finished runs with the same
  cleaning mode and coverage. Times show in hours and minutes.
- **Results that stay.** An unfinished run stays visible after docking.

## Home Assistant

- **Device triggers.** **Room finished**, **Plan finished** and **Cleaning
  finished** are ready to use in automations.
- **Refreshed blueprints.** Every input is explained, and cleaning only starts
  when the robot is docked or idle. Re-import them to get the update.
- **A tidier device page.** Standard vacuum controls come first. Plan and area
  buttons and selectors are opt-in, and default cleaning settings live under
  Configuration. Entities and automations you already use keep working.
- **Assist that acts.** Administrators can ask a tool-capable Assist agent to
  run a plan, clean rooms, stop, or reset room schedule progress, as well as
  check plans, readiness and history.
- **Easier pairing.** Clearer progress and recovery. **Robot was reset** checks
  that it's your robot before saving a new pairing, and keeps your plans and
  custom areas.

## Before you update

0.5 requires **Home Assistant 2026.10 or later**.

1. Make a Home Assistant backup and check that it completed.
2. Let the robot finish and dock.
3. Update **Matic (Unofficial)** in HACS, then restart Home Assistant.
4. Open Matic Map and check that the live map loads.

Plans, room settings and custom areas carry over. To go back to 0.4, restore
the backup you made before updating: reinstalling the 0.4 files alone can't
read the 0.5 plan data. See the [rollback guidance](verification-0.5-rc24.md).

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
- A dedicated cleaning history view is planned for 0.6.

The release candidate notes, from [RC7](release-notes-0.5.0-rc7.md) to
[RC43](release-notes-0.5.0-rc43.md), list every change and fix since 0.4.
Testing scope and limits are in [0.5 qualification](verification-0.5-stable.md).
