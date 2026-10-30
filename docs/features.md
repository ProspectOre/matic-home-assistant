# What Home Assistant adds

[Install](../README.md#install) · [Cleaning guide](cleaning.md) · [Automations](automation.md)

Use Matic's cleaning in automations that respond to your home.
These are the integration's main additions:

| Feature | What you can do |
| --- | --- |
| Matic Map | A sidebar page with a photographic 3D map and a 2D plan, live robot position, room selection, plans, custom areas and saved map history. Works with a mouse, touch or keyboard. |
| Plans with rooms and custom areas | Save rooms and custom areas in one order, each with its own cleaning mode and vacuum coverage, and preview the next run. Rooms next to each other run in one part; each custom area is its own part, after which the robot usually returns to the dock. [How a plan runs](cleaning.md#how-a-plan-runs). |
| Smart Order | Clean the rooms and custom areas that have waited longest first on the next run, or keep your saved order. |
| Room schedules | Mop every few cleans or rotate the vacuum coverage, counted across all plans or in one plan. One-time room cleans can include work that's due. Only confirmed work counts. [Guide](room-schedules.md). |
| Smart Stop | When you press Stop, finish the current room if it's far enough along, or stop now and dock. |
| Home-driven cleaning | Combine presence, schedules, pet devices and other Home Assistant triggers with plans or named custom areas. |
| Finish events | React to Room finished, Plan finished and Cleaning finished in automations. |
| Room statistics | Put last-cleaned times and cleaning durations on dashboards and in Recorder. |
| Assistant tools | Ask about plans, run status, recent events and history, and run plans, clean rooms, stop or reset schedule progress, through administrator-only tools for Assist and MCP. |
| Firmware comparisons | See when a firmware update changes how the robot talks to Home Assistant, with a Repair when something the integration uses changes. |

The live map and robot position update on their own; there's nothing to set.

## An automation that adapts to short trips away

Create a plan with your rooms and their preferred cleaning settings. Use the
[away blueprint](automation.md#ready-to-import-blueprints) to start it when
everyone leaves and stop when someone returns. With Smart Order, the next
departure gives waiting rooms a turn. Turn on Smart Stop if a stop should
finish the room the robot is in.

Smart Order tracks which rooms have had a turn separately from confirmed
results. A room that starts moves behind waiting rooms; **Last cleaned**
updates only when the robot confirms the room is done. [How Smart Order
works](cleaning.md#intelligent-rotation).

## Maps and controls alongside your other devices

Matic Map brings live 3D and 2D maps, room selection, plan Run and Edit views,
named custom areas, saved map history and an opt-in Wi-Fi signal map into Home
Assistant. Dashboard cameras
and entities let you build your own view. Settings include water flow,
double-pass mopping, child lock, pet-waste avoidance, and the Cues voice
assistant.

[Map and area guide](cleaning.md) · [Plan Run and Edit](cleaning.md#run-and-edit) ·
[Entity reference](entities.md)

Use the Matic app to turn on Pairing mode during setup. After pairing, Home
Assistant talks to the robot on your network with its own key. The robot still
installs its own firmware updates.
