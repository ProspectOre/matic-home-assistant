# Matic 0.5.4

When a saved plan sends the robot to a room it cannot reach, such as one
behind a closed door, the plan now moves on to the next room. Before, Home
Assistant reported that another task had taken over and ended the plan. The
room gets no credit and stays due. The plan finishes as unverified because
that room was not cleaned.

Home Assistant decides this from the robot's record of the clean it started.
The robot has to report that it finished without reaching the room. The Matic
app shows that record as "Area inaccessible". If the clean was cancelled, or
the robot reached the room, the plan ends as before. Only a different clean
on the robot counts as a takeover.

Thanks to [parkerbxyz](https://github.com/parkerbxyz) for reporting and
diagnosing this in
[#410](https://github.com/ProspectOre/matic-home-assistant/issues/410): the
reproduction, the robot's record showing the room unattempted, the app's
"Area inaccessible" result, and tracing the failure to the start check.

## Removed in 0.6

Matic 0.6 removes 14 entities, 6 actions and 4 attributes that repeat something
else. Nothing is removed in 0.5.4. It warns you in Settings > Repairs while you
still have time to switch:

- When one of the six actions runs, a notice names it and what to use instead.
- When Home Assistant starts, a notice lists the automations and scripts that
  use one of the 14 entities, if that entity is enabled. Dashboards, templates
  and the four attributes are not checked, so search those yourself.
- If you imported a Matic cleaning blueprint, the notice **Matic blueprints
  need an update** has a Submit button. It switches your copies to Run plan
  with the same cleaning order and reloads your automations. The blueprints in
  this repository already use Run plan, so they now need 0.5.4 or later.

Run plan (`run_selected_plan`) takes a new optional `run_behavior`:
`intelligent` for Smart Order or `ordered` for Saved order. Leave it out to use
the order saved with the plan. The Problem sensor has a new `errors` attribute
with the names of the robot's current errors.

Entity IDs assume a robot named "Matic".

| Removed in 0.6 | Use instead |
| --- | --- |
| `intelligent_clean` (Run Smart Order) | `run_selected_plan` with `run_behavior: intelligent` |
| `clean_entire_plan` (Run saved order) | `run_selected_plan` with `run_behavior: ordered` |
| `select_plan` | `select.select_option` on `select.matic_saved_cleaning_plan` (Default cleaning plan), which is off until you enable it |
| `save_plan_room`, `move_plan_room`, `delete_plan_room` | `save_plan` with the plan's whole room list, or the plan editor in Matic Map |
| `button.matic_intelligent_clean`, `button.matic_clean_entire_plan` | `button.matic_run_selected_plan` (Run plan), or `run_selected_plan` with `run_behavior` |
| `button.matic_stop_intelligent_cleaning` | `vacuum.stop` on `vacuum.matic` |
| `binary_sensor.matic_paused`, `binary_sensor.matic_returning` | `vacuum.matic` in state `paused` or `returning` |
| `sensor.matic_activity` | The state of `vacuum.matic`: `ready` reads `idle`, and `charging` reads `docked` with `binary_sensor.matic_charging` on. Its `errors` attribute is now also on `binary_sensor.matic_problem`, where the first item is what `primary_error` held, and `current_area` is `sensor.matic_current_area` |
| `binary_sensor.matic_fully_charged` | `sensor.matic_battery` at 100 while `binary_sensor.matic_charging` is on |
| `sensor.matic_rooms` | The `rooms` attribute of `vacuum.matic`, which maps each room ID to its name |
| `sensor.matic_update_state`, `sensor.matic_update_channel` | The `update_state` and `update_channel` attributes of `update.matic_firmware` |
| `sensor.matic_scheduled_cleanings` | A calendar of the robot's scheduled cleanings, new in 0.6. Switch after you install 0.6 |
| `sensor.matic_protocol_version`, `sensor.matic_dock_detections`, `sensor.matic_sink_summon_locations` | The device page's Download diagnostics file. Automations cannot read it |
| Attributes `low_charge`, `charging`, `problem` and `current_area` of `vacuum.matic` | `binary_sensor.matic_low_charge`, `binary_sensor.matic_charging`, `binary_sensor.matic_problem` and `sensor.matic_current_area` |

Back up Home Assistant, update Matic to `v0.5.4` in HACS, and restart Home
Assistant. Home Assistant 2026.10 or later is required.
