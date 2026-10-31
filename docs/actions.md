# Action reference

[Automations and examples](automation.md) · [Cleaning guide](cleaning.md)

Run saved plans, preview room order, clean custom areas and manage room
settings from Home Assistant automations or Developer tools > Actions.

All actions use the `matic_robot` domain and target the robot's vacuum entity.
Room and plan fields accept a name or an ID. Names match regardless of case, an
ID wins over a name, and a name that matches more than one room is refused.
ID fields (`preview_token`, `expected_run_id`, `plan_id`, `revision`), timeouts
and `stop_now` are hidden until you turn on **Advanced mode** in your Home
Assistant user settings. The full schema is in
[services.yaml](../custom_components/matic_robot/services.yaml).

## Cleaning

| Action | Fields and behavior |
| --- | --- |
| Start cleaning (`clean`) | Optional `rooms` (up to 100), `cleaning_mode`, `coverage_setting` and `ordered` (default `false`). Omit rooms for the whole floor; omit mode or coverage to use the Default cleaning mode and Default vacuum coverage settings. |
| Clean room sequence (`clean_room_sequence`) | Required `rooms` (up to 100, in order), each a `room` with optional `cleaning_mode` (default `vacuum_and_mop`) and `coverage_setting` (default `standard`); optional `return_to_base` (default `true`). Matic Map's **Clean rooms** uses this action. |
| Preview room sequence (`preview_room_sequence`) | Takes the same fields and returns each room's effective settings and due work, and a `preview_token`, without starting cleaning. Administrators only. |
| Clean custom area (`clean_area`) | Required `area` (name or ID); optional `cleaning_mode` and `coverage_setting` override the area's saved settings. |
| Run plan (`run_selected_plan`) | Runs `plan`, or the default plan, the way it is saved. Optional `preview_token` from Preview next plan run refuses the run if the plan changed since. |
| Run Smart Order (`intelligent_clean`) | Runs `plan` starting with the rooms and custom areas that have waited longest, whatever its saved order. |
| Run saved order (`clean_entire_plan`) | Runs `plan` once, top to bottom, with each room's saved settings. |
| Stop cleaning (`stop_intelligent_cleaning`) | Stops the running plan and docks, following its Smart Stop setting. See [stopping a plan](#stopping-a-plan). |

Both sequence actions also take `use_room_schedule` (**Use room schedules** in
Matic Map, default `false`), which adds the work shared room schedules say is
due and counts those cleans, and `override_room_schedule` to keep your own
settings; matching cleans still count. In YAML, Clean room sequence also takes
a preview's `preview_token` and refuses the run if anything changed since.

Leave `plan` empty to use the default plan; List cleaning plans returns every
plan's name and ID. Cleaning modes: `vacuum`, `mop`, `vacuum_and_mop`. Vacuum
coverage: `quick`, `standard` (Optimal), `heavy_duty`; it does not change
mopping, so use Double-pass mopping for an extra mop pass. Use Home Assistant's
vacuum actions to pause, resume and dock; `vacuum.clean_area` cleans the rooms
linked to the Home Assistant Areas you pick, with the default mode and coverage.

### Stopping a plan

Stop cleaning never starts another room. Without Smart Stop, the robot stops
and docks at once. With Smart Stop, the current room finishes first if it has
reached the plan's share of its estimated time or has no estimate yet, and a
custom area always finishes first. While it finishes, `stop_now: true` with the
run's `expected_run_id` (`run_id` in Active cleaning plan's `active` attribute)
acts as **Stop now & dock**. `include_unmanaged: true` also stops a one-time
clean, or one started in the Matic app, when no plan is running.

## Sink refill

`vacuum.send_command` with `command: sink_summon` sends the robot to the sink
location saved in the Matic app for the current floor. It waits there for up to
15 minutes for a water refill. Sent from the dock or while idle, it then docks.
During a clean, including a plan run, the robot keeps its task: Resume continues
the clean straight away, and otherwise it continues once the wait ends. A plan
docked between rooms holds no task, so a summon then ends the plan like any
other direct command. The floor must have a saved sink location.

