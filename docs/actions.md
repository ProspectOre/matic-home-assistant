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

See [sink refill](robot-command-actions.md#sink-refill).

## Go to room

See [go to room](robot-command-actions.md#go-to-room).

## Stay put and emotes

See [stay put and emotes](robot-command-actions.md#stay-put-and-emotes).

## Photo patrol

**Photo patrol** (`matic_robot.photo_patrol`) sends the robot to each of up to
12 `rooms` and returns a photo from each confirmed arrival. Enable patrols and
configure no-photo rooms in the integration's privacy and safety settings first.
Notification URLs use pixelated previews by default; `full_resolution: true`
selects full photos. See [Photo patrol](photo-patrol.md) for the fields, example,
battery and schedule checks, cooldown, and ownership-safe return to dock.

## Repeat the last clean

See [repeat the last clean](robot-command-actions.md#repeat-the-last-clean).

## Skip, clean next or clean again

**Skip room**, **Clean room next** and **Clean room again** change the clean
that is running. See [Changing a running clean](queue-changes.md).

## Plans

See [plan actions](plan-actions.md) for plan management, custom areas and settings.

<a id="custom-areas-in-plans"></a>
See [custom areas in plans](plan-actions.md#custom-areas-in-plans).

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
