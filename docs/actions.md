# Action reference

[Automations and examples](automation.md) · [Cleaning guide](cleaning.md)

Run saved plans, preview room order, clean custom areas and manage room
settings from Home Assistant automations or Developer tools > Actions.

All actions use the `matic_robot` domain and target the robot's vacuum entity.
Room and plan fields accept a name or an ID; a name that matches more than one
room is refused. ID fields (`preview_token`, `expected_run_id`, `plan_id`,
`revision`) and timeouts are hidden until you turn on **Advanced mode** in
your Home Assistant user settings. The full schema is in
[services.yaml](../custom_components/matic_robot/services.yaml).

## Cleaning

| Action | Fields and behavior |
| --- | --- |
| Clean (`clean`) | Optional `rooms`, `cleaning_mode`, `coverage_setting` and `ordered`. Omit rooms for the whole floor. |
| Clean room sequence (`clean_room_sequence`) | Required `rooms`, each with room, cleaning mode and vacuum coverage; optional `return_to_base` (default `true`). |
| Preview room sequence (`preview_room_sequence`) | Checks the selected rooms, effective settings and due work without starting cleaning; returns the preview used to confirm the run. |
| Clean custom area (`clean_area`) | Required `area` name; optional `cleaning_mode` and `coverage_setting` overrides. |
| Run plan (`run_selected_plan`) | Runs `plan`, or the default plan, the way it is saved. |
| Run intelligent rotation (`intelligent_clean`) | Runs `plan` starting with the rooms that have waited longest. |
| Run saved order (`clean_entire_plan`) | Runs `plan` in saved room order. |
| Stop cleaning (`stop_intelligent_cleaning`) | Applies the running plan's stop setting and docks. Set `include_unmanaged: true` to also stop other cleaning. |

Leave `plan` empty to use the default plan; List cleaning plans returns every
plan's name and ID. Cleaning modes: `vacuum`, `mop`, `vacuum_and_mop`. Vacuum
coverage: `quick`, `standard` (Optimal), `heavy_duty`; it does not change
mopping, so use Double-pass mopping for an extra mop pass. For pause, resume
and dock, use Home Assistant's standard vacuum actions.

## Plans

| Action | Fields and behavior |
| --- | --- |
| List cleaning plans (`list_plans`) | Returns saved plans, rooms, IDs and the default plan. |
| Preview next plan run (`preview_plan`) | Returns `plan`'s next room order and settings, and its `entries` (rooms and custom areas in run order), without running it. |
| Create or replace cleaning plan (`save_plan`) | Saves `name` and `rooms` (rooms and custom areas); pass `plan_id` to replace a plan. |
| Set default cleaning plan (`select_plan`) | Makes `plan` the default. |
| Delete cleaning plan (`delete_plan`) | Deletes `plan`. |
| Add or update plan room or area (`save_plan_room`) | Adds or updates `room` (a room or an area entry) in `plan`. |
| Move room or area in plan (`move_plan_room`) | Moves `room` or `area` in `plan` to `new_position` (1 is the top). |
| Remove room or area from plan (`delete_plan_room`) | Removes `room` or `area` from `plan`. |
| Reset room cleaning history (`reset_plan_history`) | Clears which rooms `plan` has cleaned, or every plan with `all_plans: true`. |
| Reset room schedule progress (`reset_room_cadence`) | Resets mopping, vacuum rotation or both for one room or the whole plan. |
| Delete shared room schedule (`delete_room_schedule`) | Removes one room's shared schedule after checking the confirmation and affected plans; usual cleaning settings and cleaning history remain. |

`save_plan` also accepts `enabled`, `run_behavior` (`intelligent` for
Intelligent rotation or `ordered` for Saved order), `return_to_base`,
`finish_current_room`, `finish_current_room_threshold` and `select`.

### Custom areas in plans

Each item of `rooms` names either a `room` or a saved custom `area`, never
both. An area item takes optional `cleaning_mode` and `coverage_setting`
overrides, as Clean custom area does, and no room schedule: an area runs every
time because the robot reports no per-area completion. A plan can hold only
areas. Saving checks that each area exists and was drawn on the current map.

```yaml
data:
  name: Pet spots
  rooms:
    - room: Kitchen
    - area: Food bowls
      coverage_setting: heavy_duty
```

Smart Order ranks rooms and custom areas together by which have waited longest.
Saved order keeps their saved positions. A preview splits the run at every switch between rooms and
an area, and is refused (`area_missing`, `area_map_changed`) when an area was
deleted or the map changed. Deleting an area removes it from every plan; it
is refused while it is a plan's only item, and Matic Map names those plans.
In Matic Map, a plan's Edit adds saved areas drawn on the current map,
orders them among the rooms in Saved order, sets each one's cleaning mode and
vacuum coverage, and removes them. An area that was deleted or drawn on
another map is marked Needs attention, since saving refuses it. Your areas
lists the plans that clean each area.

When the plan runs, each area is a part of its own, between the rooms around
it. The run starts an area only when the robot is idle, checks again that the
area is unchanged and on the current map, and follows that part until the
robot ends it; the robot reports no per-area result, so an area counts as done
when its part ends and never changes room schedules. Stop with "finish the
current room" lets the current area finish first. The `area_started`,
`area_finished` and `area_failed` events report each area.

## Advanced actions

Developer actions start with "Advanced:" so they list together.

| Action | Fields and behavior |
| --- | --- |
| Advanced: Inspect robot data (`inspect_hermes_endpoint`) | Reads the size and a checksum of one `endpoint` item, never its contents. Optional `limit` is 1 to 256 (default 32). Items that hold keys or passwords are blocked. |
| Advanced: Record firmware snapshot (`firmware_snapshot`) | See [Firmware snapshot](#firmware-snapshot). |
| Advanced: Choose firmware investigator (`firmware_investigator`) | Sets which connected agent researches firmware reports; `manual` stops automatic research. |
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
