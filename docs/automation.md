# Automations

[Documentation](README.md) · [Actions](actions.md) · [Entities](entities.md)

Use Home Assistant schedules, presence, and state triggers to run Matic.
Replace example entity IDs with those shown on your robot's device page.

## Complete cleaning action

`matic_robot.clean` accepts room names or IDs, a cleaning mode, coverage, and
optional room ordering. Omit `rooms` to clean the whole floor. Modes are
`vacuum`, `mop`, and `vacuum_and_mop`; coverage values are `quick`, `standard`
(shown as **Optimal**), and `heavy_duty`.

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

Create a plan in [Matic Map](cleaning.md#saved-plans), then call
`matic_robot.run_selected_plan`. Use `plan` to choose a name or stable ID;
omit it to run the default plan. `matic_robot.preview_plan` returns the next
room order and settings without starting a run.

## Intelligent rotation

`matic_robot.intelligent_clean` runs a plan in rotation order;
`matic_robot.clean_entire_plan` uses saved room order. Stop with
`matic_robot.stop_intelligent_cleaning` to apply the plan's
[finish-current-room policy](cleaning.md#stopping-a-plan).

<a id="painted-custom-areas"></a>

## Custom areas

[Save an outline](cleaning.md#custom-areas), then call it by name. This example
cleans a saved area after a litter-box cycle:

```yaml
alias: Clean around litter box after cycle
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
mode: single
```

Optional `cleaning_mode` and `coverage_setting` override the area's saved defaults.

## Matic Cues

The `matic_robot_cues` event carries `device_id`, `entry_id`, and `event_type`.
`intent_classified` also includes `intent`. For example:

```yaml
triggers:
  - trigger: event
    event_type: matic_robot_cues
    event_data:
      event_type: following_started
actions:
  - action: light.turn_on
    target:
      entity_id: light.hallway
```

Event types: `disabled`, `ready`, `wake_word_detected`, `intent_processing`,
`intent_classified`, `intent_rejected`, `gesture_awaiting_pointed_target`,
`gesture_pointed_target_accepted`, `gesture_no_target_found`,
`gesture_facing_user`, `gesture_person_not_found`, `gesture_following`,
`following_started`, and `following_stopped`.

Intents: `clean`, `clean_all`, `dock`, `go_away`, `navigate`, `pause`,
`redo_last_clean`, `resume`, `sink_summon`, `stop`, `follow_person`,
`point_to_clean`, and `unknown`. See [Cues data handling](privacy.md#matic-cues)
before automating the switch.

## Events and observability

| Event | Meaning |
| --- | --- |
| `matic_robot_room_started` | A managed room started; emitted once per room in a mission |
| `matic_robot_room_completed` | Verified managed completion; updates last-cleaned and duration statistics |
| `matic_robot_room_failed` | A managed room failed |
| `matic_robot_room_cancelled` | A managed room was cancelled |
| `matic_robot_room_interrupted` | A managed task was stopped or replaced |
| `matic_robot_room_ended_unverified` | The task ended without sufficient completion evidence |
| `matic_robot_cleaning_finished` | A newly ended native session, with times, duration, room results, and robot identifiers |
| `matic_robot_firmware_changed` | A new firmware/protocol pair, with previous values and robot identifiers |
| `matic_robot_firmware_analyzed` | Endpoint comparison counts and new wire paths |
| `matic_robot_cues` | Voice, intent, gesture, or following transition |

`cleaning_finished` depends on native history being available. Startup history
is not replayed. Use `room_completed` for managed completion triggers; see
[cleaning results](native-cleaning-results.md) for partial and combined-mode runs.

## Ready-to-import blueprints

- [Clean when everyone leaves](../blueprints/automation/matic_robot/clean_when_away.yaml)
- [Quiet-hours cleaning](../blueprints/automation/matic_robot/quiet_hours.yaml)
- [Pet-aware cleaning](../blueprints/automation/matic_robot/pet_aware.yaml)
- [Scheduled intelligent cleaning](../blueprints/automation/matic_robot/room_rotation.yaml)

The away blueprint rechecks presence after its settle period and starts only
when Matic is docked or idle.

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
