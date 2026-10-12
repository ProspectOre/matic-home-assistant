# Action reference

[Automations and examples](automation.md) · [Cleaning guide](cleaning.md)

Run saved plans, preview room order, clean custom areas and manage room
settings from Home Assistant automations or Developer tools > Actions.

All actions use the `matic_robot` domain and target the robot's vacuum entity.
Room and plan fields accept a name or an ID; a name that matches more than one
room is refused. ID fields (`preview_token`, `expected_run_id`, `plan_id`,
`revision`) and timeouts are hidden until you turn on Advanced mode in your
Home Assistant profile. The full schema is in
[services.yaml](../custom_components/matic_robot/services.yaml).

## Cleaning

| Action | Fields and behavior |
| --- | --- |
| Clean (`clean`) | Optional `rooms`, `cleaning_mode`, `coverage_setting` and `ordered`. Omit rooms for the whole floor. |
| Clean room sequence (`clean_room_sequence`) | Required `rooms`, each with room, cleaning mode and vacuum coverage; optional `return_to_base` (default `true`). |
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
| Preview next plan run (`preview_plan`) | Returns `plan`'s next room order and settings without running it. |
| Create or replace cleaning plan (`save_plan`) | Saves `name` and `rooms`; pass `plan_id` to replace a plan. |
| Set default cleaning plan (`select_plan`) | Makes `plan` the default. |
| Delete cleaning plan (`delete_plan`) | Deletes `plan`. |
| Add or update plan room (`save_plan_room`) | Adds or updates `room` in `plan`. |
| Move room in plan (`move_plan_room`) | Moves `room` in `plan` to `new_position` (1 is the top). |
| Remove room from plan (`delete_plan_room`) | Removes `room` from `plan`. |
| Reset room cleaning history (`reset_plan_history`) | Clears which rooms `plan` has cleaned, or every plan with `all_plans: true`. |
| Reset room schedule progress (`reset_room_cadence`) | Resets mopping, vacuum rotation or both for one room or the whole plan. |

`save_plan` also accepts `enabled`, `run_behavior` (`intelligent` for
Intelligent rotation or `ordered` for Saved order), `return_to_base`,
`finish_current_room`, `finish_current_room_threshold` and `select`.

## Advanced actions

Developer actions start with "Advanced:" so they list together.

| Action | Fields and behavior |
| --- | --- |
| Advanced: Inspect robot data (`inspect_hermes_endpoint`) | Reads the size and a checksum of one `endpoint` item, never its contents. Optional `limit` is 1 to 256 (default 32). Items that hold credentials are blocked. |
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

`firmware_snapshot` reads all 40 non-credential robot data items and returns
firmware and protocol versions, item status and counts, checksums and shape
changes since the last snapshot. Up to 52 snapshots are kept locally. See
[firmware compatibility](firmware-compatibility.md).

## Errors

Every refusal names what to fix, for example "This plan is turned off. Turn it
on in Matic Map, then try again." Messages never include internal error text.
