# Matic 0.5 — Your home. Your cleaning routine.

Matic 0.5 brings a redesigned map workspace, more flexible cleaning routines,
and clearer results to Home Assistant. Move from a quick room clean to a saved
plan, see what is due before you start, and stay in control as the run unfolds.
Everyday control, maps, and plan storage remain local to your home.

## One workspace, from planning to results

- **A clearer home screen.** Keep favorite plans and custom areas within reach
  with shortcuts you can show, hide, and reorder. New plans and areas appear
  automatically; your existing hidden choices stay hidden.
- **Plans that are easier to use.** Separate Run and Edit views keep the next
  clean distinct from future changes. Preview effective settings and order,
  adjust individual rooms, and leave a draft with a clear save-or-discard choice.
- **Rooms and areas in one plan.** Mix rooms with saved custom areas, or use an
  area-only plan. Smart Order gives waiting rooms and areas an earlier turn;
  Saved order follows your sequence every time.
- **A more useful map.** Switch between photographic 3D and top-down 2D, with
  Photo and Room colors appearances. Selection stays in sync with the room list.
  Full map gives the floor more space while keeping status and controls nearby.
- **Precise navigation.** Set map zoom from 100–1000%, choose a preset, or use
  Fit map to recenter. On touch screens, one finger pans, pinch zooms, twist
  rotates, and two fingers moving up or down together tilt the 3D view; a
  gesture keeps its mode until you lift your fingers. Contextual help explains
  mouse, touch, and drawing controls. The camera stays steady through updates,
  history browsing, and draft cancellation.
- **Large single-floor homes.** The photographic map and camera keep up to four
  times as many map pages as before within a bounded memory budget. A map that
  an earlier version cut short keeps its warning until the robot re-sends pages
  that were missing; replaying only the surviving pages never clears it.

## Cleaning that follows your routine

- **Mop or vacuum more thoroughly when it is due.** Set a room to mop every few
  cleans or schedule a Quick, Optimal, or Heavy duty vacuum rotation. See when
  each is due, bring it forward once, or reset its progress with confirmation.
- **Share progress across plans.** New room schedules count across all plans by
  default; choose In this plan only for an independent routine. Deleting a shared
  schedule names the affected plans and preserves their usual cleaning settings
  and cleaning history.
- **Let a one-time clean do the due work.** Clean rooms can include an existing
  shared schedule without creating a plan, including mop and vacuum-and-mop
  requests. Review each room's effective settings, or turn off due work for that
  clean. Work you skip stays due, and mop-only work never resets a due vacuum
  rotation.
- **Count confirmed work.** Partial, stopped, failed, or unconfirmed work does
  not advance room schedules. Vacuum rotations stay due until their requested
  coverage is confirmed. When firmware clears live goals after completion, the
  exact completed native session can supply the evidence; missing or contradictory
  evidence never clears the due work.

## Know what is happening—and choose how to stop

- **Clearer progress.** See verified completed-room counts, active cleaning time,
  and a separately labeled estimate of the current room's elapsed cleaning time.
  The estimate uses successful runs with the same cleaning mode and coverage;
  switching settings preserves each learned timing tier across restarts. It
  does not measure cleaned floor area or award completion credit. Without
  enough matching history, it stays unknown.
- **Time in familiar units.** Plan estimates use compact hours and minutes.
  New duration entities suggest minutes for room timings and hours for the last
  clean, while their native measurements remain numeric seconds. See
  [timing scopes](native-cleaning-results.md) for active time, native work time
  and session span.
- **Smart Stop.** Choose a threshold for finishing the current room before
  docking. Later rooms stay out of that mission. While the current room finishes,
  **Stop now & dock** gives you an immediate override.
- **Results that stay visible.** Incomplete and unverified outcomes remain
  available after docking. Status explains when a result is being checked,
  cleaning is stopping, or the robot is returning.

## A steadier map on desktop, phone, and tablet

- Readable room colors, stronger boundaries, and improved label placement make
  selection easier. Shallow landscape views prioritize nearby, current, and
  selected rooms; more labels return when the map has space.
- Compact controls, improved keyboard focus, clearer drawing tools, and layouts
  that adapt to rotation and large text make the workspace easier to navigate.
- A retained map stays visible during connection recovery. Saved maps are dated,
  read-only, and show no live robot position. Cleaning waits for a verified live map.
- Saved areas survive compatible map refinements when their original location
  can be verified. When it cannot, **Confirm area on current map** lets you review
  the outline without starting a clean. Stale robot positions are hidden.

## Better connected to Home Assistant

- Use **Room finished**, **Plan finished**, and **Cleaning finished** device
  triggers in automations. Refreshed blueprints explain their inputs and start
  only when the robot is docked or idle; re-import them to receive the changes.
- Everyday actions use familiar control names; advanced identifiers and developer
  actions are separated. Entity states offer clearer choices in the automation editor.
- The default device page centers on standard vacuum controls. Specialized plan
  and area buttons and selectors are opt-in; default mode and coverage live under
  Configuration. Existing enabled entities and automations keep working.
- Dashboard map images correctly identify their PNG format, including resized
  requests from Home Assistant cards.
- Administrator-only Assist and MCP tools can inspect plans, readiness, activity,
  and history, and run plans, clean rooms, stop, or reset room-schedule progress.
  Assist requires a configured tool-capable agent; the built-in sentence agent
  alone does not provide these conversations. Firmware research uses a separate API.
- Firmware comparisons and optional notification blueprints help surface changes
  relevant to the integration. The robot continues to install its own firmware.
- Pairing has clearer progress and recovery guidance. **Robot was reset** verifies
  identity before saving replacement credentials and preserves saved plans and
  areas. Experimental pairing import supports hosts without local Bluetooth;
  the external helper has separate platform and hardware qualification.

## Before you update

**Requires Home Assistant 2026.10 or later.** Preserve a verified Home Assistant
backup, the installed integration, and its plan/configuration stores. Let the
robot dock, update through HACS, restart Home Assistant, and check the live map.
The plan store migrates to retain timing tiers. A source-only downgrade cannot
restore the older store format; use a matching backup and preserve newer run records. See the [rollback guidance](verification-0.5-rc24.md).

Retained entities keep their IDs, although several display names are clearer.
Four duplicate entities are removed on upgrade; update any dashboards or
custom automations that use them (examples assume a robot named Matic):

| Removed entity | Replacement |
| --- | --- |
| `binary_sensor.matic_active_cleaning_session` | `binary_sensor.matic_cleaning` |
| `binary_sensor.matic_update_available` | `update.matic_firmware` |
| `sensor.matic_software_version` | Software version on the device page |
| `sensor.matic_hardware_revision` | Hardware version on the device page |

Existing enabled/disabled entity choices are preserved. New installations hide
some duplicate status and technical entities by default. The interface ships
in English; layout support for other locales is not a translated catalog.

This stable candidate builds on [RC43](release-notes-0.5.0-rc43.md) with the final
timing, display, control-default, camera, touch-gesture, large-floor, and
one-time due-work corrections above. Dedicated
contextual Cleaning history is planned for 0.6; saved-map history and current run results remain available now.
See [current qualification and its limits](verification-0.5-stable.md) for device,
accessibility, Assist, notification-delivery, and final release acceptance status.
