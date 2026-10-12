# Automations

[Documentation](README.md) · [Actions](actions.md) · [Entities](entities.md)

Run a saved plan when everyone leaves, clean a custom area after a pet-device
cycle, or react when a room finishes. Replace example entity IDs with those
shown on your robot's device page.

## Ready-to-import blueprints

| Blueprint | Import |
| --- | --- |
| Matic: Clean when everyone leaves | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Fclean_when_away.yaml) |
| Matic: Clean during quiet hours | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Fquiet_hours.yaml) |
| Matic: Clean after pets leave | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Fpet_aware.yaml) |
| Matic: Clean on a schedule | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Froom_rotation.yaml) |
| Matic: Send firmware alerts | [![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FProspectOre%2Fmatic-home-assistant%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fmatic_robot%2Ffirmware_intelligence.yaml) |

- Every cleaning blueprint starts only when the robot is docked or idle.
- A household member is away unless their state is `home`, `unknown` or
  `unavailable`, so someone in a named zone such as Work counts as away.
- Clean after pets leave runs at most once a day.
- Clean during quiet hours checks the battery only when you choose a sensor.
- Leave Plan empty to run the default plan.
- Send firmware alerts asks only for the Firmware check status sensor and finds
  the robot from that sensor's device.

## Clean action

`matic_robot.clean` accepts room names or IDs, a cleaning mode, coverage and
optional ordering. Omit `rooms` to clean the whole floor. Modes are `vacuum`,
`mop` and `vacuum_and_mop`; coverage is `quick`, `standard` (shown as
Optimal) or `heavy_duty`.

```yaml
actions:
  - action: matic_robot.clean
    target:
      entity_id: vacuum.matic
    data:
      rooms: [Kitchen, Study]
      cleaning_mode: vacuum_and_mop
      coverage_setting: standard
      ordered: true
```

## Saved plans

Create a plan in [Matic Map](cleaning.md#saved-plans), then call Run plan
(`matic_robot.run_selected_plan`). Set `plan` to a plan name or ID, or omit it
to run the default plan. Preview next plan run (`matic_robot.preview_plan`)
returns the next room order and settings without starting a run. Run
intelligent rotation (`intelligent_clean`) starts with the rooms that have
waited longest; Run saved order (`clean_entire_plan`) keeps the saved order.
Stop cleaning (`stop_intelligent_cleaning`) applies the plan's
[stop setting](cleaning.md#stopping-a-plan).

<a id="painted-custom-areas"></a>
<a id="drawn-custom-areas"></a>

## Custom areas

[Save a custom area](cleaning.md#custom-areas), then call it by name:

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.litter_box_cycle
    from: "on"
    to: "off"
actions:
  - action: matic_robot.clean_area
    target:
      entity_id: vacuum.matic
    data:
      area: Litter box
```

## Matic Cues

The `matic_robot_cues` event carries `device_id`, `entry_id` and `event_type`;
`intent_classified` also includes `intent`.

Event types: `disabled`, `ready`, `wake_word_detected`, `intent_processing`,
`intent_classified`, `intent_rejected`, `gesture_awaiting_pointed_target`,
`gesture_pointed_target_accepted`, `gesture_no_target_found`,
`gesture_facing_user`, `gesture_person_not_found`, `gesture_following`,
`following_started` and `following_stopped`.

Intents: `clean`, `clean_all`, `dock`, `go_away`, `navigate`, `pause`,
`redo_last_clean`, `resume`, `sink_summon`, `stop`, `follow_person`,
`point_to_clean` and `unknown`. See [Cues data handling](privacy.md#matic-cues)
before automating the switch.

## Events and observability

Each event's type is `matic_robot_` plus the name in the second column.

| Event | Type | Fields |
| --- | --- | --- |
| Room started | `room_started` | `entity_id`, `plan_id`, `room_id`, `room`, `run_id`, `cleaning_mode`, `coverage_setting` |
| Room finished | `room_completed` | room fields, `reason_code`, `cause` |
| Room failed | `room_failed` | room fields, `reason_code`, `cause` |
| Room cancelled | `room_cancelled` | room fields, `reason_code`, `cause` |
| Room stopped early | `room_interrupted` | room fields, `reason_code`, `cause` |
| Room ended unconfirmed | `room_ended_unverified` | room fields, `reason_code`, `cause` |
| Room confirmed late | `room_reconciled` | room fields, `reason_code`, `cause` |
| Plan finished | `plan_finished` | `entity_id`, `plan_id`, `run_id`, `outcome`, `reason_code`, `cause`, times, room counts |
| Plan docked | `plan_docked` | `entity_id`, `plan_id`, `run_id`, `outcome`, `docked_at` |
| Cleaning finished | `cleaning_finished` | `device_id`, `entry_id`, `started_at`, `ended_at`, `duration_seconds`, `rooms`, `completed_rooms` |
| Firmware changed | `firmware_changed` | `device_id`, `entry_id`, `previous_version`, `firmware_version` |
| Firmware checked | `firmware_analyzed` | `entry_id`, `firmware_version`, `compatibility_status`, change counts |
| Firmware report updated | `firmware_report_updated` | `entry_id`, `report_id`, `revision` |
| Cues activity | `cues` | `device_id`, `entry_id`, `event_type`, `intent` |
| Robot activity recorded | `activity_observed` | `entry_id`, `kind`, `source`, `run_id`, `command`, `outcome`, `activity` |

"Room fields" are those of Room started. Room finished, Plan finished and
Cleaning finished are also device triggers: on the robot's device page, select
+ on the Automations card and pick the trigger. Room and plan triggers match
the robot's vacuum entity; Cleaning finished matches the device.

Cleaning finished needs the robot's own history and is not replayed after a
restart. Use Room finished for plan room results; see
[cleaning results](native-cleaning-results.md) for partial and combined runs.
To investigate an event, download diagnostics: Settings > Devices & services >
Matic (Unofficial) > ⋮ on the robot's entry > Download diagnostics, then follow
[investigating interrupted cleaning](activity-diagnostics.md).

<a id="entity-contract"></a>
<a id="map-studio"></a>
<a id="plan-actions"></a>
<a id="payload-free-endpoint-inspection"></a>
<a id="firmware-snapshots"></a>
<a id="diagnosing-a-robot-error"></a>
<a id="room-statistics-and-the-recorder"></a>
<a id="fault-semantics"></a>

## More reference

[Entities, errors, and statistics](entities.md) · [Map controls](cleaning.md#map-studio) ·
[All action fields](actions.md) · [Firmware checks](firmware-compatibility.md)
