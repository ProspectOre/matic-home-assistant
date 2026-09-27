# What Home Assistant adds

[Install](../README.md#install) · [Cleaning guide](cleaning.md) · [Automations](automation.md)

Use Matic's cleaning capabilities in routines that respond to your home.
These are the integration's main additions:

| Feature | What you can do |
| --- | --- |
| Intelligent rotation | Give rooms that have waited longest the first cleaning opportunity on your next run. |
| Per-room plans | Save a room order with individual vacuum/mop modes and coverage settings; preview the next run. |
| Room schedules (0.5 development) | Add periodic mopping or coverage with private/shared progress and tracked one-time room cleans. [Guide](room-schedules.md). |
| Finish-current-room stopping | Stop immediately or finish the active room when its estimated progress reaches your chosen threshold. |
| Home-driven cleaning | Combine presence, schedules, pet devices, and other Home Assistant triggers with plans or named areas. |
| Completion events | React to verified room completion and plan outcomes in automations. |
| Room statistics | Put last-cleaned times and successful cleaning durations on dashboards and in Recorder. |
| Read-only operations tools | Inspect plan order, run status, recent events, command activity, and mode-specific history through administrator-only MCP tools. |
| Firmware comparisons | Track local protocol changes and receive Home Assistant Repairs for endpoint availability or transport changes. |

## A routine that adapts to short trips away

Create a plan with your rooms and their preferred cleaning settings. Use the
[away blueprint](automation.md#ready-to-import-blueprints) to start it when
everyone leaves and stop when someone returns. Enable intelligent rotation so
the next departure gives waiting rooms a turn. Choose whether a stop should
finish the active room using the plan's progress threshold.

Rotation tracks cleaning opportunities separately from successful completion.
A room that starts moves behind waiting rooms; **Last cleaned** updates only
when completion is verified. [How rotation works](cleaning.md#intelligent-rotation).

## Maps and controls alongside your other devices

Map Studio brings live 2D/3D maps, room selection, plan editing, named custom
areas, and saved map history into Home Assistant. Dashboard cameras and entities
let you build your own view. Settings include water flow, double-pass mopping,
child lock, pet-waste avoidance, and Matic Cues.

[Map and area guide](cleaning.md) · [Entity reference](entities.md)

## How this fits with the Matic app

The native app already supports room cleaning, schedules, and custom-area
schedules ([Matic FAQ](https://support.maticrobots.com/frequently-asked-questions)).
Matic also provides a [Matter connection to Home Assistant](https://support.maticrobots.com/how-to-connect-matic-to-home-assistant).
This community integration connects directly over the LAN and adds the plan
logic, events, statistics, map workspace, and inspection tools listed here.

Use the Matic app to enable pairing during setup. After pairing, the integration
uses its own local credential. Robot firmware updates remain managed by Matic.