```yaml
actions:
  - action: vacuum.send_command
    target:
      entity_id: vacuum.matic
    data:
      command: sink_summon
```

## Go to room

**Go to room** (`matic_robot.go_to_room`) sends the robot to one `room`, by name
or room ID, without cleaning it. A name shared by two rooms is refused; use the
room ID. The same `vacuum.send_command` command is `go_to_room` with
`params: {room: Kitchen}`. In Matic Map, pick one room and press **Go to room**.

Go to room follows the sink refill's rules: sent during a clean, the robot keeps
its task and the plan driving it, and from the dock or while idle it ends a plan
docked between rooms. It never marks a room as cleaned. Sent from the dock, the
robot reaches the room and waits there for 10 minutes before heading back on
its own; `stay_put` keeps it there.

```yaml
actions:
  - action: matic_robot.go_to_room
    target:
      entity_id: vacuum.matic
    data:
      room: Kitchen
```

## Stay put and emotes

`vacuum.send_command` with `command: stay_put` tells the robot to stay where it
is rather than return to the dock. The Matic app sends it when you cancel the
robot's own countdown to dock after a task; on a real robot it cancelled that
countdown and the robot stayed put. Home Assistant's Stop always docks,
so stay put waits until that return has settled; use Pause to keep the robot
where it is. `command: emote` with `params: {kind: snap}` takes
a photo with the robot's camera, which then shows in the Matic app. The kinds
`nod`, `shake` and `pirouette` are the app's other emotes. The robot accepts
all of them; whether those three visibly move it is not confirmed yet.

```yaml
actions:
  - action: vacuum.send_command
    target:
      entity_id: vacuum.matic
    data:
      command: emote
      params:
        kind: snap
```

## Repeat the last clean

`vacuum.send_command` with `command: redo_last_clean` cleans the robot's most
recent finished clean again, like **Clean again** in the Matic app's history.
It starts only while the robot is docked or idle and, like any direct clean,
ends a plan docked between rooms. Tried on a real robot, it started the same
rooms as the previous clean within 10 seconds.

## Skip, clean next or clean again

**Skip room**, **Clean room next** and **Clean room again** change the clean
that is running. See [Changing a running clean](queue-changes.md).

## Plans

| Action | Fields and behavior |
| --- | --- |
| List cleaning plans (`list_plans`) | Returns saved plans with their rooms, custom areas, settings and IDs, and the default plan. |
| Preview next plan run (`preview_plan`) | Returns `plan`'s next order and settings, its `entries` (rooms and custom areas in run order) and a `preview_token` for Run plan, without running it. |
| Create or replace cleaning plan (`save_plan`) | Saves `name` and `rooms` (rooms and custom areas, in order). The ID comes from the name unless you pass `plan_id`; saving an existing ID replaces that plan. |
| Set default cleaning plan (`select_plan`) | Makes `plan` the default. |
| Delete cleaning plan (`delete_plan`) | Deletes `plan`; refused while it runs. |
| Add or update plan room or area (`save_plan_room`) | Adds `room` (a room or an area entry) to the end of `plan`, or updates its settings where it is. |
| Move room or area in plan (`move_plan_room`) | Moves `room` or `area` in `plan` to `new_position` (1 is the top). |
| Remove room or area from plan (`delete_plan_room`) | Removes `room` or `area` from `plan`. |
| Reset room cleaning history (`reset_plan_history`) | Clears which rooms `plan` has cleaned, or every plan with `all_plans: true`. |
| Reset room schedule progress (`reset_room_cadence`) | Resets mopping, vacuum rotation or both (`modes`) for one `room_id`, or every scheduled room, in the required `plan`. |
| Delete shared room schedule (`delete_room_schedule`) | Removes one room's shared schedule from every plan that uses it, given its `room_id` and current `expected_token` from Matic Map. Usual cleaning settings and cleaning history remain. |

