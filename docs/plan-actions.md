# Plan actions

[Action reference](actions.md) · [Cleaning guide](cleaning.md)

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

See [how a plan runs](cleaning.md#how-a-plan-runs) for room and area ordering.

Before an area starts, the run checks again that it is unchanged and on the
current map. An area counts as finished when Home Assistant sees the robot end
its part; the robot's own report for a drawn area carries no name and isn't
used. Areas never change room schedules. The `area_started`, `area_finished`
and `area_failed` [events](automation.md#events-and-observability) report each.
