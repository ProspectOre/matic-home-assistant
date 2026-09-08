# Action reference

[Automations and examples](automation.md) · [Cleaning guide](cleaning.md)

All actions use the `matic_robot` domain and target a Matic vacuum entity.
Names and stable IDs are accepted where applicable; ambiguous names are rejected.
The full field schema is in [services.yaml](../custom_components/matic_robot/services.yaml)
and Home Assistant's **Developer tools → Actions**.

## Cleaning

| Action | Fields and behavior |
| --- | --- |
| `clean` | Optional `rooms`, `cleaning_mode`, `coverage_setting`, and `ordered`. Omit rooms for the whole floor. |
| `clean_room_sequence` | Required `rooms` list with per-room settings; optional `return_to_base` (default `true`). |
| `clean_area` | Required saved `area` name; optional `cleaning_mode` and `coverage_setting` overrides. |
| `run_selected_plan` | Run optional `plan`, or the default plan, with its saved behavior. |
| `intelligent_clean` | Run optional `plan` using intelligent rotation. |
| `clean_entire_plan` | Run optional `plan` in saved room order. |
| `stop_intelligent_cleaning` | Apply the active plan's stop policy and dock. Set `include_unmanaged: true` to also stop other cleaning. |

Cleaning modes: `vacuum`, `mop`, `vacuum_and_mop`.
Coverage: `quick`, `standard` (Optimal), `heavy_duty`.
For pause, resume, stop, and dock, use Home Assistant's standard vacuum actions.

## Plans

| Action | Fields and behavior |
| --- | --- |
| `list_plans` | Return saved plans. |
| `preview_plan` | Return optional `plan`'s next room order and settings without running it. |
| `save_plan` | Create or update a plan with `name` and `rooms`; pass `plan_id` to update. |
| `select_plan` | Set required `plan` as the default. |
| `delete_plan` | Delete required `plan`. |
| `save_plan_room` | Add or update a `room` object in `plan`. |
| `move_plan_room` | Move `room` in `plan` to `new_position` (starting at 1). |
| `delete_plan_room` | Remove `room` from `plan`. |
| `reset_plan_history` | Clear completion tracking for `plan`, or set `all_plans: true`; retain saved settings. |

`save_plan` also accepts `enabled`, `run_behavior` (`intelligent` or `ordered`),
`return_to_base`, `finish_current_room`,
`finish_current_room_threshold`, and `select`. Advanced timeout fields are
listed in the action editor.

## Endpoint inspection

`inspect_hermes_endpoint` requires one robot and an allowlisted `endpoint`.
Optional `limit` is 1–256 (default 32). It returns endpoint kind, sensitivity,
entry sizes, SHA-256 fingerprints, and available value-free protobuf wire
shapes. Raw payloads are excluded.

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

`firmware_snapshot` checks all 40 allowlisted endpoints and returns firmware
and protocol versions, endpoint status/counts, fingerprints, and wire-shape
changes. Up to 52 snapshots are retained locally. See
[firmware compatibility](firmware-compatibility.md).