`save_plan` also accepts `enabled` (default `true`), `run_behavior`
(`intelligent` for Smart Order, the default, or `ordered` for Saved order),
`return_to_base` (**Return to the dock when finished**, default `true`),
`finish_current_room` (**Smart Stop**, default `false`),
`finish_current_room_threshold` (0 to 100%, default 50), `occupancy_aware`
(**Hold occupied rooms**, default `false`), `occupancy_sensors` (room ID to
`binary_sensor` overrides; see [occupied rooms](cleaning.md#occupied-rooms))
and `select` (make it the default plan, default `true`). Room items default to
`vacuum_and_mop` and `standard`.

### Custom areas in plans

Each item of `rooms` names either a `room` or a saved custom `area`, never
both. An area item takes optional `cleaning_mode` and `coverage_setting`
overrides, as Clean custom area does, and no room schedule: an area runs every
time the plan runs. A plan can hold only areas. Saving checks that each area
exists and was drawn on the current map.

```yaml
data:
  name: Pet spots
  rooms:
    - room: Kitchen
    - area: Food bowls
      coverage_setting: heavy_duty
```

Smart Order ranks rooms and custom areas together by which have waited
longest; Saved order keeps their saved positions. A run or preview is refused
(`plan_area_missing`, `area_map_changed`) when one of its areas was deleted or
drawn on another map. Deleting an area removes it from every plan; it is
refused while it is a plan's only item, and Matic Map names those plans.

A plan runs in one or more parts, and the robot may stop at the dock between
parts ([how a plan runs](cleaning.md#how-a-plan-runs)):

- Rooms next to each other in the run order share one part. The robot goes
  from room to room without returning to the dock, apart from recharging or
  refilling on its own, and each room keeps its own settings.
- Each custom area is a part of its own. After an area, the robot usually
  returns to the dock before the next room or area starts, so an area between
  two rooms splits them into separate parts and adds dock trips. Put areas
  together at the start or end of a plan to keep the rooms in one part.
- With Smart Stop on, each room is a part of its own, so the next room starts
  only after the previous one ends.

Before an area starts, the run checks again that it is unchanged and on the
current map. An area counts as finished when Home Assistant sees the robot end
its part; the robot's own report for a drawn area carries no name and isn't
used. Areas never change room schedules. The `area_started`, `area_finished`
and `area_failed` [events](automation.md#events-and-observability) report each.

## Advanced actions

Developer actions start with "Advanced:" so they list together.

| Action | Fields and behavior |
| --- | --- |
| Advanced: Inspect robot data (`inspect_hermes_endpoint`) | Reads the size and a checksum of one `endpoint` item, never its contents. Optional `limit` is 1 to 256 (default 32). Items that hold keys or passwords are blocked. |
| Advanced: Record firmware snapshot (`firmware_snapshot`) | See [Firmware snapshot](#firmware-snapshot). |
| Advanced: Choose firmware investigator (`firmware_investigator`) | Sets which connected agent researches firmware reports; `manual` stops automatic research. Administrators only. |
| Advanced: Update firmware notification (`firmware_notification`) | Acknowledges, marks as delivered or checks again for one `report_id` and `revision`. Used by the Matic: Send firmware alerts blueprint. |

```yaml
actions:
  - action: matic_robot.inspect_hermes_endpoint
    target:
      entity_id: vacuum.matic
    data:
      endpoint: wifi_status
      limit: 1
    response_variable: inspection
```

## Firmware snapshot

`firmware_snapshot` reads all 40 robot data items that hold no keys or passwords and returns
firmware and protocol versions, item status and counts, checksums and shape
changes since the last snapshot. Up to 52 snapshots are kept locally. See
[firmware compatibility](firmware-compatibility.md).

## Errors

Every refusal names what to fix, for example "This plan is turned off. Turn it
on in Matic Map, then try again." Messages never include internal error text.
